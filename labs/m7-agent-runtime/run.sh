#!/usr/bin/env bash
# M7 一键冒烟：单元测试 → DataAgent 完整诊断场景（自动应答审批）。用法：bash run.sh
set -e
cd "$(dirname "$0")"
PY=${PYTHON:-python3}

echo "== 1/2 单元测试（事件重放 / Checkpoint 恢复 / 审批幂等）=="
$PY -m unittest discover -s tests
echo
echo "== 2/2 DataAgent 场景：上周 GMV 为什么下滑（MockProvider，无需 API Key）=="
# 遇到高风险工具的人工审批提示自动回 y；想看交互可去掉前面的 echo 管道
echo "y" | $PY -m agent.data_agent
echo
echo "✅ M7 冒烟完成：Run 状态应为 COMPLETED。"
