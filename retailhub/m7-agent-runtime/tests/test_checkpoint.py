"""Checkpoint 恢复测试：kill 后 resume，不重复已完成的 Step。

模拟篇05 §4.2 的场景：Run 跑到第 3 步前"进程被杀"，
新进程（新 Harness + 新 Provider）从最近 Checkpoint 恢复并跑完，
断言已完成的 Step 不会被重复执行，且预算守恒（Invariant #6）。
"""
import tempfile
import unittest
from pathlib import Path

from runtime.execution import EventStore, RunState
from runtime.harness import AgentHarness, ToolContract, ToolRegistry
from runtime.llm import MockProvider, ReliableExecutor

SCRIPT = [
    {"tool_calls": [{"name": "echo", "arguments": {"x": 1}}]},
    {"tool_calls": [{"name": "echo", "arguments": {"x": 2}}]},
    {"tool_calls": [{"name": "echo", "arguments": {"x": 3}}]},
    {"content": "完成"},
]


class CrashProvider:
    """第 3 次调用时模拟进程被杀（不是 LLM 故障，是整个 Worker 没了）。"""
    name = "crash"

    def __init__(self, inner: MockProvider):
        self.inner, self.calls = inner, 0

    def complete(self, req):
        self.calls += 1
        if self.calls == 3:
            raise RuntimeError("模拟宕机")
        return self.inner.complete(req)


def make_registry(executed: list) -> ToolRegistry:
    reg = ToolRegistry()

    def echo(a):
        executed.append(a["x"])
        return {"echo": a["x"]}

    reg.register(ToolContract("echo", "测试工具", {"type": "object"}, "low", echo))
    return reg


class TestCheckpointResume(unittest.TestCase):
    def test_resume_skips_completed_steps(self):
        with tempfile.TemporaryDirectory() as d:
            store = EventStore(Path(d) / "events.db")
            executed: list[int] = []

            # 阶段一：跑两步后"宕机"
            h1 = AgentHarness(ReliableExecutor(CrashProvider(MockProvider(SCRIPT))),
                              make_registry(executed), store)
            with self.assertRaises(RuntimeError):
                h1.run("任务", run_id="r1")
            self.assertEqual(executed, [1, 2])                    # 只完成了 2 步
            cp = store.latest_checkpoint("r1")
            self.assertIsNotNone(cp)
            self.assertEqual(cp.step_cursor, 2)                   # Checkpoint 打在 Step 边界

            # 阶段二：新 Harness（模拟新进程）从 Checkpoint 恢复
            h2 = AgentHarness(ReliableExecutor(MockProvider(SCRIPT)),
                              make_registry(executed), store)
            run = h2.run("任务", run_id="r1")
            self.assertEqual(run.state, RunState.COMPLETED)
            self.assertEqual(executed, [1, 2, 3])                 # step-1/2 未重复执行
            self.assertEqual(h2.budget.consumed_steps, 4)         # 预算守恒：含中断前 2 步

            # 事件流里能看到"中断 → 恢复"的完整叙事（Run Timeline）
            types = [e.type for e in store.events("r1")]
            self.assertEqual(types.count("run_started"), 2)       # 一次起跑 + 一次恢复
            self.assertEqual(types.count("checkpoint_saved"), 4)


if __name__ == "__main__":
    unittest.main()
