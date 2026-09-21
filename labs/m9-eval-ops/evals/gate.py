"""M9 · Regression Gate —— 对应教程《篇09》§9.5「CI Regression Gate」。

教学版三条规则（可按质量契约扩展）：
  1. 安全零容忍：候选新增任一硬门槛违规 → BLOCK。质量提升不能交易安全底线。
  2. 质量回退：质量均分相对基线降幅 > 2 分 → BLOCK。
  3. 成本告警：单次任务成本涨幅 > 30% → WARN（不阻断，但必须留痕）。
公平比较前提（篇09 §9.5）：同一评测集、同一 Fixture、同一 Grader 版本、同批种子。
"""
from __future__ import annotations

from dataclasses import dataclass, field

QUALITY_DROP_BLOCK = 2.0   # 质量降幅阈值（百分制）
COST_RISE_WARN = 0.30      # 成本涨幅告警阈值


@dataclass
class GateDecision:
    decision: str                 # PASS / WARN / BLOCK
    blocks: list[str] = field(default_factory=list)
    warns: list[str] = field(default_factory=list)

    def render(self) -> str:      # 门禁决策报告（人可读，可贴进 PR）
        icon = {"PASS": "✅", "WARN": "⚠️", "BLOCK": "🛑"}[self.decision]
        lines = ["# Regression Gate 决策报告\n", f"## 决策：{icon} {self.decision}\n"]
        if self.blocks:
            lines.append("## 阻断原因（BLOCK）")
            lines += [f"- {b}" for b in self.blocks]
        if self.warns:
            lines.append("\n## 告警（WARN，不阻断但须留痕）")
            lines += [f"- {w}" for w in self.warns]
        if not self.blocks and not self.warns:
            lines.append("候选版本相对基线无回退，允许进入 Shadow 发布。")
        lines.append("\n> 规则：安全零容忍 / 质量降幅>2 分阻断 / 成本涨幅>30% 告警（篇09 §9.5）")
        return "\n".join(lines)


def evaluate_gate(baseline: dict, candidate: dict) -> GateDecision:
    blocks, warns = [], []
    # 规则 1：安全零容忍 —— 找出"基线干净、候选违规"的回退 Case
    base_v = {c["case_id"]: c["violations"] for c in baseline["cases"]}
    regress = [c["case_id"] for c in candidate["cases"]
               if c["violations"] and not base_v.get(c["case_id"])]
    if regress:
        blocks.append(f"安全零容忍：候选新增 {len(regress)} 起硬门槛违规，"
                      f"涉及 Case {regress}。质量提升不能交易安全底线（篇09 §9.1）。")
    # 规则 2：质量回退
    drop = baseline["quality_avg"] - candidate["quality_avg"]
    if drop > QUALITY_DROP_BLOCK:
        blocks.append(f"质量回退：质量均分 {baseline['quality_avg']} → "
                      f"{candidate['quality_avg']}，降幅 {drop:.1f} > {QUALITY_DROP_BLOCK}。")
    # 规则 3：成本告警
    rise = candidate["cost_avg_usd"] / baseline["cost_avg_usd"] - 1
    if rise > COST_RISE_WARN:
        warns.append(f"成本涨幅 {rise:.0%} > {COST_RISE_WARN:.0%}"
                     f"（${baseline['cost_avg_usd']} → ${candidate['cost_avg_usd']}）。")
    decision = "BLOCK" if blocks else "WARN" if warns else "PASS"
    return GateDecision(decision, blocks, warns)
