"""M7 · Agent Harness 最小教学版 —— 对应教程《篇05》§1-§4。

Harness ≠ Agent Loop（篇05 §2.1）：Loop 是模型的思考节奏（计划→执行→观察），
Harness 是组织对模型的管理制度——工具风险分级、Stop Condition、
Autonomy Budget、Checkpoint 持久化、Human Approval 挂起与幂等。
"""
from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable

from .execution import Checkpoint, EventStore, Run, RunState
from .llm import ModelRequest, ReliableExecutor


# ---------- 工具契约与注册表（篇05 §1.3 控制权矩阵的工具侧） ----------

@dataclass
class ToolContract:
    """风险分级决定谁能放行：low=只读，模型自主；high=副作用，必须过 Human Gate。"""
    name: str
    description: str
    parameters: dict                    # JSON Schema
    risk_level: str                     # "low" | "high"
    handler: Callable[[dict], Any]


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, ToolContract] = {}

    def register(self, t: ToolContract) -> None:
        self._tools[t.name] = t

    def get(self, name: str) -> ToolContract:
        return self._tools[name]

    def schemas(self) -> list[dict]:
        return [{"name": t.name, "description": t.description, "parameters": t.parameters}
                for t in self._tools.values()]


# ---------- Autonomy Budget（篇05 §1.5）：自主性不是开关，是预算 ----------

@dataclass
class AutonomyBudget:
    max_steps: int = 12
    max_cost_usd: float = 0.05
    max_wall_time_sec: float = 120.0
    consumed_steps: int = 0
    consumed_cost: float = 0.0
    started_at: float = field(default_factory=time.time)

    def check(self) -> str | None:
        """每个 Step 前检查；None=可继续，否则返回触顶维度名。"""
        if self.consumed_steps >= self.max_steps:
            return "max_steps"
        if self.consumed_cost >= self.max_cost_usd:
            return "max_cost"
        if time.time() - self.started_at > self.max_wall_time_sec:
            return "max_wall_time"
        return None


_REJECTED = object()  # 审批拒绝哨兵


