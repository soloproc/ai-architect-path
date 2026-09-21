"""主/从双库连接管理（教学模拟版读写分离）。

教学要点：
- 真实生产里是 MySQL 主从：binlog 复制、从库 read-only。本教学版用两个
  SQLite 文件模拟——写走 master、读走 slave，scripts/replicate.py 扮演
  "复制"角色。接口形态与真实主从一致，换掉驱动即可平移。
- 为什么读写分离：报表类大查询会长时间占用 IO，把它引到从库后，
  下单等写入路径不再被拖慢（卷02 任务 E 的核心逻辑）。
- 注意"写后读"陷阱：刚写入 master 的数据还没复制到 slave 时读不到。
  本服务所有读都走从库，把这个问题暴露出来供课堂讨论（解法见 README）。
"""
import os
import sqlite3

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASTER_PATH = os.environ.get("RETAILHUB_DB_MASTER",
                             os.path.join(BASE_DIR, "retailhub_master.db"))
SLAVE_PATH = os.environ.get("RETAILHUB_DB_SLAVE",
                            os.path.join(BASE_DIR, "retailhub_slave.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL,
    category TEXT NOT NULL, price REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY, member_id INTEGER NOT NULL,
    store_id INTEGER NOT NULL, status TEXT NOT NULL,
    amount REAL NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS order_items (
    order_id INTEGER NOT NULL, item_id INTEGER NOT NULL,
    qty INTEGER NOT NULL, price REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
-- 简易消息队列：任务表即"队列"，worker 轮询取任务（教学版 MQ）
CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,            -- 任务类型，如 daily_report
    payload TEXT NOT NULL,         -- JSON 参数
    status TEXT NOT NULL DEFAULT 'pending',  -- pending/running/done/failed
    result TEXT,                   -- JSON 结果
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
-- 日报结果表：worker 聚合后写入，演示"最终一致性"的落点
CREATE TABLE IF NOT EXISTS daily_report (
    date TEXT PRIMARY KEY, order_count INTEGER NOT NULL,
    gmv REAL NOT NULL, avg_order_value REAL NOT NULL,
    updated_at TEXT NOT NULL
);
"""


def _conn(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def get_master() -> sqlite3.Connection:
    """写连接：所有 INSERT/UPDATE 必须走这里。"""
    return _conn(MASTER_PATH)


def get_slave() -> sqlite3.Connection:
    """读连接：查询默认走从库。从库不存在时降级回主库（教学便利）。"""
    if os.path.exists(SLAVE_PATH):
        return _conn(SLAVE_PATH)
    return _conn(MASTER_PATH)


def init_db() -> None:
    conn = get_master()
    try:
        conn.executescript(SCHEMA)
        conn.commit()
    finally:
        conn.close()
