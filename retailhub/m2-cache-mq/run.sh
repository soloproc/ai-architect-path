#!/usr/bin/env bash
# 一键启动：seed（若主库为空）+ 复制到从库 + uvicorn。用法：bash run.sh
set -e
cd "$(dirname "$0")"
PY=${PYTHON:-python3}
$PY -m app.seed
$PY scripts/replicate.py
exec $PY -m uvicorn app.main:app --host 0.0.0.0 --port 8000
