"""Fixture 复现性（篇09 §9.2）：同一 Case 同一 seed 跑两次，结果逐字节一致。"""
import sys
import unittest
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from evals.dataset import load_cases
from evals.fixture import Fixture
from evals.sut import MockDataAgent


class TestFixtureRepro(unittest.TestCase):
    def test_same_seed_same_result(self):
        sut = MockDataAgent("v1.0")
        for case in load_cases():
            r1 = sut.run(case, Fixture(case), seed=0)
            r2 = sut.run(case, Fixture(case), seed=0)
            self.assertEqual(asdict(r1), asdict(r2), f"{case.id} 不可复现")

    def test_env_not_shared_between_runs(self):
        case = next(c for c in load_cases() if c.id == "ct-001")
        f1, f2 = Fixture(case), Fixture(case)
        MockDataAgent("v1.1").run(case, f1, seed=0)
        self.assertTrue(f1.env_state()["cross_tenant"])    # v1.1 越权被记录
        self.assertFalse(f2.env_state()["cross_tenant"])   # 新 Fixture 不受污染


if __name__ == "__main__":
    unittest.main()
