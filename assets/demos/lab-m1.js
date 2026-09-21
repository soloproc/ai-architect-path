/* lab-m1 —— "M1 · GMV 口径汇总（sqlite3 建表 + 种子 + SUM/CASE WHEN）"
 * 「在线运行」入口：动态加载 lab-runner.js（已加载则直接用），
 * 然后调 window.LABRUNNER 渲染可折叠的浏览器内 Python 运行面板。
 * code 为「在线逻辑版」（仅标准库）；expected 为本地 python3 实跑的真实输出。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['lab-m1'] = function (container) {
  var CONFIG = {
    title: "M1 · GMV 口径汇总（sqlite3 建表 + 种子 + SUM/CASE WHEN）",
    subtitle: "对应卷01-2 实战 · labs/m1-monolith 的数据库核心：建表 → 确定性种子 → 「GMV 不计退款」口径汇总（ADR 0001）。浏览器内运行，仅标准库。",
    code: "# ============================================================\n# 在线逻辑版 · M1 单体服务：建表 + 种子 + GMV 口径汇总\n# （对应卷01-2 实战，真实源码 labs/m1-monolith 是 FastAPI + SQLite 服务）\n# 浏览器里起不了 HTTP 服务，这里提炼其数据库核心：\n#   sqlite3 建 items/orders 表 → 确定性种子 → 按「GMV 不计退款」口径汇总\n# ============================================================\nimport sqlite3\nimport random\nfrom datetime import datetime, timedelta\n\nconn = sqlite3.connect(\":memory:\")\nconn.execute(\"CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, category TEXT, price REAL)\")\nconn.execute(\"\"\"CREATE TABLE orders (\n    id INTEGER PRIMARY KEY, user_id INT, store_id INT,\n    status TEXT, amount REAL, created_at TEXT)\"\"\")\n\n# 确定性种子：random.seed(42)，任何人跑出的验收数字一致（与 labs 同一约定）\nrng = random.Random(42)\ncats = [\"饮品\", \"零食\", \"生鲜\", \"日百\", \"烘焙\"]\nitems = [(i, \"商品-%02d\" % i, cats[(i - 1) % 5], round(rng.uniform(3, 300), 2))\n         for i in range(1, 51)]\nconn.executemany(\"INSERT INTO items VALUES (?,?,?,?)\", items)\n\nstart = datetime(2025, 6, 1)\norders = []\nfor oid in range(1, 5001):           # 与 labs 完整版同为 5000 单，验收数字对齐\n    created = start + timedelta(days=rng.randrange(30),\n                                hours=rng.randrange(8, 22),\n                                minutes=rng.randrange(60))\n    status = \"refunded\" if rng.random() < 0.1 else \"paid\"   # 约 1/10 退款单\n    amount = round(rng.uniform(10, 500), 2)\n    orders.append((oid, rng.randint(1, 2000), rng.randint(1, 20),\n                   status, amount, created.strftime(\"%Y-%m-%d %H:%M:%S\")))\nconn.executemany(\"INSERT INTO orders VALUES (?,?,?,?,?,?)\", orders)\nprint(\"种子完成：商品 %d 个，订单 %d 张（2025-06-01 ~ 06-30，约 1/10 退款）\"\n      % (len(items), len(orders)))\n\n# GMV 口径（对应源码 docs/adr/0001）：refunded 订单不计入 GMV\nrow = conn.execute(\"\"\"\n    SELECT SUM(CASE WHEN status != 'refunded' THEN 1 ELSE 0 END) AS paid_cnt,\n           SUM(CASE WHEN status  = 'refunded' THEN 1 ELSE 0 END) AS refunded_cnt,\n           ROUND(SUM(CASE WHEN status != 'refunded' THEN amount ELSE 0 END), 2) AS gmv\n    FROM orders WHERE substr(created_at, 1, 10) = '2025-06-01'\n\"\"\").fetchone()\npaid_cnt, refunded_cnt, gmv = row\nprint(\"\")\nprint(\"验收口径 · 2025-06-01 单日汇总：\")\nprint(\"  有效订单数        = %d（另剔除退款 %d 单）\" % (paid_cnt, refunded_cnt))\nprint(\"  GMV（不计退款）   = %s\" % gmv)\nprint(\"  客单价            = %s\" % round(gmv / paid_cnt, 2))\n\n# 对照：不剔除退款会怎样 —— 口径不同，数字就不同\ngmv_all = conn.execute(\n    \"SELECT ROUND(SUM(amount), 2) FROM orders WHERE substr(created_at, 1, 10) = '2025-06-01'\"\n).fetchone()[0]\nprint(\"\")\nprint(\"对照：若不剔除退款，GMV = %s\" % gmv_all)\nprint(\"结论：口径必须先对齐（写进 ADR），再谈数字——这就是「GMV 不计退款」的意义\")\n",
    expected: "种子完成：商品 50 个，订单 5000 张（2025-06-01 ~ 06-30，约 1/10 退款）\n\n验收口径 · 2025-06-01 单日汇总：\n  有效订单数        = 141（另剔除退款 19 单）\n  GMV（不计退款）   = 37769.9\n  客单价            = 267.87\n\n对照：若不剔除退款，GMV = 42393.99\n结论：口径必须先对齐（写进 ADR），再谈数字——这就是「GMV 不计退款」的意义"
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
