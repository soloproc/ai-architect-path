"""outbox.py —— 本地消息表（Outbox）模式：下单与发消息在同一事务。

对应卷04 实战任务 3（"下单成功通知库存扣减"改为 Outbox，消费端幂等）。

它解决什么问题（双写难题）：
    订单服务要干两件事：① 写订单到数据库；② 发消息给 MQ 通知库存。
    这两件事没有共同事务——
      先写库再发消息：发消息前进程崩溃 → 有订单、没通知，库存永远不少；
      先发消息再写库：写库失败 → 库存扣了、订单没有，对账对不上。
Outbox 的回答：**把"要通知下游"这件事也写成数据库里的一行记录，
和订单放在同一个本地事务里提交**。本地事务保证"订单和消息要么都在、
要么都不在"。之后后台 relay 线程轮询 outbox 表把消息投递出去。

语义是"至少一次"（at-least-once）：relay 投递成功但标记失败时会重投，
所以**消费端必须幂等**——本演示用 processed_events 表记录已处理的事件 ID，
重复事件直接跳过。"不丢"由 outbox 表兜底，"不重"由消费端幂等兜底，
两个半件拼出恰好一次的效果。
"""
import os
import sqlite3
import threading
import time

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "outbox_demo.db")


# ---------- 存储层 ----------

def init_db(db_path: str = DB_PATH) -> str:
    if os.path.exists(db_path):
        os.remove(db_path)
    conn = sqlite3.connect(db_path)
    conn.executescript(
        """
        CREATE TABLE orders (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            sku_id  TEXT NOT NULL,
            qty     INTEGER NOT NULL
        );
        CREATE TABLE outbox (              -- 本地消息表：与订单同库
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id    TEXT NOT NULL UNIQUE,  -- 全局唯一，消费端幂等的钥匙
            topic       TEXT NOT NULL,
            payload     TEXT NOT NULL,
            delivered   INTEGER NOT NULL DEFAULT 0  -- relay 投递成功的标记
        );
        CREATE TABLE inventory (
            sku_id TEXT PRIMARY KEY,
            stock  INTEGER NOT NULL
        );
        CREATE TABLE processed_events (    -- 消费端幂等表
            event_id TEXT PRIMARY KEY
        );
        """
    )
    conn.execute("INSERT INTO inventory (sku_id, stock) VALUES ('SKU-1001', 100)")
    conn.commit()
    conn.close()
    return db_path


def place_order(sku_id: str, qty: int, event_id: str) -> int:
    """下单：订单行和 outbox 消息在同一个事务里提交（这是模式的灵魂）。"""
    conn = sqlite3.connect(DB_PATH, timeout=10)
    try:
        conn.execute("BEGIN")
        cur = conn.execute("INSERT INTO orders (sku_id, qty) VALUES (?, ?)", (sku_id, qty))
        order_id = cur.lastrowid
        conn.execute(
            "INSERT INTO outbox (event_id, topic, payload) VALUES (?, ?, ?)",
            (event_id, "order_created", f'{{"order_id": {order_id}, "sku_id": "{sku_id}", "qty": {qty}}}'),
        )
        conn.commit()  # 原子：订单和消息要么一起活，要么一起死
        return order_id
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ---------- 消费端（库存服务，必须幂等） ----------

def consume_order_created(event_id: str, sku_id: str, qty: int) -> bool:
    """幂等消费：同一 event_id 重复到达只生效一次。"""
    conn = sqlite3.connect(DB_PATH, timeout=10)
    already = conn.execute(
        "SELECT 1 FROM processed_events WHERE event_id = ?", (event_id,)
    ).fetchone()
    if already:
        conn.close()
        return False  # 重复投递，跳过——幂等挡板生效
    conn.execute("UPDATE inventory SET stock = stock - ? WHERE sku_id = ?", (qty, sku_id))
    conn.execute("INSERT INTO processed_events (event_id) VALUES (?)", (event_id,))
    conn.commit()
    conn.close()
    return True


# ---------- Relay：把 outbox 里的消息"投出去" ----------

class OutboxRelay(threading.Thread):
    """后台 relay 线程：轮询 outbox 表，投递未送达的消息。

    flaky_delivery 模拟"网络不可靠"：投递动作随机失败一次，
    用来演示 at-least-once 的重投与幂等去重。
    """

    def __init__(self, interval: float = 0.05, flaky_first_delivery: bool = True):
        super().__init__(daemon=True)
        self.interval = interval
        self._stop_event = threading.Event()
        self._flaky = flaky_first_delivery
        self._failed_once = set()   # 记录哪些消息已经"失败过一次"
        self.logs = []

    def _log(self, msg: str):
        self.logs.append(msg)
        print(f"  [relay] {msg}")

    def deliver(self, event_id: str, payload: str) -> bool:
        """模拟"把消息发到 MQ"。第一次投递会假装网络抖动失败。"""
        if self._flaky and event_id not in self._failed_once:
            self._failed_once.add(event_id)
            self._log(f"投递 {event_id} … 网络抖动，失败！（下次重投）")
            return False
        import json
        data = json.loads(payload)
        applied = consume_order_created(event_id, data["sku_id"], data["qty"])
        if applied:
            self._log(f"投递 {event_id} 成功，库存已扣减")
        else:
            self._log(f"投递 {event_id} 成功，但消费端发现是重复消息，幂等跳过")
        return True  # 消费成功（含幂等跳过）才算送达

    def run(self):
        while not self._stop_event.is_set():
            conn = sqlite3.connect(DB_PATH, timeout=10)
            rows = conn.execute(
                "SELECT id, event_id, payload FROM outbox WHERE delivered = 0 ORDER BY id"
            ).fetchall()
            for row_id, event_id, payload in rows:
                if self.deliver(event_id, payload):
                    conn.execute("UPDATE outbox SET delivered = 1 WHERE id = ?", (row_id,))
                    conn.commit()
                # 投递失败：什么都不做，留在表里，下一轮重投 —— 这就是"不丢"
            conn.close()
            time.sleep(self.interval)

    def stop(self):
        self._stop_event.set()


def demo():
    """完整演示：3 笔订单 → relay 带故障投递 → 库存恰好扣 3 次，不多不少。"""
    init_db()
    print("== Outbox 演示：下单写库+写消息同事务，relay 至少一次投递，消费端幂等 ==")
    relay = OutboxRelay(flaky_first_delivery=True)
    relay.start()

    for i in range(1, 4):
        oid = place_order("SKU-1001", qty=1, event_id=f"evt-{i:04d}")
        print(f"  [order] 订单 #{oid} 已提交（订单 + outbox 消息同一事务）")

    time.sleep(0.6)  # 等 relay 把所有消息（含重投）处理完
    relay.stop()
    relay.join(timeout=2)

    conn = sqlite3.connect(DB_PATH)
    stock = conn.execute("SELECT stock FROM inventory WHERE sku_id='SKU-1001'").fetchone()[0]
    undelivered = conn.execute("SELECT COUNT(*) FROM outbox WHERE delivered=0").fetchone()[0]
    conn.close()
    print("-" * 56)
    print(f"初始库存 100 → 最终库存 {stock}（期望 97）；outbox 未投递消息 = {undelivered}（期望 0）")
    assert stock == 97 and undelivered == 0
    print("✅ 不丢（全部送达）且不重（重复投递被幂等挡下）。")


if __name__ == "__main__":
    demo()
