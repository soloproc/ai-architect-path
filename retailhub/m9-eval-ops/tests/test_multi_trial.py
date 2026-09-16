"""Multi-Trial 通过率计算（篇09 §9.3）：3 次 trial 过 2 次 → pass_rate=2/3, FLAKY。"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from evals.dataset import load_cases
from evals.runner import BatchEvalRunner
from evals.sut import MockDataAgent


class FlakySUT:
    """包装 v1.0：第 2 次 trial（seed=1）模拟质量崩塌。"""
    version = "flaky"

    def __init__(self):
        self.base = MockDataAgent("v1.0")

    def run(self, case, fixture, seed=0):
        rec = self.base.run(case, fixture, seed)
        if seed == 1:
            rec.answer = {"factors": [], "text": "", "evidence": [], "suggestion": ""}
        return rec


class TestMultiTrial(unittest.TestCase):
    def test_pass_rate_two_of_three(self):
        case = next(c for c in load_cases() if c.id == "diag-001")
        card = BatchEvalRunner(FlakySUT(), trials=3).run([case])["cases"][0]
        self.assertAlmostEqual(card["pass_rate"], 2 / 3, places=3)
        self.assertEqual(card["verdict"], "FLAKY")     # 部分通过 = 不稳定信号

    def test_stable_case_full_pass(self):
        case = next(c for c in load_cases() if c.id == "diag-001")
        card = BatchEvalRunner(MockDataAgent("v1.0"), trials=3).run([case])["cases"][0]
        self.assertEqual(card["pass_rate"], 1.0)
        self.assertEqual(card["verdict"], "PASS")


if __name__ == "__main__":
    unittest.main()
