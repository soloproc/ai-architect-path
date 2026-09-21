/* lab-m6 —— "M6 · 并发-延迟容量曲线找拐点"
 * 「在线运行」入口：动态加载 lab-runner.js（已加载则直接用），
 * 然后调 window.LABRUNNER 渲染可折叠的浏览器内 Python 运行面板。
 * code 为「在线逻辑版」（仅标准库）；expected 为本地 python3 实跑的真实输出。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['lab-m6'] = function (container) {
  var CONFIG = {
    title: "M6 · 并发-延迟容量曲线找拐点",
    subtitle: "对应卷06-2 实战 · 与 labs/m6-inference-bench 的 mock_server 同口径参数：槽位 8、prefill 正比长度、批次争抢放大 TPOT，纯算法扫出 TTFT 拐点。",
    code: "# ============================================================\n# 在线逻辑版 · M6 推理压测：并发-延迟容量曲线找拐点\n# （对应卷06-2 实战，真实源码 labs/m6-inference-bench 用 mock_server +\n#   load_test 实测；浏览器里不起服务，用同一组参数做离散事件模拟）\n# 模型与 mock_server.py 完全同口径：\n#   槽位 = 8（≈ vLLM --max-num-seqs），prefill 与 prompt 长度成正比，\n#   decode 阶段批次越满 TPOT 越慢（带宽争抢），排队时间全部计入 TTFT\n# ============================================================\nimport heapq\n\n# —— mock_server.py 默认参数 ——\nSLOTS = 8                  # 连续批处理槽位\nPREFILL_MS_PER_TOKEN = 0.3\nTPOT_MS = 25.0             # 基准 TPOT\nCONTENTION = 0.5           # 批次满时 TPOT 最多放大 (1+0.5) 倍\nPROMPT_TOKENS = 137        # medium 档 prompt（约 200 字）\nMAX_TOKENS = 128           # 每请求生成 token 数\nN_REQUESTS = 20            # 每档并发各压 20 个请求\n\ndef percentile(sorted_vals, p):\n    idx = min(len(sorted_vals) - 1, max(0, round(p / 100 * (len(sorted_vals) - 1))))\n    return sorted_vals[idx]\n\ndef simulate(concurrency):\n    \"\"\"闭环压测：C 个并发 worker 循环发 N_REQUESTS 个请求；\n    服务端只有 SLOTS 个批次槽位，抢不到槽位的请求排队（排队计入 TTFT）\"\"\"\n    prefill = PREFILL_MS_PER_TOKEN * PROMPT_TOKENS\n    load = min(concurrency, SLOTS) / SLOTS          # 批次负载率\n    tpot = TPOT_MS * (1 + CONTENTION * load)        # 争抢放大后的 TPOT\n    service = prefill + MAX_TOKENS * tpot           # 一个请求占槽位的总时长\n    workers = [0.0] * concurrency                   # 每个 worker 的空闲时刻\n    slots = [0.0] * SLOTS                           # 每个槽位的空闲时刻\n    ttfts, last_finish = [], 0.0\n    for _ in range(N_REQUESTS):\n        send = heapq.heappop(workers)               # worker 空闲才发请求（闭环）\n        slot_free = heapq.heappop(slots)            # 等一个批次槽位\n        start = max(send, slot_free)\n        ttfts.append(start - send + prefill + tpot)  # TTFT = 排队 + prefill + 首 token\n        finish = start + service\n        last_finish = max(last_finish, finish)\n        heapq.heappush(workers, finish)\n        heapq.heappush(slots, finish)\n    tput = N_REQUESTS * MAX_TOKENS / (last_finish / 1000)   # 聚合吞吐 tok/s\n    return sorted(ttfts), tput\n\nprint(\"并发-延迟容量曲线（每档 %d 请求，槽位 = %d）\" % (N_REQUESTS, SLOTS))\nprint(\"  并发   TTFT_P50   TTFT_P95   聚合吞吐(tok/s)\")\nbase = None\nfor c in [1, 4, 8, 16, 32]:\n    ttfts, tput = simulate(c)\n    p50, p95 = percentile(ttfts, 50), percentile(ttfts, 95)\n    if c == SLOTS:\n        base = p95\n    mark = \"   ← 拐点之后：TTFT 陡增，吞吐见顶\" if base and p95 > 2 * base else \"\"\n    print(\"  %4d   %8.1f   %8.1f   %12.1f%s\" % (c, p50, p95, tput, mark))\n\nprint(\"\")\nprint(\"怎么读这条曲线（与教程 ttft-tpot Demo 的三条曲线一一对应）：\")\nprint(\"  · 并发 <= 槽位数：吞吐近似线性增长，TTFT 平稳（排队≈0）\")\nprint(\"  · 并发 >  槽位数：请求开始排队，TTFT_P95 陡增而吞吐见顶\")\nprint(\"  · 拐点并发数 ≈ 单实例安全并发上限；长 prompt 会把拐点提前\")\nprint(\"  真实环境用 vLLM/Ollama + labs/m6-inference-bench 实测同样这条曲线\")\n",
    expected: "并发-延迟容量曲线（每档 20 请求，槽位 = 8）\n  并发   TTFT_P50   TTFT_P95   聚合吞吐(tok/s)\n     1       67.7       67.7           37.2\n     4       72.3       72.3          126.7\n     8       78.6       78.6          176.3\n    16     4919.7     4919.7          176.3   ← 拐点之后：TTFT 陡增，吞吐见顶\n    32     4919.7     9760.8          176.3   ← 拐点之后：TTFT 陡增，吞吐见顶\n\n怎么读这条曲线（与教程 ttft-tpot Demo 的三条曲线一一对应）：\n  · 并发 <= 槽位数：吞吐近似线性增长，TTFT 平稳（排队≈0）\n  · 并发 >  槽位数：请求开始排队，TTFT_P95 陡增而吞吐见顶\n  · 拐点并发数 ≈ 单实例安全并发上限；长 prompt 会把拐点提前\n  真实环境用 vLLM/Ollama + labs/m6-inference-bench 实测同样这条曲线"
  };
  if (typeof window.LABRUNNER === 'function') {
    window.LABRUNNER(container, CONFIG);
    return;
  }
  var s = document.createElement('script');
  s.src = 'assets/demos/lab-runner.js';
  s.onload = function () { window.LABRUNNER(container, CONFIG); };
  s.onerror = function () {
    container.innerHTML = '<div class="demo-error">在线运行组件加载失败，可查看本地文件 assets/demos/lab-runner.js</div>';
  };
  document.head.appendChild(s);
};
