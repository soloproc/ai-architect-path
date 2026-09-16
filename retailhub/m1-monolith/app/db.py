"""SQLite 连接管理与建表。

教学要点：
- 数据库路径走环境变量 RETAILHUB_DB，测试可以指向临时文件，
  这就是"把环境相关的配置推出代码"的最小实践（12-Factor 的雏形）。
- 每个请求开一个新连接、用完即关。SQLite 是单文件库，没有真正的连接池；
  换成 MySQL 后这里会换成连接池，但 get_conn() 的调用方式不变——
  把"怎么拿连接"收敛到一个函数里，演进时只改这一个文件。
"""
import os
import sqlite3

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.environ.get("RETAILHUB_DB", os.path.join(BASE_DIR, "retailhub.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS items (
    id       INTEGER PRIMARY KEY,
    name     TEXT NOT NULL,
    category TEXT NOT NULL,
    price    REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
    id         INTEGER PRIMARY KEY,
    member_id  INTEGER NOT NULL,
    store_id   INTEGER NOT NULL,
    status     TEXT NOT NULL,          -- paid / refunded
    amount     REAL NOT NULL,          -- 订单总额，冗余存储避免每次重算
    created_at TEXT NOT NULL           -- 'YYYY-MM-DD HH:MM:SS'
);
CREATE TABLE IF NOT EXISTS order_items (
    order_id INTEGER NOT NULL,
    item_id  INTEGER NOT NULL,
    qty      INTEGER NOT NULL,
    price    REAL NOT NULL             -- 下单时的成交价（商品现价会变，必须快照）
);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
"""


def get_conn() -> sqlite3.Connection:
    """返回一个新连接；row_factory 让查询结果可以按列名取值。"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """建表（幂等，可重复执行）。"""
    conn = get_conn()
    try:
        conn.executescript(SCHEMA)
        conn.commit()
    finally:
        conn.close()


def table_empty(table: str) -> bool:
    conn = get_conn()
    try:
        row = conn.execute(f"SELECT COUNT(*) AS c FROM {table}").fetchone()
        return row["c"] == 0
    finally:
        conn.close()
