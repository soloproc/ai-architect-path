"""atomic.py —— 正确方案对比：同样的并发压力下，库存永远正确。

教程卷03给出的工程排序：**能用原子操作就不用锁，能用锁就不上串行化**。
本文件演示前两种写法：

方案 A（首选）：原子 UPDATE ... WHERE stock >= qty
    UPDATE sku SET stock = stock - ? WHERE id = ? AND stock >= ?
    把"判断+扣减"合并成一条 SQL。数据库执行单行 UPDATE 时会持有行锁，
    第 6 个买家排队等锁，锁释放后条件 stock >= 1 已不成立，
    影响行数 = 0 → 安全失败。**不依赖任何隔离级别**，默认配置即正确。

方案 B（需要更复杂逻辑时）：BEGIN IMMEDIATE 事务
    先抢写锁再 SELECT，把"读-判断-写"包进一个持锁事务里，
    等价于 PostgreSQL 的 SELECT ... FOR UPDATE。灵活，但锁持有
    时间长、吞吐差，所以排在方案 A 之后。

注意结论（与教程一致）：防住超卖的是**原子操作带来的单行互斥**，
与数据库默认隔离级别无关——naive.py 的错不在 Read Committed，
而在"判断依据和写入不是同一条原子语句"。
"""
import sqlite3
import threading
import time

from seed import DB_PATH, seed
from timeline import Timeline

SKU_ID = "SKU-1001"
BUYERS = 6
QTY = 1


# ---------- 方案 A：原子 UPDATE ----------

def buy_atomic(buyer: str, tl: Timeline, barrier: threading.Barrier) -> bool:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    barrier.wait()          # 同样集结，公平对比：并发压力一模一样
    tl.log(buyer, "发起原子 UPDATE（WHERE stock >= qty）")
    cur = conn.execute(
        "UPDATE sku SET stock = stock - ? WHERE id = ? AND stock >= ?",
        (QTY, SKU_ID, QTY),
    )
    if cur.rowcount == 0:
        # 影响行数 0：轮到它时库存已不够，条件不成立，安全失败
        conn.rollback()
        tl.log(buyer, "影响行数 = 0，库存不足，下单失败 ✗（安全）")
        conn.close()
        return False
    conn.execute(
        "INSERT INTO orders (sku_id, qty, buyer) VALUES (?, ?, ?)", (SKU_ID, QTY, buyer)
    )
    conn.commit()
    tl.log(buyer, "影响行数 = 1，下单成功 ✓")
    conn.close()
    return True


# ---------- 方案 B：BEGIN IMMEDIATE 持锁事务 ----------

def buy_tx(buyer: str, tl: Timeline, barrier: threading.Barrier) -> bool:
    conn = sqlite3.connect(DB_PATH, timeout=10, isolation_level=None)
    barrier.wait()
    # BEGIN IMMEDIATE 立即申请写锁：后来的事务在 BEGIN 处排队，
    # 等前一个事务 COMMIT 后才能继续——读到的必然是提交后的新值。
    # PostgreSQL 里的等价写法是 BEGIN; SELECT ... FOR UPDATE;
    conn.execute("BEGIN IMMEDIATE")
    tl.log(buyer, "BEGIN IMMEDIATE 拿到写锁")
    stock = conn.execute("SELECT stock FROM sku WHERE id = ?", (SKU_ID,)).fetchone()[0]
    if stock < QTY:
        conn.execute("ROLLBACK")
        tl.log(buyer, f"事务内读到 stock={stock} 不足，回滚 ✗（安全）")
        conn.close()
        return False
    tl.log(buyer, f"事务内读到 stock={stock}，判断通过并扣减")
    conn.execute("UPDATE sku SET stock = stock - ? WHERE id = ?", (QTY, SKU_ID))
    conn.execute(
        "INSERT INTO orders (sku_id, qty, buyer) VALUES (?, ?, ?)", (SKU_ID, QTY, buyer)
    )
    conn.execute("COMMIT")
    tl.log(buyer, "COMMIT，下单成功 ✓（释放写锁）")
    conn.close()
    return True


def run(title: str, buy_fn):
    seed()
    tl = Timeline()
    barrier = threading.Barrier(BUYERS)
    threads = [
        threading.Thread(target=buy_fn, args=(f"T{i+1}", tl, barrier))
        for i in range(BUYERS)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    conn = sqlite3.connect(DB_PATH)
    final = conn.execute("SELECT stock FROM sku WHERE id = ?", (SKU_ID,)).fetchone()[0]
    sold = conn.execute("SELECT COUNT(*) FROM orders WHERE sku_id = ?", (SKU_ID,)).fetchone()[0]
    conn.close()

    print(f"========== {title} ==========")
    tl.print()
    print("-" * 60)
    print(f"初始库存 = 5，买家 = {BUYERS}，成交单数 = {sold}，最终库存 = {final}")
    assert final == 0 and sold == 5, "正确方案绝不允许超卖！"
    print("✅ 正确：5 人成交、1 人安全失败，库存恰好为 0，永不超卖。\n")


def main():
    run("方案 A：原子 UPDATE ... WHERE stock >= qty", buy_atomic)
    time.sleep(0.2)
    run("方案 B：BEGIN IMMEDIATE 持锁事务（≈ SELECT FOR UPDATE）", buy_tx)


if __name__ == "__main__":
    main()
