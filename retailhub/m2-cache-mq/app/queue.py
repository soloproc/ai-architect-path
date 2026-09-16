"""简易消息队列：SQLite 任务表 + 后台 worker 线程（教学版 MQ）。

教学要点（对应卷02 任务 D）：
- 为什么用 MQ：生成日报是重计算，同步做会拖住 HTTP 请求。投递即返回
  job_id，worker 慢慢算——这就是"削峰"：请求洪峰变成队列里的积压，
  以 worker 的处理能力匀速消费。
- 代价是最终一致性：POST 返回时报表还没生成，调用方轮询
  GET /reports/{job_id} 直到 status=done。"立刻看不到结果"不是 bug，
  是异步架构的契约。
- 生产里这是 RocketMQ/Kafka 的角色；用 SQLite 表演示同样的心态模型：
  生产者只写队列、消费者幂等地处理、状态可查询。
- 报表聚合读从库（get_slave）：重查询不压主库，与读写分离配合。
"""
import json
import sqlite3
import threading
import time
from datetime import datetime

from .db import get_master, get_slave

POLL_INTERVAL = 0.2  # worker 轮询间隔（秒），教学环境调小以便观察状态流转


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def enqueue(job_type: str, payload: dict) -> int:
    """投递任务，返回 job_id。只往队列表插一行，不做任何重活。"""
    conn = get_master()
    try:
        cur = conn.execute(
            "INSERT INTO jobs (type, payload, status, created_at, updated_at) "
            "VALUES (?,?, 'pending', ?,?)",
            (job_type, json.dumps(payload, ensure_ascii=False), _now(), _now()))
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def get_job(job_id: int):
    conn = get_master()
    try:
        row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def handle_daily_report(payload: dict) -> dict:
    """按日聚合 GMV（读从库），结果 upsert 进 daily_report（写主库）。

    INSERT OR REPLACE 保证幂等：同一日期重复执行结果相同，
    对应卷02"消费端幂等"的要求。
    """
    date = payload["date"]
    slave = get_slave()
    try:
        row = slave.execute(
            "SELECT COUNT(*) AS c, ROUND(COALESCE(SUM(amount),0),2) AS g "
            "FROM orders WHERE status != 'refunded' "
            "AND substr(created_at, 1, 10) = ?", (date,)).fetchone()
    finally:
        slave.close()
    time.sleep(0.5)  # 模拟重计算耗时，让 pending→running 状态可观察
    result = {"date": date, "order_count": row["c"], "gmv": row["g"],
              "avg_order_value": round(row["g"] / row["c"], 2) if row["c"] else 0.0}
    master = get_master()
    try:
        master.execute(
            "INSERT OR REPLACE INTO daily_report VALUES (?,?,?,?,?)",
            (date, result["order_count"], result["gmv"],
             result["avg_order_value"], _now()))
        master.commit()
    finally:
        master.close()
    return result


HANDLERS = {"daily_report": handle_daily_report}


def _process_one() -> bool:
    """取一条 pending 任务执行。返回是否取到了任务。"""
    conn = get_master()
    try:
        row = conn.execute(
            "SELECT id, type, payload FROM jobs WHERE status='pending' "
            "ORDER BY id LIMIT 1").fetchone()
        if row is None:
            return False
        conn.execute("UPDATE jobs SET status='running', updated_at=? WHERE id=?",
                     (_now(), row["id"]))
        conn.commit()
        try:
            result = HANDLERS[row["type"]](json.loads(row["payload"]))
            conn.execute("UPDATE jobs SET status='done', result=?, updated_at=? "
                         "WHERE id=?",
                         (json.dumps(result, ensure_ascii=False), _now(), row["id"]))
        except Exception as exc:  # 失败也要落库，否则任务会无声消失
            conn.execute("UPDATE jobs SET status='failed', result=?, updated_at=? "
                         "WHERE id=?", (json.dumps({"error": str(exc)}), _now(), row["id"]))
        conn.commit()
        return True
    except sqlite3.Error:
        return False
    finally:
        conn.close()


def _loop(stop: threading.Event) -> None:
    while not stop.is_set():
        if not _process_one():
            time.sleep(POLL_INTERVAL)


def start_worker() -> threading.Thread:
    """启动后台 worker（daemon 线程，随进程退出）。"""
    thread = threading.Thread(target=_loop, args=(threading.Event(),), daemon=True)
    thread.start()
    return thread
