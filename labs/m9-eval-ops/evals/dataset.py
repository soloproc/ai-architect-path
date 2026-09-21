"""M9 · 评测数据集 —— 对应教程《篇09》§9.2「Task Taxonomy 与 Eval Case」。

要点：
  - 开放式任务没有唯一标准答案，验收对象是 expected 里的结构化验收点
    （因子关键词、数值容差、必须声明的降级、禁止的越权目标），而非全文匹配；
  - 示例集按 Task Taxonomy 配额采样：正常诊断 4 / 数据缺失 2 / 工具故障 2 /
    跨租户越权 2 / 审批拒绝 2 —— 长尾类别对应硬门槛，一个都不能缺；
  - 数据存 JSONL（cases.jsonl）与代码分离，便于 Dev/Validation/Held-out 分层治理。

运行 `python -m evals.dataset` 查看分类配额分布。
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

CASES_PATH = Path(__file__).parent / "cases.jsonl"

TAXONOMY = {  # 任务分类学：类别 -> (说明, 最低配额)
    "normal_diag":     ("常规诊断：主干路径，验证基本能力", 4),
    "data_missing":    ("数据异常：数据延迟/缺失，应声明并降级", 2),
    "tool_fault":      ("工具故障：外部依赖失败，应重试并优雅报错", 2),
    "cross_tenant":    ("对抗/越权：诱导读取其他租户数据（硬门槛）", 2),
    "approval_reject": ("审批流：副作用操作被拒绝后应体面收尾（硬门槛）", 2),
}


@dataclass
class EvalCase:
    """一条评测用例。字段与篇09 §9.2 的 EvalCase 骨架对齐（教学版简化）。"""
    id: str                     # 例 "diag-001"
    task: str                   # Task Taxonomy 类别，见 TAXONOMY
    input: str                  # 原始业务请求（用户原话）
    expected: dict              # 结构化验收点（factor_keywords / max_steps / hard_gates ...）
    tags: list[str] = field(default_factory=list)
    difficulty: str = "medium"  # easy / medium / hard

    @property
    def hard_gates(self) -> list[str]:
        """引用质量契约中的一票否决条款（见 templates/quality_contract.md）。"""
        return self.expected.get("hard_gates", [])


def load_cases(path: Path = CASES_PATH) -> list[EvalCase]:
    """加载 JSONL 评测集并做防御性校验：id 唯一、类别合法。"""
    cases = [EvalCase(**json.loads(line))
             for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    ids = [c.id for c in cases]
    assert len(ids) == len(set(ids)), f"评测集 id 重复: {ids}"
    for c in cases:
        assert c.task in TAXONOMY, f"{c.id} 类别非法: {c.task}"
    return cases


def quota_report(cases: list[EvalCase]) -> str:
    """Task Taxonomy 配额体检：长尾类别（对应硬门槛）一个都不能缺。"""
    lines = []
    for task, (desc, quota) in TAXONOMY.items():
        n = sum(1 for c in cases if c.task == task)
        mark = "✅" if n >= quota else "❌"
        lines.append(f"  {mark} {task:<16} {n}/{quota}  {desc}")
    return "\n".join(lines)


def main() -> None:
    cases = load_cases()
    print(f"评测集共 {len(cases)} 条（{CASES_PATH.name}），Task Taxonomy 配额：")
    print(quota_report(cases))


if __name__ == "__main__":
    main()
