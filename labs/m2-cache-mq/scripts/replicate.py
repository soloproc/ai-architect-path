#!/usr/bin/env python3
"""教学模拟版"主从复制"：把主库文件复制到从库。

真实 MySQL 主从是 binlog 增量复制，从库持续追主库的变更流；本教学版
用 SQLite 的 backup API 做一次全量拷贝，效果等价于"复制延迟为 0 的
全量快照"。每次种子数据变更后重跑一次即可。
"""
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.db import MASTER_PATH, SLAVE_PATH  # noqa: E402


def replicate() -> None:
    if not os.path.exists(MASTER_PATH):
        sys.exit(f"主库不存在：{MASTER_PATH}，请先运行 python -m app.seed")
    master = sqlite3.connect(MASTER_PATH)
    slave = sqlite3.connect(SLAVE_PATH)
    try:
        master.backup(slave)  # 在线备份 API：拷贝期间主库可读
        count = slave.execute("SELECT COUNT(*) FROM orders").fetchone()[0]
        print(f"复制完成：{MASTER_PATH} -> {SLAVE_PATH}（orders 共 {count} 行）")
    finally:
        master.close()
        slave.close()


if __name__ == "__main__":
    replicate()
