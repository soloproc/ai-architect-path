"""mock_server.py —— OpenAI 兼容的 Mock 推理服务（无 GPU 也能跑压测）。

对应卷06 实战任务 1 的"无 GPU 开发机"替代：真实环境用 vLLM/Ollama，
本服务用 FastAPI + asyncio 复刻 vLLM 的关键性能行为，让压测脚本
（load_test.py）在没有 GPU 的笔记本上也能测出有意义的 TTFT/TPOT 曲线。

复刻了 vLLM Continuous Batching 的三个关键行为（这是压测曲线的来源）：
1. 并发上限（--max-concurrent，对应 vLLM 的 --max-num-seqs）：
   用 asyncio 信号量模拟"批次槽位"。槽位满了，新请求排队等待——
   排队时间会全部计入 TTFT，这就是并发升高时 TTFT 先恶化的原因。
2. Prefill 耗时与 prompt 长度成正比（--prefill-ms-per-token）：
   长 prompt 的首 token 更慢，TTFT = 排队 + prefill。
3. Decode 带宽争抢：批次越满，每个 token 的 TPOT 越慢
   （模拟显存带宽被并发序列瓜分），这是并发继续升高时
   TPOT 后恶化、吞吐不再增长的原因。

启动：
    python bench/mock_server.py --port 8000 --max-concurrent 8
验证：
    curl -N http://localhost:8000/v1/chat/completions \
      -H 'Content-Type: application/json' \
      -d '{"model":"retailhub-chat","stream":true,"max_tokens":32,
           "messages":[{"role":"user","content":"你好"}]}'
"""
import argparse
import asyncio
import json
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

app = FastAPI(title="RetailHub Mock Inference Server")

# 全局配置与状态（由 __main__ 里的 argparse 填充）
CFG = {
    "max_concurrent": 8,          # 连续批处理槽位数（≈ --max-num-seqs）
    "prefill_ms_per_token": 0.3,  # prefill 每 prompt token 的毫秒数
    "tpot_ms": 25.0,              # 基准 TPOT（单请求时每个 decode token 的毫秒数）
    "contention": 0.5,            # 带宽争抢系数：批次满时 TPOT 最多放大 (1+contention) 倍
}
semaphore = asyncio.Semaphore(CFG["max_concurrent"])
_active = 0          # 当前在批次中的序列数（用于计算带宽争抢）
_active_lock = asyncio.Lock()

# 生成内容用的教学向词表：每次从里面循环取"一个 token"
_FILLER = (
    "零售企业 分析 同店 销售 增长 时 需要 关注 客流 客单价 复购率 会员 贡献 "
    "以及 促销 弹性 库存 周转 与 门店 坪效 等 核心 维度 。"
).split()


def estimate_prompt_tokens(messages) -> int:
    """粗估 prompt token 数：中文约 1.5 字/token，加每条消息的开销。"""
    chars = sum(len(m.get("content", "")) for m in messages)
    return max(1, int(chars / 1.5)) + 4 * len(messages)


async def chat_completions_stream(body: dict):
    """按 OpenAI SSE 格式流式产出，时间行为模拟真实推理引擎。"""
    global _active
    messages = body.get("messages", [])
    max_tokens = int(body.get("max_tokens", 128))
    prompt_tokens = estimate_prompt_tokens(messages)
    req_id = "chatcmpl-" + uuid.uuid4().hex[:24]

    def chunk(delta: dict, finish=None):
        payload = {
            "id": req_id,
            "object": "chat.completion.chunk",
            "created": int(time.time()),
            "model": body.get("model", "retailhub-chat"),
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
        }
        return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

    # —— 阶段 0：排队等批次槽位（排队时间将全部体现为 TTFT 变长）——
    queue_start = time.perf_counter()
    async with semaphore:
        queued_ms = (time.perf_counter() - queue_start) * 1000
        async with _active_lock:
            _active += 1
        try:
            # —— 阶段 1：prefill。耗时正比于 prompt 长度 ——
            prefill_s = CFG["prefill_ms_per_token"] * prompt_tokens / 1000
            if prefill_s > 0:
                await asyncio.sleep(prefill_s)

            # 首 chunk：role（OpenAI 协议约定首个 chunk 只带 role）
            yield chunk({"role": "assistant", "content": ""})

            # —— 阶段 2：decode。批次越满，TPOT 越慢（带宽争抢）——
            for i in range(max_tokens):
                async with _active_lock:
                    load = _active / CFG["max_concurrent"]
                tpot_s = CFG["tpot_ms"] * (1 + CFG["contention"] * load) / 1000
                await asyncio.sleep(tpot_s)
                token = _FILLER[i % len(_FILLER)]
                # 中文 token 间加空格便于阅读；真实引擎由 tokenizer 决定
                yield chunk({"content": token + (" " if i % 5 == 4 else "")})

            yield chunk({}, finish="stop")
            yield "data: [DONE]\n\n"
        finally:
            async with _active_lock:
                _active -= 1


@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    body = await request.json()
    if not body.get("stream", False):
        # 教学聚焦流式指标（TTFT/TPOT 只在流式下有定义），非流式给个明确提示
        return {"error": "mock 服务只支持 stream=true，因为 TTFT/TPOT 是流式指标"}
    return StreamingResponse(chat_completions_stream(body), media_type="text/event-stream")


@app.get("/health")
async def health():
    return {"status": "ok", "config": CFG}


def main():
    import uvicorn

    ap = argparse.ArgumentParser(description="RetailHub mock 推理服务（OpenAI 兼容）")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--max-concurrent", type=int, default=8,
                    help="连续批处理槽位数，对应 vLLM --max-num-seqs")
    ap.add_argument("--prefill-ms-per-token", type=float, default=0.3,
                    help="prefill 每 prompt token 的毫秒数")
    ap.add_argument("--tpot-ms", type=float, default=25.0, help="基准 TPOT（毫秒）")
    ap.add_argument("--contention", type=float, default=0.5,
                    help="带宽争抢系数：批次满时 TPOT 放大倍数上限")
    args = ap.parse_args()

    CFG.update(
        max_concurrent=args.max_concurrent,
        prefill_ms_per_token=args.prefill_ms_per_token,
        tpot_ms=args.tpot_ms,
        contention=args.contention,
    )
    global semaphore
    semaphore = asyncio.Semaphore(args.max_concurrent)

    print(f"mock 推理服务启动: http://localhost:{args.port}/v1  config={CFG}")
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
