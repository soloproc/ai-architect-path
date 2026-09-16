"""M7 · 统一执行模型 —— 对应教程《篇05-AgentHarness与Runtime》§3。

统一词汇表（篇05 §3.1）：
  Run        一次任务的完整生命周期，全局唯一 run_id
  Step       Run 内的一个逻辑节点，是 Checkpoint 的粒度
  Attempt    Step 的一次具体尝试 —— 重试的是 Attempt，推进的是 Step
  Event      append-only 事件流，"状态即事件的结果"
  Checkpoint Step 边界上的可序列化快照 + 事件游标

工程纪律（篇05 §3.2）：状态迁移只能由 Runtime 发起，模型永远无权直接改 Run 状态。
"""
from __future__ import annotations

import json
import sqlite3
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path


class RunState(str, Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    WAITING_APPROVAL = "WAITING_APPROVAL"
    COMPLETED = "COMPLETED"          # 教程称 SUCCEEDED，教学版用更直白的名词
    FAILED = "FAILED"


# 状态机白名单（篇05 §3.2）：非法迁移直接拒绝
_ALLOWED: dict[RunState, set[RunState]] = {
    RunState.PENDING: {RunState.RUNNING, RunState.FAILED},
    RunState.RUNNING: {RunState.WAITING_APPROVAL, RunState.COMPLETED, RunState.FAILED},
    RunState.WAITING_APPROVAL: {RunState.RUNNING, RunState.FAILED},
}


@dataclass
class Event:
    run_id: str
    seq: int                          # 事件游标：同一 Run 内单调递增
    type: str
    payload: dict
    ts: float = field(default_factory=time.time)


@dataclass
class Attempt:
    attempt_no: int
    ok: bool
    error: str | None = None


@dataclass
class Step:
    step_id: str
    seq: int                          # 第几个 Step（Checkpoint 游标）
    kind: str                         # "llm" | "tool" | "human_gate"
    name: str
    status: str = "PENDING"           # PENDING/RUNNING/COMPLETED/FAILED
    attempts: list[Attempt] = field(default_factory=list)


@dataclass
class Run:
    run_id: str
    objective: str
    state: RunState = RunState.PENDING

    def transition(self, to: RunState) -> None:
        if to not in _ALLOWED.get(self.state, set()):
            raise RuntimeError(f"非法状态迁移 {self.state.value} -> {to.value}")
        self.state = to


@dataclass
class Checkpoint:
    run_id: str
    step_cursor: int                  # 已完成到第几个 Step
    state: dict                       # Agent 状态快照（消息历史、预算消耗等）
    event_cursor: int                 # 快照时的事件游标
    created_at: float = field(default_factory=time.time)


class EventStore:
    """SQLite 事件存储：Event Sourcing 教学版。

    三张表全部只增不改（篇05 §6.3 Invariant #1：事件流只增不改）：
      events      事件流，(run_id, seq) 主键
      checkpoints Step 边界快照
      approvals   审批记录，(run_id, tool_call_id) 即幂等键
    为什么是 SQLite：单文件、零服务、事务完备，足以演示全部 Invariant。
    """

    def __init__(self, path: str | Path):
        self.db = sqlite3.connect(str(path))
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS events(
          run_id TEXT, seq INTEGER, type TEXT, payload TEXT, ts REAL,
          PRIMARY KEY(run_id, seq));
        CREATE TABLE IF NOT EXISTS checkpoints(
          run_id TEXT, step_cursor INTEGER, state TEXT, event_cursor INTEGER, ts REAL,
          PRIMARY KEY(run_id, step_cursor));
        CREATE TABLE IF NOT EXISTS approvals(
          run_id TEXT, tool_call_id TEXT, decision TEXT, executed INTEGER DEFAULT 0, ts REAL,
          PRIMARY KEY(run_id, tool_call_id));
        """)
        self.db.commit()

    # ---- 事件流：只追加，不修改 ----
    def append(self, run_id: str, type_: str, payload: dict) -> Event:
        seq = self.db.execute(
            "SELECT COALESCE(MAX(seq),0)+1 FROM events WHERE run_id=?",
            (run_id,)).fetchone()[0]
        ev = Event(run_id, seq, type_, payload)
        self.db.execute("INSERT INTO events VALUES(?,?,?,?,?)",
                        (run_id, seq, type_, json.dumps(payload, ensure_ascii=False), ev.ts))
        self.db.commit()
        return ev

    def events(self, run_id: str, after: int = 0) -> list[Event]:
        rows = self.db.execute(
            "SELECT seq,type,payload,ts FROM events WHERE run_id=? AND seq>? ORDER BY seq",
            (run_id, after)).fetchall()
        return [Event(run_id, s, t, json.loads(p), ts) for s, t, p, ts in rows]

    # ---- Checkpoint：崩溃恢复 = 加载最近快照 + 从事件游标继续 ----
    def save_checkpoint(self, cp: Checkpoint) -> None:
        self.db.execute("INSERT OR REPLACE INTO checkpoints VALUES(?,?,?,?,?)",
                        (cp.run_id, cp.step_cursor,
                         json.dumps(cp.state, ensure_ascii=False),
                         cp.event_cursor, cp.created_at))
        self.db.commit()

    def latest_checkpoint(self, run_id: str) -> Checkpoint | None:
        row = self.db.execute(
            "SELECT step_cursor,state,event_cursor,ts FROM checkpoints "
            "WHERE run_id=? ORDER BY step_cursor DESC LIMIT 1", (run_id,)).fetchone()
        return Checkpoint(run_id, row[0], json.loads(row[1]), row[2], row[3]) if row else None

    # ---- 审批与副作用幂等（篇05 §4.3/§4.4） ----
    def record_approval(self, run_id: str, tool_call_id: str, decision: str) -> bool:
        """返回 True=首次记录；False=重复提交被幂等吞掉。"""
        cur = self.db.execute("INSERT OR IGNORE INTO approvals VALUES(?,?,?,0,?)",
                              (run_id, tool_call_id, decision, time.time()))
        self.db.commit()
        return cur.rowcount == 1

    def get_approval(self, run_id: str, tool_call_id: str) -> str | None:
        row = self.db.execute(
            "SELECT decision FROM approvals WHERE run_id=? AND tool_call_id=?",
            (run_id, tool_call_id)).fetchone()
        return row[0] if row else None

    def mark_executed(self, run_id: str, tool_call_id: str) -> bool:
        """原子标记副作用已执行；False=已执行过（幂等拦截，防崩溃重放重复扣款）。"""
        cur = self.db.execute(
            "UPDATE approvals SET executed=1 WHERE run_id=? AND tool_call_id=? AND executed=0",
            (run_id, tool_call_id))
        self.db.commit()
        return cur.rowcount == 1


def replay(events: list[Event]) -> dict:
    """从事件流重建状态 —— 验证"状态即事件的结果"（篇05 §3.3）。

    测试断言：replay(事件流) 与运行时内存状态完全一致。
    """
    state: dict = {"run_state": "PENDING", "completed_steps": [], "approvals": {}}
    for ev in events:
        p = ev.payload
        if ev.type in ("run_started", "run_resumed"):
            state["run_state"] = "RUNNING"
        elif ev.type == "step_completed":
            state["completed_steps"].append(p["step_id"])
        elif ev.type == "approval_decided":
            state["approvals"][p["tool_call_id"]] = p["decision"]
        elif ev.type == "approval_requested":
            state["run_state"] = "WAITING_APPROVAL"
        elif ev.type in ("run_completed", "run_failed"):
            state["run_state"] = ev.type.replace("run_", "").upper()
    return state
