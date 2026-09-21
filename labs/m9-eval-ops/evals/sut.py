"""M9 · 被测系统（SUT）适配层 —— 教学版使用确定性 MockDataAgent。

为什么 Mock：评测运行必须确定性（篇09 §9.2）。这里用规则脚本模拟被测系统
两个版本的行为差异：v1.0 是基线；v1.1 "改了 Prompt"——归因因子更全（质量 ↑）、
每步成本更高（长 Prompt），但在跨租户诱导下发生越权回退（安全 ↓）。
换成真实 M7 DataAgent 的方法见 README「把被测系统换成真实 DataAgent」：
只需实现同样的 run(case, fixture, seed) -> RunRecord 协议。
"""
from __future__ import annotations

import random
import zlib
from dataclasses import dataclass

from .dataset import EvalCase
from .fixture import Fixture, ToolFault

# 各版本"模型能力"：v1.0 只知主因子；v1.1 Prompt 优化后归因更全（质量差异的来源）
KNOWLEDGE = {
    "v1.0": {"east": ["直播", "转化率", "客单价"], "south": ["直播"], "north": []},
    "v1.1": {"east": ["直播", "转化率", "退款率", "客单价"], "south": ["直播", "转化率"], "north": []},
}
COST_PER_CALL = {"v1.0": 0.0004, "v1.1": 0.0006}  # v1.1 Prompt 更长，单步更贵


@dataclass
class RunRecord:
    """一次评测运行的完整证据：结构化答案 + 执行轨迹 + 环境终态 + 成本/时延。"""
    case_id: str
    version: str
    seed: int
    answer: dict        # {"factors","gmv_change_pct","text","evidence","suggestion"}
    trace: list[dict]   # tool 调用与 approval/retry 事件，TraceGrader 的判分对象
    env: dict           # Fixture.env_state()，EnvironmentGrader 的判分对象
    cost_usd: float
    latency_ms: int
    steps: int


def _rng(case_id: str, version: str, seed: int) -> random.Random:
    """确定性随机：同一 (case, 版本, seed) 永远得到同一序列 —— 评测可复现。"""
    return random.Random(zlib.crc32(f"{case_id}|{version}|{seed}".encode()))


class MockDataAgent:
    """规则脚本版 DataAgent：行为差异由版本驱动，完全确定性。"""

    def __init__(self, version: str):
        assert version in KNOWLEDGE, f"未知版本: {version}"
        self.version = version

    def run(self, case: EvalCase, fixture: Fixture, seed: int = 0) -> RunRecord:
        rng = _rng(case.id, self.version, seed)
        tenant = case.expected.get("tenant", "east")
        trace: list[dict] = []
        cost = 0.0

        def call(tool: str, **args) -> None:  # 记轨迹 + 记账
            nonlocal cost
            trace.append({"type": "tool", "tool": tool, "args": args})
            cost += COST_PER_CALL[self.version]

        def event(name: str, **kw) -> None:
            trace.append({"type": "event", "event": name, **kw})

        def use(tool: str, **args):  # 调工具桩；瞬时故障重试一次（优雅降级）
            call(tool, **args)
            try:
                return getattr(fixture, tool)(**args)
            except ToolFault:
                event("retry", tool=tool)
                call(tool, **args)
                return getattr(fixture, tool)(**args)

        # 1) 先查数据新鲜度，再取数（轨迹关键行为：先验证后分析）
        fresh = use("check_freshness", tenant=tenant)
        # 2) 跨租户诱导：v1.0 拒绝；v1.1 回退为顺从（安全回退剧情）
        crossed = False
        if case.task == "cross_tenant" and self.version == "v1.1":
            target = case.expected["forbidden_tenant"]
            call("query_orders", tenant=target)
            try:
                fixture.query_orders(target)
            except PermissionError:
                pass  # 权限网关拦下了，但"尝试"本身已构成违规证据
            crossed = True
        # 3) 取数与归因
        cur = use("query_orders", tenant=tenant, period="本周")
        prev = use("calc_metric", tenant=tenant, period="上周")
        change = round((cur["gmv"] / prev["gmv"] - 1) * 100, 1)
        factors = KNOWLEDGE[self.version].get(tenant, [])
        text = f"【结论】{tenant} 区 GMV 环比 {change}%，主因：{'/'.join(factors)}。"
        if not fresh["fresh"]:
            text += f"注意：数据延迟 {fresh['lag_hours']} 小时，结论降级为参考。"
        if case.task == "cross_tenant":
            text += "（已附外区对比数据）" if crossed else "已拒绝跨租户数据请求。"
        # 4) 副作用建议：建工单必须走审批；被拒绝则体面收尾
        if case.task in ("normal_diag", "approval_reject"):
            approved = case.expected.get("approval") != "reject"
            event("approval_requested", tool="create_ticket")
            event("approval_decided", decision="approved" if approved else "rejected")
            if approved:
                call("create_ticket", title="GMV 下滑排查工单")
                fixture.create_ticket("GMV 下滑排查工单", approved=True)
            else:
                text += "审批被拒绝：已取消执行，转为人工跟进。"
        evidence = [f"本周 GMV {cur['gmv']}", f"上周 GMV {prev['gmv']}"]
        if self.version == "v1.1":
            evidence.append("分渠道转化率对比")  # v1.1 证据链更完整
        steps = sum(1 for t in trace if t["type"] == "tool")
        return RunRecord(case.id, self.version, seed,
                         {"factors": factors, "gmv_change_pct": change, "text": text,
                          "evidence": evidence, "suggestion": "建议排查直播渠道投放与页面改动"},
                         trace, fixture.env_state(),
                         round(cost + rng.uniform(0, 0.0002), 6),
                         int(600 + 90 * len(trace) + rng.uniform(0, 120)), steps)
