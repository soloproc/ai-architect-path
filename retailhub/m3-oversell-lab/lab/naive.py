"""naive.py —— 复现超卖：Read Committed 语义下的"读库存→判断→扣减"。

这是业务代码里最直觉、也最常见的写法：

    1. SELECT stock FROM sku          -- 读库存
    2. if stock >= qty:               -- 在应用层判断"够不够卖"
    3.     UPDATE stock = stock - qty -- 扣减

问题出在哪：第 1 步和第 3 步之间隔着第 2 步，这三步不是原子的。
在数据库默认的 Read Committed 隔离级别下，每个事务读到的都是
"已提交的最新值"，但**没人阻止两个事务读到同一个旧值**。
于是 6 个买家都读到 stock=5、都判断通过、都执行扣减——
库存被一路扣到 -1：这就是丢失更新（lost update）导致的超卖。

为什么必现：我们用 Barrier 强制 6 个线程"先一起读完，再一起写"，
把平时毫秒级、碰运气的竞态窗口放大成确定性的实验。
真实生产里这个窗口靠流量放大——双 11 的零点到来的那一刻，
"碰运气"就会变成"必现"。
"""
import sqlite3
import threading
import time

from seed import DB_PATH, seed, show_stock
from timeline import Timeline

SKU_ID = "SKU-1001"     # 种子库存 = 5
BUYERS = 6              # 6 个并发买家，各买 1 件 → 需求量 6 > 库存 5
QTY = 1


def naive_buy(buyer: str, tl: Timeline, barrier: threading.Barrier):
    """一个买家的完整下单流程（错误示范）。"""
    # 每个线程独立连接：SQLite 连接不可跨线程共享，也模拟了真实的多会话。
    conn = sqlite3.connect(DB_PATH, timeout=10)
    tl.log(buyer, "连接数据库，开始下单")

    # 第 1 步：读库存（Read Committed —— 读到此刻已提交的值）
    stock = conn.execute(
        "SELECT stock FROM sku WHERE id = ?", (SKU_ID,)
    ).fetchone()[0]
    tl.log(buyer, f"SELECT 读到 stock = {stock}")

    # —— 竞态窗口开始：所有人都在这里停下，等大家全部读完 ——
    barrier.wait()
    time.sleep(0.02)  # 模拟应用层的业务判断耗时（风控、优惠券校验……）

    # 第 2 步：应用层判断。注意：此时手里的 stock 已经是"旧闻"了。
    if stock < QTY:
        tl.log(buyer, f"stock={stock} 不足，下单失败")
        conn.close()
        return False
    tl.log(buyer, f"判断通过（stock={stock} >= {QTY}），准备扣减")

    # 第 3 步：无条件扣减。判断依据是旧值，写的时候库里的值早变了。
    conn.execute("UPDATE sku SET stock = stock - ? WHERE id = ?", (QTY, SKU_ID))
    conn.execute(
        "INSERT INTO orders (sku_id, qty, buyer) VALUES (?, ?, ?)", (SKU_ID, QTY, buyer)
    )
    conn.commit()
    tl.log(buyer, f"UPDATE stock = {stock} - {QTY}，下单成功 ✓")
    conn.close()
    return True


def main():
    seed()
    tl = Timeline()
    barrier = threading.Barrier(BUYERS)  # 集结点：6 个线程全部读完才放行
    threads = [
        threading.Thread(target=naive_buy, args=(f"T{i+1}", tl, barrier))
        for i in range(BUYERS)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # —— 验收：看最终库存和成交单数 ——
    conn = sqlite3.connect(DB_PATH)
    final = conn.execute("SELECT stock FROM sku WHERE id = ?", (SKU_ID,)).fetchone()[0]
    sold = conn.execute("SELECT COUNT(*) FROM orders WHERE sku_id = ?", (SKU_ID,)).fetchone()[0]
    conn.close()

    print("========== naive：读库存→判断→扣减（Read Committed）==========")
    tl.print()
    print("-" * 60)
    print(f"初始库存 = 5，买家 = {BUYERS}，成交单数 = {sold}，最终库存 = {final}")
    if final < 0 or sold > 5:
        print("❌ 超卖发生：库存被扣成负数，卖出的件数超过了实际库存。")
        print("   防住它的不是隔离级别——是原子操作（见 atomic.py）。")
    else:
        print("（本次侥幸没超卖，再跑几次试试——竞态不该靠运气。）")


if __name__ == "__main__":
    main()
