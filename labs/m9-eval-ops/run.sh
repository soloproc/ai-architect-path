#!/usr/bin/env bash
# M9 一键冒烟：单元测试 → 评测集体检 → 完整演示（基线 → 候选 → Gate 阻断）。用法：bash run.sh
set -e
cd "$(dirname "$0")"
PY=${PYTHON:-python3}

echo "== 1/3 单元测试（硬门槛/多trial/复现性/gate 规则）=="
$PY -m unittest discover -s tests
echo
echo "== 2/3 评测集 Task Taxonomy 配额体检 =="
$PY -m evals.dataset
echo
echo "== 3/3 完整演示：v1.0 建基线 → v1.1 越权回退 → Gate 阻断 =="
$PY demo.py
echo
echo "✅ M9 冒烟完成：Gate 决策应为 BLOCK，产物见 reports/。"
