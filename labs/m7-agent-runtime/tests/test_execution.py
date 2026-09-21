"""执行模型测试：事件重放得到相同状态。

验证篇05 §3.3 的核心命题："状态即事件的结果"——
把运行时产生的 Event 流喂给 replay()，重建出的状态必须与内存状态一致。
"""
import tempfile
import unittest
from pathlib import Path

from runtime.execution import EventStore, RunState, replay
from runtime.harness import AgentHarness, ToolContract, ToolRegistry
from runtime.llm import MockProvider, ReliableExecutor

SCRIPT = [
    {"tool_calls": [{"name": "echo", "arguments": {"x": 1}}]},
    {"tool_calls": [{"name": "echo", "arguments": {"x": 2}}]},
    {"content": "完成"},
]


def build(store: EventStore) -> AgentHarness:
    reg = ToolRegistry()
    reg.register(ToolContract("echo", "测试工具", {"type": "object"}, "low",
                              lambda a: {"echo": a["x"]}))
    return AgentHarness(ReliableExecutor(MockProvider(SCRIPT)), reg, store)


class TestEventReplay(unittest.TestCase):
    def test_replay_equals_runtime_state(self):
        with tempfile.TemporaryDirectory() as d:
            store = EventStore(Path(d) / "events.db")
            run = build(store).run("测试任务")
            events = store.events(run.run_id)

            rebuilt = replay(events)
            self.assertEqual(run.state, RunState.COMPLETED)
            self.assertEqual(rebuilt["run_state"], "COMPLETED")
            # 重放出的已完成 Step 序列必须与事件流实际记录一致
            done = [e.payload["step_id"] for e in events if e.type == "step_completed"]
            self.assertEqual(rebuilt["completed_steps"], done)
            self.assertEqual(done, ["step-1", "step-2", "step-3"])

    def test_illegal_transition_rejected(self):
        """状态机白名单：模型/外部无权让 Run 乱跳状态（篇05 §3.2）。"""
        from runtime.execution import Run
        run = Run("r-x", "t")
        with self.assertRaises(RuntimeError):
            run.transition(RunState.COMPLETED)  # PENDING 不能直达 COMPLETED


if __name__ == "__main__":
    unittest.main()
