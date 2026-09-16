"""load_test.py —— 推理服务并发压测：TTFT / TPOT / 吞吐 / P50 / P95。

对应卷06 实战任务 2（教程代码骨架 bench_ttft.py 的扩展版）。
口径与教程一致：TTFT 从发请求到第一个内容 chunk；TPOT 取相邻
内容 chunk 间隔的均值；聚合吞吐 = 总生成 token / 墙钟时间。
在教程骨架基础上增加：请求总数控制、prompt 长度档位、P50/P95 统计表、CSV 导出。

用法：
    # 单档压测：8 并发 × 50 请求，中等 prompt
    python bench/load_test.py --concurrency 8 --requests 50

    # 容量曲线：逐档扫描并发（对应教程 concurrencies 1 4 8 16 32）
    python bench/load_test.py --concurrencies 1 4 8 16 32 --requests-per-level 20 --csv curve.csv
"""
import argparse
import asyncio
import csv
import json
import statistics
import time

import httpx

# prompt 长度档位：同一任务，不同的 prefill 压力。
# 长 prompt 会显著推高 TTFT（prefill 与长度成正比），这是 RAG 场景的真实代价。
PROMPT_TIERS = {
    "short":  "请用三点概括零售企业分析同店销售增长时的关键维度。",                      # ~25 字
    "medium": "请用三点概括零售企业分析同店销售增长时的关键维度。" * 8,                  # ~200 字
    "long":   "请用三点概括零售企业分析同店销售增长时的关键维度。" * 32,                 # ~800 字
}
MAX_TOKENS = 128


def percentile(sorted_vals, p: float) -> float:
    """最近邻百分位。样本量小时 statistics.quantiles 会报错，这里更稳。"""
    if not sorted_vals:
        return float("nan")
    idx = min(len(sorted_vals) - 1, max(0, round(p / 100 * (len(sorted_vals) - 1))))
    return sorted_vals[idx]


async def one_request(client: httpx.AsyncClient, base: str, model: str, prompt: str):
    """发一个流式请求，采集 TTFT 与逐 token 间隔（对应教程 bench_ttft.py 的口径）。"""
    t0 = time.perf_counter()
    ttft, tokens, last = None, 0, t0
    tpot_samples = []
    payload = {
        "model": model,
        "stream": True,
        "max_tokens": MAX_TOKENS,
        "messages": [{"role": "user", "content": prompt}],
    }
    try:
        async with client.stream("POST", f"{base}/chat/completions", json=payload) as r:
            async for line in r.aiter_lines():
                if not line.startswith("data:") or line.endswith("[DONE]"):
                    continue
                now = time.perf_counter()
                delta = json.loads(line[5:])["choices"][0]["delta"].get("content")
                if delta:
                    if ttft is None:
                        ttft = now - t0          # 第一个内容 chunk 到达 → TTFT
                    else:
                        tpot_samples.append(now - last)   # 相邻 chunk 间隔 → TPOT
                    last, tokens = now, tokens + 1
    except Exception as e:  # 压测中单个请求失败不致命，记录后计入失败数
        return {"ok": False, "error": str(e)}
    return {
        "ok": True,
        "ttft": ttft,
        "tpot": statistics.mean(tpot_samples) if tpot_samples else None,
        "tokens": tokens,
        "e2e": time.perf_counter() - t0,
    }


async def run_level(base: str, model: str, prompt: str, concurrency: int, total: int):
    """固定并发度跑 total 个请求：N 个 worker 从计数器领任务。"""
    counter = {"left": total}
    lock = asyncio.Lock()

    async def worker(client):
        results = []
        while True:
            async with lock:
                if counter["left"] <= 0:
                    return results
                counter["left"] -= 1
            results.append(await one_request(client, base, model, prompt))

    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
        t0 = time.perf_counter()
        nested = await asyncio.gather(*[worker(client) for _ in range(concurrency)])
        wall = time.perf_counter() - t0

    results = [r for batch in nested for r in batch]
    ok = [r for r in results if r["ok"]]
    ttfts = sorted(r["ttft"] for r in ok)
    tpots = sorted(r["tpot"] for r in ok if r["tpot"] is not None)
    total_tokens = sum(r["tokens"] for r in ok)

    return {
        "concurrency": concurrency,
        "requests": len(results),
        "failed": len(results) - len(ok),
        "ttft_p50": percentile(ttfts, 50),
        "ttft_p95": percentile(ttfts, 95),
        "tpot_avg_ms": statistics.mean(tpots) * 1000 if tpots else float("nan"),
        "tpot_p95_ms": percentile(tpots, 95) * 1000 if tpots else float("nan"),
        "throughput": total_tokens / wall,       # 聚合吞吐 tok/s
        "wall_s": wall,
    }


def print_row(r: dict):
    print(
        f"并发={r['concurrency']:>3d}  请求={r['requests']:>4d}  失败={r['failed']:>2d}  "
        f"TTFT_P50={r['ttft_p50'] * 1000:>7.0f}ms  TTFT_P95={r['ttft_p95'] * 1000:>7.0f}ms  "
        f"TPOT_avg={r['tpot_avg_ms']:>5.0f}ms  TPOT_P95={r['tpot_p95_ms']:>5.0f}ms  "
        f"聚合吞吐={r['throughput']:>7.1f} tok/s"
    )


def export_csv(rows: list[dict], path: str):
    fields = ["concurrency", "requests", "failed", "ttft_p50", "ttft_p95",
              "tpot_avg_ms", "tpot_p95_ms", "throughput", "wall_s"]
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    print(f"已导出 CSV: {path}")


def main():
    ap = argparse.ArgumentParser(description="RetailHub 推理服务压测（TTFT/TPOT/吞吐）")
    ap.add_argument("--base-url", default="http://localhost:8000/v1")
    ap.add_argument("--model", default="retailhub-chat")
    ap.add_argument("--prompt-tier", choices=PROMPT_TIERS.keys(), default="medium",
                    help="prompt 长度档位：short/medium/long")
    # 单档模式：--concurrency 8 --requests 50
    ap.add_argument("--concurrency", type=int, help="单档压测的并发数")
    ap.add_argument("--requests", type=int, default=50, help="单档压测的总请求数")
    # 扫描模式：--concurrencies 1 4 8 16 32（对应教程容量曲线）
    ap.add_argument("--concurrencies", type=int, nargs="+",
                    help="并发扫描档位，给出则忽略 --concurrency")
    ap.add_argument("--requests-per-level", type=int, default=20,
                    help="扫描模式每档的请求数")
    ap.add_argument("--csv", help="把统计表导出为 CSV")
    args = ap.parse_args()

    prompt = PROMPT_TIERS[args.prompt_tier]
    levels = args.concurrencies or [args.concurrency or 8]
    per_level = args.requests_per_level if args.concurrencies else args.requests

    print(f"目标={args.base_url}  模型={args.model}  prompt档位={args.prompt_tier}"
          f"（{len(prompt)}字）  max_tokens={MAX_TOKENS}")
    print("-" * 108)
    rows = []
    for conc in levels:
        row = asyncio.run(run_level(args.base_url, args.model, prompt, conc, per_level))
        print_row(row)
        rows.append(row)
    print("-" * 108)
    if args.csv:
        export_csv(rows, args.csv)
    if args.concurrencies:
        with open("capacity_curve.json", "w", encoding="utf-8") as f:
            json.dump(rows, f, indent=2, ensure_ascii=False)
        print("容量曲线数据已写入 capacity_curve.json —— 找 TTFT_P95 突变/吞吐停止增长的拐点，"
              "那就是单实例安全并发上限。")


if __name__ == "__main__":
    main()
