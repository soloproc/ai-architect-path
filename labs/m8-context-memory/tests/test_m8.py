"""M8 · 治理行为测试 —— 每条对应教程的一条安全/治理不变量。

运行：python3 -m unittest discover -s tests -v
"""
from __future__ import annotations

import unittest

from context_eng.assembler import (AssembleRequest, ContextAssembler,
                                   TenantProvider)
from context_eng.schema import ContextItem, Source
from memory_eng.pipeline import Candidate, MemoryWritePipeline
from memory_eng.recall import (RecallContract, RecallIntent, SecurityContext,
                               UsageTrace, governed_recall)
from memory_eng.store import (EvidenceStore, MemoryStatus, MemoryStore,
                              Scope, VectorIndex)

T = "tenant_a"


def item(iid, content, tenant=T, zone="evidence", **kw):
    return ContextItem(iid, content, Source.KNOWLEDGE, tenant, zone, **kw)


def assemble(items, budgets=None, query="GMV 诊断"):
    req = AssembleRequest(run_id="r1", tenant_id=T, role="analyst", step="planning",
                          query=query, budgets=budgets or
                          {"rules": 100, "task": 100, "state": 100,
                           "semantic": 100, "evidence": 60, "output": 100})
    return ContextAssembler([TenantProvider(items)]).assemble(req)


def candidate(subject, content_key="preference", content_val="报告要同比表格"):
    return Candidate(mem_type="user_preference",
                     content={"subject": subject, content_key: content_val},
                     scope=Scope(T, "u1"), provenance={"run_id": "r1"},
                     evidence_ref="ev://r1/e1", source_event="user_feedback",
                     signal="explicit")


class TestHardFilterUnbypassable(unittest.TestCase):
    """篇06 §3.2：硬过滤不可被相关性绕过——再相关，跨租户也出局。"""

    def test_high_relevance_cross_tenant_rejected(self):
        evil = item("neighbor", "GMV 诊断 GMV 诊断 GMV 诊断", tenant="tenant_b")
        keep = item("metric", "gmv 口径", zone="semantic", required=True)
        packed, trace = assemble([evil, keep] + [
            item("r", "规则", zone="rules", required=True),
            item("t", "任务", zone="task", required=True)])
        self.assertNotIn("neighbor", {c.item_id for c in packed})
        self.assertIn("拒绝: 跨租户", trace.report())


class TestBudgetKeepsRules(unittest.TestCase):
    """篇06 §3.3：必需信息优先保底——预算挤压时 rules 区不丢。"""

    def test_rules_survive_squeeze(self):
        items = [item("r", "规则", zone="rules", required=True),
                 item("t", "任务", zone="task", required=True),
                 item("m", "gmv 口径", zone="semantic", required=True)]
        # evidence 区塞入 9 条高相关性候选，试图挤占窗口
        items += [item(f"e{i}", "GMV 诊断 " + "数据" * 50) for i in range(9)]
        packed, _ = assemble(items)
        zones = {c.item_id: c.zone for c in packed}
        self.assertEqual(zones.get("r"), "rules")
        self.assertEqual(zones.get("t"), "task")
        self.assertEqual(zones.get("m"), "semantic")


class TestWritePipeline(unittest.TestCase):
    """篇08 §2.4/§2.5：写入幂等（重放不产生重复）与冲突版本治理。"""

    def setUp(self):
        self.pipe = MemoryWritePipeline(MemoryStore(), VectorIndex(), EvidenceStore())

    def test_idempotent_replay(self):
        c = candidate("report_format")
        r1 = self.pipe.submit(c, "req-1")
        r2 = self.pipe.submit(c, "req-1")          # 同幂等键重放
        self.assertEqual(r1.decision, "committed")
        self.assertEqual(r2.decision, "duplicate")
        self.assertEqual(len(self.pipe.store.all_records()), 1)

    def test_conflict_versioning(self):
        old = candidate("report_format", content_val="报告要环比表格")
        new = candidate("report_format", content_val="报告要同比表格")
        r1 = self.pipe.submit(old, "req-1")
        r2 = self.pipe.submit(new, "req-2")
        self.assertEqual(r2.decision, "superseded")
        recs = {r.memory_id: r for r in self.pipe.store.all_records()}
        self.assertEqual(recs[r2.memory_id].version, 2)
        self.assertEqual(recs[r1.memory_id].status, MemoryStatus.SUPERSEDED)


class TestRecallExcludesDeleted(unittest.TestCase):
    """篇08 §4.3：删除传播——主库置 deleted + 向量索引同步删除后不可召回。"""

    def test_deleted_memory_not_recalled(self):
        pipe = MemoryWritePipeline(MemoryStore(), VectorIndex(), EvidenceStore())
        r = pipe.submit(candidate("report_format"), "req-1")
        # 删除传播两层：主库状态 + 向量索引（篇08 §4.3 的最常见残留点）
        pipe.store.set_status(r.memory_id, MemoryStatus.DELETED)
        pipe.index.delete(r.memory_id)
        got = governed_recall(RecallContract(RecallIntent.REPORTING, "同比表格"),
                              SecurityContext(T, "u1"), pipe.store, pipe.index,
                              UsageTrace())
        self.assertEqual(got, [])

    def test_cross_tenant_not_recalled(self):
        """篇08 §3.2：Scope 硬过滤——语义再像，跨租户也不召回。"""
        pipe = MemoryWritePipeline(MemoryStore(), VectorIndex(), EvidenceStore())
        pipe.submit(candidate("report_format"), "req-1")
        got = governed_recall(RecallContract(RecallIntent.REPORTING, "同比表格"),
                              SecurityContext("tenant_b", "u9"), pipe.store,
                              pipe.index, UsageTrace())
        self.assertEqual(got, [])


if __name__ == "__main__":
    unittest.main()