class AgentHarness:
    """计划-执行-观察循环 + 管理外壳。五类 Stop Condition 的教学版实现三类（篇05 §2.3）：
    1. 成功停止——模型给出无工具调用的最终答复（done 信号）；
    2. 预算耗尽——AutonomyBudget 触顶，落事件后降级退出而非硬崩；
    3. 人工停止——Human Gate 拒绝 → Run 转 FAILED。"""

    def __init__(self, executor: ReliableExecutor, tools: ToolRegistry, store: EventStore,
                 budget: AutonomyBudget | None = None,
                 approver: Callable[[dict], bool] | None = None):
        self.executor, self.tools, self.store = executor, tools, store
        self.budget = budget or AutonomyBudget()
        self.approver = approver or self._console_approver  # 测试可注入自动审批器

    @staticmethod
    def _console_approver(req: dict) -> bool:
        print(f"\n⚠️  高风险操作待审批: {req['tool']} "
              f"{json.dumps(req['arguments'], ensure_ascii=False)}")
        return input("   批准执行? [y/N] ").strip().lower() == "y"

    # ---- 入口：支持全新 Run 与 Checkpoint 恢复两种路径 ----
    def run(self, objective: str, run_id: str | None = None) -> Run:
        run_id = run_id or f"run-{uuid.uuid4().hex[:8]}"
        cp = self.store.latest_checkpoint(run_id)
        if cp is not None:
            # Resume（篇05 §4.2）：加载最近 Checkpoint 重建状态，绝不重跑整个 Run
            print(f"↩️  从 Checkpoint 恢复 run={run_id} step_cursor={cp.step_cursor}")
            state, step_cursor = cp.state, cp.step_cursor
            provider = getattr(self.executor, "provider", None)
            if hasattr(provider, "fast_forward"):  # 脚本化 Provider 跳过已消费响应
                provider.fast_forward(state.get("llm_calls", 0))
            # 预算守恒（篇05 §6.3 Invariant #6）：恢复不重置已消耗预算
            self.budget.consumed_steps = state.get("budget_steps", 0)
            self.budget.consumed_cost = state.get("budget_cost", 0.0)
        else:
            state = {"messages": [{"role": "user", "content": objective}]}
            step_cursor = 0
            self.store.append(run_id, "run_created", {"objective": objective})
        run = Run(run_id, objective)
        run.transition(RunState.RUNNING)
        self.store.append(run_id, "run_started", {"resumed_from": step_cursor})
        try:
            self._loop(run, state, step_cursor)
        except Exception as e:
            # WAITING_APPROVAL 下崩溃不算失败：审批记录已持久化，可恢复（篇05 §4.3）
            if run.state == RunState.RUNNING:
                run.transition(RunState.FAILED)
                self.store.append(run_id, "run_failed", {"error": str(e)})
            raise
        return run

    # ---- 主循环：计划(LLM) → 执行(Tool) → 观察(结果回写) ----
    def _loop(self, run: Run, state: dict, step_cursor: int) -> None:
        while True:
            hit = self.budget.check()
            if hit:  # Stop #2：预算耗尽
                self.store.append(run.run_id, "budget_exhausted", {"dimension": hit})
                if run.state == RunState.RUNNING:
                    run.transition(RunState.FAILED)
                self.store.append(run.run_id, "run_failed", {"reason": f"预算耗尽: {hit}"})
                print(f"🛑 预算耗尽({hit})，降级退出")  # 生产系统应输出保守结论
                return
            step_cursor += 1
            self.budget.consumed_steps += 1
            step_id = f"step-{step_cursor}"
            self.store.append(run.run_id, "step_started", {"step_id": step_id})
            resp = self.executor.call(ModelRequest(
                messages=state["messages"], tools=self.tools.schemas(),
                trace_context={"run_id": run.run_id, "step_id": step_id}))
            state["llm_calls"] = state.get("llm_calls", 0) + 1
            self.budget.consumed_cost += resp.usage.get("cost_usd", 0)
            self.store.append(run.run_id, "llm_call",
                              {"step_id": step_id, "tools": [t["name"] for t in resp.tool_calls]})
            if not resp.tool_calls:  # Stop #1：done 信号
                self.store.append(run.run_id, "step_completed",
                                  {"step_id": step_id, "final": resp.content[:500]})
                self._save_checkpoint(run.run_id, step_cursor, state)
                run.transition(RunState.COMPLETED)
                self.store.append(run.run_id, "run_completed", {"answer": resp.content[:500]})
                print(f"\n✅ 最终结论:\n{resp.content}")
                return
            for tc in resp.tool_calls:  # 执行 → 观察
                result = self._execute_tool(run, step_id, tc)
                if result is _REJECTED:
                    self.store.append(run.run_id, "run_failed",
                                      {"reason": "人工拒绝", "tool": tc["name"]})
                    print(f"🛑 审批拒绝，Run 终止: {tc['name']}")
                    return
                state["messages"].append({"role": "tool", "name": tc["name"],
                                          "content": json.dumps(result, ensure_ascii=False, default=str)})
            self.store.append(run.run_id, "step_completed", {"step_id": step_id})
            self._save_checkpoint(run.run_id, step_cursor, state)  # Checkpoint 打在 Step 边界

    # ---- 工具执行：高风险工具过 Human Gate + 副作用幂等 ----
    def _execute_tool(self, run: Run, step_id: str, tc: dict) -> Any:
        tool = self.tools.get(tc["name"])
        call_id = f"{step_id}:{tc['name']}"  # 幂等键（篇05 §4.4）
        if tool.risk_level == "high":
            decision = self.store.get_approval(run.run_id, call_id)  # 恢复时先查账
            if decision is None:
                # Human Gate（篇05 §4.3）：持久化挂起，审批结论作为事件写回
                run.transition(RunState.WAITING_APPROVAL)
                self.store.append(run.run_id, "approval_requested",
                                  {"tool_call_id": call_id, "tool": tc["name"],
                                   "arguments": tc["arguments"]})
                ok = self.approver({"tool": tc["name"], "arguments": tc["arguments"]})
                decision = "approved" if ok else "rejected"
                self.store.record_approval(run.run_id, call_id, decision)
                self.store.append(run.run_id, "approval_decided",
                                  {"tool_call_id": call_id, "decision": decision})
                if ok:
                    run.transition(RunState.RUNNING)
                    self.store.append(run.run_id, "run_resumed", {"cause": "approved"})
            if decision != "approved":  # Stop #3：人工停止
                if run.state in (RunState.RUNNING, RunState.WAITING_APPROVAL):
                    run.transition(RunState.FAILED)
                return _REJECTED
            if not self.store.mark_executed(run.run_id, call_id):
                # 同一幂等键业务效果最多一次：重复提交/崩溃重放到此被拦截
                print(f"  ⏭️  {tc['name']} 幂等键命中({call_id})，跳过重复执行")
                return {"skipped": "already_executed", "idempotency_key": call_id}
        result = tool.handler(tc["arguments"])
        self.store.append(run.run_id, "tool_result",
                          {"step_id": step_id, "tool": tc["name"], "preview": str(result)[:200]})
        return result

    def _save_checkpoint(self, run_id: str, cursor: int, state: dict) -> None:
        state["budget_steps"] = self.budget.consumed_steps
        state["budget_cost"] = self.budget.consumed_cost
        ev = self.store.append(run_id, "checkpoint_saved", {"step_cursor": cursor})
        self.store.save_checkpoint(Checkpoint(run_id, cursor, dict(state), ev.seq))
