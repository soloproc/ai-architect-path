/* lab-m3 —— "M3 · 超卖实验（naive 交错读改写 vs 原子 UPDATE）"
 * 「在线运行」入口：动态加载 lab-runner.js（已加载则直接用），
 * 然后调 window.LABRUNNER 渲染可折叠的浏览器内 Python 运行面板。
 * code 为「在线逻辑版」（仅标准库）；expected 为本地 python3 实跑的真实输出。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['lab-m3'] = function (container) {
  var CONFIG = {
    title: "M3 · 超卖实验（naive 交错读改写 vs 原子 UPDATE）",
    subtitle: "对应卷03-2 实战 · labs/m3-oversell-lab 的竞态核心：用生成器交错精确复现「先读后写」超卖，再看 UPDATE ... WHERE stock>0 原子版如何正确互斥。",
    code: "# ============================================================\n# 在线逻辑版 · M3 超卖实验（对应卷03-2 实战）\n# 真实源码（labs/m3-oversell-lab）用 threading.Barrier 把毫秒级竞态\n# 放大成确定性事件；浏览器里不开真线程，改用「生成器交错执行」\n# 精确复现同一竞态：库存 1，两个买家都先读到 1，都判断通过 → 超卖\n# ============================================================\nimport sqlite3\n\nSKU, STOCK0 = \"SKU-1001\", 1\n\ndef fresh_db():\n    conn = sqlite3.connect(\":memory:\")\n    conn.execute(\"CREATE TABLE sku (id TEXT PRIMARY KEY, stock INTEGER NOT NULL)\")\n    conn.execute(\"INSERT INTO sku VALUES (?, ?)\", (SKU, STOCK0))\n    return conn\n\n# ---------- 实验一：naive「先读后写」→ 必现超卖 ----------\ndef naive_buyer(conn, name, log):\n    \"\"\"一个买家的购买流程，yield 处就是线程切换点\"\"\"\n    stock = conn.execute(\"SELECT stock FROM sku WHERE id=?\", (SKU,)).fetchone()[0]\n    log.append(\"%s  SELECT 读到 stock = %d\" % (name, stock))\n    yield                                    # ← 切换点：另一个买家也在这里读\n    if stock >= 1:                           # 用的是「读时」的旧值做判断\n        conn.execute(\"UPDATE sku SET stock = stock - 1 WHERE id=?\", (SKU,))\n        conn.commit()\n        log.append(\"%s  判断通过（读到 stock=%d >= 1），扣减成功 ✓\" % (name, stock))\n    yield\n\nprint(\"【实验一】naive 先读后写：初始库存 = 1，买家 = 2\")\nconn = fresh_db()\nlog = []\nb1 = naive_buyer(conn, \"买家A\", log)\nb2 = naive_buyer(conn, \"买家B\", log)\nnext(b1); next(b2)      # 两个买家都先完成 SELECT（都读到 stock = 1）\nnext(b1); next(b2)      # 然后才轮流扣减——都以为自己看到的是最新库存\nfor line in log:\n    print(\"  \" + line)\nstock = conn.execute(\"SELECT stock FROM sku WHERE id=?\", (SKU,)).fetchone()[0]\nprint(\"  --------------------------------------------------\")\nprint(\"  初始库存 = %d，买家 = 2，成交单数 = 2，最终库存 = %d\" % (STOCK0, stock))\nprint(\"  ❌ 超卖发生：库存被扣成负数，卖出件数超过实际库存\")\nprint(\"\")\n\n# ---------- 实验二：原子 UPDATE → 永不超卖 ----------\nprint(\"【实验二】原子 UPDATE ... WHERE stock >= 1：「判断 + 扣减」合并成一条 SQL\")\nconn = fresh_db()\nsold = 0\nfor name in [\"买家A\", \"买家B\"]:\n    cur = conn.execute(\n        \"UPDATE sku SET stock = stock - 1 WHERE id=? AND stock >= 1\", (SKU,))\n    conn.commit()\n    if cur.rowcount == 1:\n        sold += 1\n        print(\"  %s  UPDATE 影响行数 = 1，成交 ✓\" % name)\n    else:\n        print(\"  %s  UPDATE 影响行数 = 0，安全失败（库存不足，未成交）\" % name)\nstock = conn.execute(\"SELECT stock FROM sku WHERE id=?\", (SKU,)).fetchone()[0]\nprint(\"  --------------------------------------------------\")\nprint(\"  初始库存 = %d，买家 = 2，成交单数 = %d，最终库存 = %d\" % (STOCK0, sold, stock))\nprint(\"  ✅ 正确：1 人成交、1 人安全失败，库存恰好为 0，永不超卖\")\nprint(\"\")\nprint(\"结论：读十遍「丢失更新」的定义，不如亲手让它发生一次再消灭它。\")\nprint(\"      完整版（6 买家抢 stock=5、方案 B 持锁事务）见源码包 labs/m3-oversell-lab\")\n",
    expected: "【实验一】naive 先读后写：初始库存 = 1，买家 = 2\n  买家A  SELECT 读到 stock = 1\n  买家B  SELECT 读到 stock = 1\n  买家A  判断通过（读到 stock=1 >= 1），扣减成功 ✓\n  买家B  判断通过（读到 stock=1 >= 1），扣减成功 ✓\n  --------------------------------------------------\n  初始库存 = 1，买家 = 2，成交单数 = 2，最终库存 = -1\n  ❌ 超卖发生：库存被扣成负数，卖出件数超过实际库存\n\n【实验二】原子 UPDATE ... WHERE stock >= 1：「判断 + 扣减」合并成一条 SQL\n  买家A  UPDATE 影响行数 = 1，成交 ✓\n  买家B  UPDATE 影响行数 = 0，安全失败（库存不足，未成交）\n  --------------------------------------------------\n  初始库存 = 1，买家 = 2，成交单数 = 1，最终库存 = 0\n  ✅ 正确：1 人成交、1 人安全失败，库存恰好为 0，永不超卖\n\n结论：读十遍「丢失更新」的定义，不如亲手让它发生一次再消灭它。\n      完整版（6 买家抢 stock=5、方案 B 持锁事务）见源码包 labs/m3-oversell-lab"
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
