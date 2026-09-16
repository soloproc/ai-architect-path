"""审批幂等测试：审批记录写库，重复提交不重复执行。

验证篇05 §4.3/§4.4 的三件套：Human Gate 持久化、审批结论作为事件写回、
副作用按幂等键去重——同一 tool_call_id 无论提交几次，业务效果只发生一次。
"""
import tempfile
import unittest
from pathlib import Path

from runtime.execution import EventStore, RunState, replay
from runtime.harness import AgentHarness, ToolContract, ToolRegistry
from runtime.llm import MockProvider, ReliableExecutor

TC = {"name": "create_ticket", "arguments": {"title": "排查直播转化率"}}
SCRIPT = [{"tool_calls": [TC]}, {"content": "完成"}]


class TestApprovalIdempotency(unittest.TestCase):
    def test_duplicate_approval_executes_once(self):
        with tempfile.TemporaryDirectory() as d:
            store = EventStore(Path(d) / "events.db")
            created: list[str] = []
            reg = ToolRegistry()
            reg.register(ToolContract("create_ticket", "建工单", {"type": "object"}, "high",
                                      lambda a: created.append(a["title"]) or {"ok": True}))
            # approver 自动批准（真实环境是人在控制台输入 y）
            h = AgentHarness(ReliableExecutor(MockProvider(SCRIPT)), reg, store,
                             approver=lambda req: True)
            run = h.run("诊断并建工单", run_id="r1")

            self.assertEqual(run.state, RunState.COMPLETED)
            self.assertEqual(created, ["排查直播转化率"])          # 副作用恰好一次
            call_id = "step-1:create_ticket"
            self.assertEqual(store.get_approval("r1", call_id), "approved")

            # 重复提交同一审批（崩溃重放/网络重试场景）：审批记录幂等
            self.assertFalse(store.record_approval("r1", call_id, "approved"))
            # 再次走到同一高风险工具：命中幂等键，跳过执行，不再打扰审批人
            result = h._execute_tool(run, "step-1", dict(TC))
            self.assertEqual(created, ["排查直播转化率"])          # 没有重复执行
            self.assertEqual(result["skipped"], "already_executed")

            # 事件流重放也能看到这次审批（状态即事件的结果）
            rebuilt = replay(store.events("r1"))
            self.assertEqual(rebuilt["approvals"], {call_id: "approved"})

    def test_rejection_stops_run(self):
        """审批拒绝 = 人工停止（Stop Condition #5），Run 转 FAILED。"""
        with tempfile.TemporaryDirectory() as d:
            store = EventStore(Path(d) / "events.db")
            reg = ToolRegistry()
            reg.register(ToolContract("create_ticket", "建工单", {"type": "object"}, "high",
                                      lambda a: {"ok": True}))
            h = AgentHarness(ReliableExecutor(MockProvider(SCRIPT)), reg, store,
                             approver=lambda req: False)          # 审批人拒绝
            run = h.run("诊断并建工单", run_id="r2")
            self.assertEqual(run.state, RunState.FAILED)
            self.assertEqual(store.get_approval("r2", "step-1:create_ticket"), "rejected")


if __name__ == "__main__":
    unittest.main()
