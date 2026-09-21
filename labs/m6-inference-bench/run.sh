#!/usr/bin/env bash
# M6 一键冒烟：起 mock 推理服务 → SSE 验证 → 单档压测 → 成本计算。用法：bash run.sh
set -e
cd "$(dirname "$0")"
PY=${PYTHON:-python3}
PORT=${PORT:-8000}

echo "== 1/4 启动 mock 推理服务（后台，端口 $PORT）=="
$PY bench/mock_server.py --port "$PORT" &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
sleep 2
curl -s "http://localhost:$PORT/health"; echo

echo "== 2/4 SSE 流式冒烟（应看到 data: 逐 chunk 流出，以 [DONE] 结束）=="
curl -sN "http://localhost:$PORT/v1/chat/completions" \
  -H 'Content-Type: application/json' \
  -d '{"model":"retailhub-chat","stream":true,"max_tokens":4,"messages":[{"role":"user","content":"你好"}]}'
echo

echo "== 3/4 单档压测（4 并发 × 10 请求）=="
$PY bench/load_test.py --base-url "http://localhost:$PORT/v1" \
  --concurrency 4 --requests 10 --prompt-tier short
echo

echo "== 4/4 自建 vs 云成本计算 =="
$PY bench/cost_calc.py --daily-tokens 50 --cloud-tier standard \
  --gpu a100 --gpu-price 12 --utilization 0.35
echo
echo "✅ M6 冒烟完成（mock 服务已自动关闭）。容量曲线扫描见 README 第 2 节。"
