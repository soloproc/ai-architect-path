"""M9 · EvalOps 完整演示 —— 对应教程《篇09》全篇闭环。

剧情：
  1) 对被测系统 v1.0 跑 12 条评测集，全部硬门槛通过 → 冻结为 baseline.json；
  2) v1.1 "优化了 Prompt"：归因因子更全（质量 ↑）、成本更高（长 Prompt），
     但 Prompt 里一句"尽量满足用户的对比需求"导致跨租户越权回退（安全 ↓）；
  3) Regression Gate 必须正确阻断，并给出人可读的决策报告。

运行：cd m9-eval-ops && python demo.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))  # 支持 python demo.py 直接运行

from evals.dataset import load_cases, quota_report
from evals.gate import evaluate_gate
from evals.runner import BatchEvalRunner, brief
from evals.sut import MockDataAgent

REPORTS = Path(__file__).parent / "reports"


def show(card: dict) -> None:
    print(brief(card))
    for c in card["cases"]:
        mark = {"PASS": "✅", "FLAKY": "🌀", "FAIL": "❌"}[c["verdict"]]
        extra = f" 违规={c['violations']}" if c["violations"] else ""
        print(f"   {mark} {c['case_id']:<9} 质量={c['quality']:<6} 通过率={c['pass_rate']}{extra}")


def main() -> None:
    cases = load_cases()
    REPORTS.mkdir(exist_ok=True)
    print("=" * 70)
    print(f"M9 EvalOps 演示 · 评测集 {len(cases)} 条 × 每 Case 3 trials（Multi-Trial）")
    print(quota_report(cases))

    print("\n【第 1 步】被测系统 v1.0 —— 建立基线（冻结为 reports/baseline.json）")
    baseline = BatchEvalRunner(MockDataAgent("v1.0")).run(cases)
    show(baseline)
    (REPORTS / "baseline.json").write_text(
        json.dumps(baseline, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n【第 2 步】候选 v1.1（改了 Prompt：归因更全，但越权回退）")
    candidate = BatchEvalRunner(MockDataAgent("v1.1")).run(cases)
    show(candidate)
    (REPORTS / "candidate.json").write_text(
        json.dumps(candidate, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n【第 3 步】Regression Gate：baseline vs candidate")
    decision = evaluate_gate(baseline, candidate)
    report = decision.render()
    print(report)
    (REPORTS / "gate_report.md").write_text(report, encoding="utf-8")

    print("\n结论：v1.1 质量分更高，但 Gate 仍 BLOCK —— 硬门槛不被平均分掩盖。")
    print(f"产物：{REPORTS}/baseline.json, candidate.json, gate_report.md")


if __name__ == "__main__":
    main()
