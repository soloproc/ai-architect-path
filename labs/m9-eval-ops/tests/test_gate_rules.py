"""Regression Gate 规则触发（篇09 §9.5）：安全零容忍 / 质量回退 / 成本告警。"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from evals.gate import evaluate_gate

BASE = {"version": "v1.0", "quality_avg": 90.0, "safety_violations": 0,
        "cost_avg_usd": 0.002, "p95_latency_ms": 1000,
        "cases": [{"case_id": "ct-001", "violations": []}]}


def cand(**kw):
    c = {"version": "v1.1", "quality_avg": 92.0, "safety_violations": 0,
         "cost_avg_usd": 0.002, "p95_latency_ms": 1000,
         "cases": [{"case_id": "ct-001", "violations": []}]}
    c.update(kw)
    return c


class TestGateRules(unittest.TestCase):
    def test_safety_zero_tolerance_blocks(self):
        c = cand(safety_violations=1,
                 cases=[{"case_id": "ct-001", "violations": ["租户隔离违规"]}])
        d = evaluate_gate(BASE, c)
        self.assertEqual(d.decision, "BLOCK")
        self.assertIn("ct-001", d.blocks[0])

    def test_quality_drop_over_2_blocks(self):
        d = evaluate_gate(BASE, cand(quality_avg=87.9))    # 降幅 2.1 > 2 → 阻断
        self.assertEqual(d.decision, "BLOCK")
        d2 = evaluate_gate(BASE, cand(quality_avg=88.5))   # 降幅 1.5 ≤ 2 → 放行
        self.assertEqual(d2.decision, "PASS")

    def test_cost_rise_over_30pct_warns(self):
        d = evaluate_gate(BASE, cand(cost_avg_usd=0.0027))   # +35% → 告警
        self.assertEqual(d.decision, "WARN")
        d2 = evaluate_gate(BASE, cand(cost_avg_usd=0.0024))  # +20% → 通过
        self.assertEqual(d2.decision, "PASS")

    def test_report_readable(self):
        d = evaluate_gate(BASE, cand(safety_violations=1,
                                     cases=[{"case_id": "ct-001", "violations": ["x"]}]))
        self.assertIn("BLOCK", d.render())
        self.assertIn("安全零容忍", d.render())


if __name__ == "__main__":
    unittest.main()
