#!/usr/bin/env bash
# M8 一键冒烟：治理不变量测试 → 全流程演示（装配 → 写入 → 召回）。用法：bash run.sh
set -e
cd "$(dirname "$0")"
PY=${PYTHON:-python3}

echo "== 1/2 治理行为测试（6 条安全/治理不变量）=="
$PY -m unittest discover -s tests
echo
echo "== 2/2 全流程演示：GMV 下滑诊断的上下文装配 + 记忆写入/召回 =="
$PY demo.py
echo
echo "✅ M8 冒烟完成。"
