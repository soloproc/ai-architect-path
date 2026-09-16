"""确定性种子数据：RetailHub 库存表（SQLite）。

为什么用 SQLite：实验要的是"单库、可复现、零安装"。SQLite 的单文件库
天然适合单机并发演示——它对写操作加库级锁（等价于教程里说的"单行锁
帮你串行化"的简化版），读操作默认快照语义，足够演示隔离级别问题。
为什么强调"确定性"：实验课最怕"我这边跑出来不一样"。固定 seed、
固定库存值、固定买家数，任何人跑出来的最终库存都必须一致。
"""
import os
import sqlite3

# 数据库文件放在 lab 目录下，每次实验重建，保证结果不受上次运行污染。
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lab.db")

# 与教程卷03口径一致：stock=5 的商品，6 个并发买家各买 1 件。
SEED_SKU = [
    ("SKU-1001", "RetailHub 保温杯", 5),
    ("SKU-1002", "RetailHub 帆布袋", 10),
]


def seed(db_path: str = DB_PATH) -> str:
    """重建数据库并写入种子数据，返回数据库路径。幂等，可反复调用。"""
    if os.path.exists(db_path):
        os.remove(db_path)
    conn = sqlite3.connect(db_path)
    conn.execute(
        """CREATE TABLE sku (
               id    TEXT PRIMARY KEY,
               name  TEXT NOT NULL,
               stock INTEGER NOT NULL CHECK (stock >= -100)  -- 允许为负：超卖需要被看见
           )"""
    )
    conn.execute(
        """CREATE TABLE orders (
               id      INTEGER PRIMARY KEY AUTOINCREMENT,
               sku_id  TEXT NOT NULL,
               qty     INTEGER NOT NULL,
               buyer   TEXT NOT NULL,
               created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
           )"""
    )
    conn.executemany("INSERT INTO sku (id, name, stock) VALUES (?, ?, ?)", SEED_SKU)
    conn.commit()
    conn.close()
    return db_path


def show_stock(db_path: str = DB_PATH):
    conn = sqlite3.connect(db_path)
    rows = conn.execute("SELECT id, name, stock FROM sku ORDER BY id").fetchall()
    conn.close()
    for sid, name, stock in rows:
        print(f"  {sid}  {name:<14}  stock = {stock}")


if __name__ == "__main__":
    path = seed()
    print(f"种子数据已写入: {path}")
    show_stock(path)
