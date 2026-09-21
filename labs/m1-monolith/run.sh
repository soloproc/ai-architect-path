#!/usr/bin/env bash
# 一键启动：seed（若库为空）+ uvicorn。用法：bash run.sh
set -e
cd "$(dirname "$0")"
PY=${PYTHON:-python3}
$PY -m app.seed
exec $PY -m uvicorn app.main:app --host 0.0.0.0 --port 8000
