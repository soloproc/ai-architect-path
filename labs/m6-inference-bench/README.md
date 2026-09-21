# M6：推理服务压测与成本（对应《卷06 AI 基础设施》本卷实战 · 任务 1/2/3/7）

> 卷06 实战要求"起 OpenAI 兼容服务 → 压 TTFT/TPOT → 画容量曲线找拐点 →
> 算自建 vs 云成本"。有 GPU 的同学按教程用 vLLM/Ollama 起真实模型；
> 本目录的 **mock_server.py** 复刻 vLLM 的关键性能行为（批次槽位排队、
> prefill 与长度成正比、decode 带宽争抢），让没有 GPU 的学习者也能
> 把压测方法论完整走一遍。指标口径与教程 `ttft-tpot` Demo 及
> `bench_ttft.py` 骨架完全一致。

## 安装

```bash
cd retailhub
python3 -m venv .venv        # 若仓库根还没有的话
source .venv/bin/activate
pip install -r m6-inference-bench/requirements.txt
```

## 1. 起 mock 推理服务（对应实战任务 1 的无 GPU 替代）

```bash
python bench/mock_server.py --port 8000 --max-concurrent 8 --tpot-ms 25
# 关键旋钮：--max-concurrent 批次槽位(≈vLLM --max-num-seqs)
#           --prefill-ms-per-token  prefill 速率
#           --contention            批次满时 TPOT 放大的争抢系数
```

另开一个终端验证（对应验收标准第一条）：

```bash
curl -N http://localhost:8000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"retailhub-chat","stream":true,"max_tokens":32,
       "messages":[{"role":"user","content":"你好"}]}'
```

应看到 SSE 逐 chunk 流出，以 `data: [DONE]` 结束。

## 2. 压测（对应实战任务 2）

单档压测（8 并发 × 50 请求）：

```bash
python bench/load_test.py --concurrency 8 --requests 50 --prompt-tier medium
```

预期输出（mock 默认参数下）：

```
并发=  8  请求=  50  失败= 0  TTFT_P50≈排队+prefill  TTFT_P95=...  TPOT_avg≈33ms  聚合吞吐≈xxx tok/s
```

容量曲线扫描（对应教程 `concurrencies 1 4 8 16 32`，任务 3 找拐点）：

```bash
python bench/load_test.py --concurrencies 1 4 8 16 32 --requests-per-level 20 \
    --prompt-tier medium --csv curve.csv
# 同时生成 capacity_curve.json 与 curve.csv
```

**怎么读曲线（找拐点）**：并发从 1 升到槽位数（8）前，吞吐近似线性增长、
TTFT 平稳；超过槽位数后请求开始排队，TTFT_P95 陡增而吞吐不再增长——
拐点的并发数就是"单实例安全并发上限"（mock 默认参数下应在 8 附近；
换 `--prompt-tier long` 可观察 prefill 如何把拐点提前）。
与教程 `ttft-tpot` Demo 拖并发滑块看到的三条曲线一一对应。

### 画容量曲线（可选，需要 matplotlib）

```python
import json, matplotlib.pyplot as plt
rows = json.load(open("capacity_curve.json"))
x = [r["concurrency"] for r in rows]
fig, ax1 = plt.subplots()
ax1.plot(x, [r["ttft_p95"] * 1000 for r in rows], "o-", label="TTFT_P95 (ms)")
ax1.set_xlabel("concurrency"); ax1.set_ylabel("TTFT_P95 (ms)")
ax2 = ax1.twinx()
ax2.plot(x, [r["throughput"] for r in rows], "s--", color="orange", label="throughput (tok/s)")
ax2.set_ylabel("aggregate throughput (tok/s)")
fig.savefig("capacity_curve.png", bbox_inches="tight")
```

## 3. 成本计算（对应实战任务 7 备忘录的公式部分）

```bash
# 日 5000 万 token，standard 云档位，A100 12 元/卡时，利用率 35%
python bench/cost_calc.py --daily-tokens 50 --cloud-tier standard \
    --gpu a100 --gpu-price 12 --utilization 0.35
```

输出含：云月成本、自建实例数与月成本、每百万 token 单位成本、
盈亏平衡点（月用量达到多少时自建打平）、当前用量结论。
所有公式直接打印在输出里，写《自建 vs 云 API 成本对比备忘录》时照抄即可。

> ⚠️ `GPU_PROFILES` 与 `CLOUD_TIERS` 里的吞吐与单价是教学占位。
> 备忘录要求"实测数字"：请把压测容量曲线拐点处的实测聚合吞吐
> 替换进 `GPU_PROFILES`，并填入当时的真实云刊例价。

## 文件清单

| 文件 | 对应卷06 实战 |
| --- | --- |
| `bench/mock_server.py` | 任务 1（无 GPU 替代；复刻 continuous batching 排队/争抢行为） |
| `bench/load_test.py` | 任务 2/3（TTFT/TPOT/吞吐/P50/P95，CSV 导出，容量曲线数据） |
| `bench/cost_calc.py` | 任务 7（4.1/4.2 公式、盈亏平衡点、结论） |

## 常见报错 FAQ

- **压测全部失败，报 `Server disconnected without sending a response`**：
  你的系统代理把 localhost 请求也劫持了。`load_test.py` 已用 `trust_env=False`
  绕开系统代理；若你自己写 httpx 客户端遇到同样问题，照抄这个参数即可。
- **curl 看不到逐 chunk 流出、最后一次性返回**：漏了 `-N`（禁用缓冲）。
  正确姿势：`curl -N http://localhost:8000/v1/chat/completions ...`。
- **`Address already in use`**：`--port 8001` 换端口，压测时加
  `--base-url http://localhost:8001/v1`。
- **吞吐/延迟数字和 README 示例不同**：mock 的绝对数字随机器性能变化，
  验收看的是**拐点结构**——并发超过槽位数后 TTFT_P95 陡增、吞吐见顶。
- **`ModuleNotFoundError: No module named 'fastapi'`**：
  仓库根 `source .venv/bin/activate && pip install -r m6-inference-bench/requirements.txt`。
