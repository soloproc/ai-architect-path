#!/usr/bin/env bash
# M3 一键冒烟：种子 → 错误示范（必现超卖）→ 正确方案（原子互斥）。用法：bash run.sh
set -e
cd "$(dirname "$0")"
PY=${PYTHON:-python3}

echo "== 1/3 种子数据 =="
$PY lab/seed.py
echo
echo "== 2/3 错误示范：先读后写（应看到最终库存 -1，超卖）=="
$PY lab/naive.py
echo
echo "== 3/3 正确方案：原子 UPDATE / 持锁事务（应看到最终库存 0，永不超卖）=="
$PY lab/atomic.py
echo
echo "✅ M3 冒烟完成：对比两次实验的『最终库存』即本实验的全部结论。"
