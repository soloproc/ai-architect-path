#!/usr/bin/env bash
# M4 一键冒烟：单元测试 → 综合演示（限流+熔断+追踪）→ Outbox 演示。用法：bash run.sh
set -e
cd "$(dirname "$0")"
PY=${PYTHON:-python3}

echo "== 1/3 单元测试（熔断器 6 例 + 限流器 6 例）=="
$PY -m unittest discover -s tests
echo
echo "== 2/3 综合演示：限流 + 熔断 + 追踪 =="
$PY demo.py
echo
echo "== 3/3 Outbox 演示：不丢不重 =="
$PY src/outbox.py
echo
echo "✅ M4 冒烟完成。"
