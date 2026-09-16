"""M8 · 记忆存储分层 —— 对应教程《篇08-Agent记忆治理》§2.3/§2.6。

三层存储各管一件事（篇08 §2.6）：
  关系库（主库）   权限、Scope、版本、状态、TTL、审计 —— 记忆的唯一事实来源
  向量索引         按语义召回候选 —— 只是索引，不是真相
  Evidence Store   原始证据（Run 记录、用户指令原文） —— 不在线查询

关键纪律：**向量索引查到的任何东西，都必须回主库校验 Scope/版本/状态后才能使用**。
跨租户泄漏事故十有八九是有人图快直接用了向量库结果。
"""
from __future__ import annotations

import json
import math
import re
import sqlite3
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path


class MemoryType(str, Enum):
    """白名单类型（篇08 §2.7）：事实数据、临时结论、未证实推测不在此列。"""
    USER_PREFERENCE = "user_preference"          # 报告/表达偏好
    TASK_REFERENCE = "task_reference"            # 历史任务/报告指针
    PROCESS_EXPERIENCE = "process_experience"    # 经确认的流程经验


class MemoryStatus(str, Enum):
    ACTIVE = "active"
    SUPERSEDED = "superseded"    # 被新版本取代（不删除——历史可追溯，篇08 §2.5）
    EXPIRED = "expired"
    DELETED = "deleted"
    CONTESTED = "contested"      # 冲突悬置：宁可不记，不可记错


@dataclass(frozen=True)
class Scope:
    """可见范围四元组（篇08 §2.3）：召回过滤的全部依据，缺一个字段就是一种泄漏路径。"""
    tenant_id: str
    user_id: str | None = None        # None = 租户级共享（需显式提升）
    project_id: str | None = None
    task_type: str | None = None


@dataclass
class MemoryRecord:
    memory_id: str
    mem_type: MemoryType
    content: dict                     # 结构化内容本体
    scope: Scope
    provenance: dict                  # 来源：run_id / 用户指令 / 确认人
    evidence_ref: str                 # Evidence Store 指针（强制）
    ttl: float | None = None          # 过期时间戳
    status: MemoryStatus = MemoryStatus.ACTIVE
    version: int = 1
    supersedes: str | None = None
    created_at: float = field(default_factory=time.time)

    @property
    def text(self) -> str:
        return json.dumps(self.content, ensure_ascii=False, sort_keys=True)

    @property
    def expired(self) -> bool:
        return self.ttl is not None and time.time() > self.ttl


def _tokens(text: str) -> list[str]:
    """教学版分词：中文取字二元组，英文取单词。够演示余弦相似度即可。"""
    words = re.findall(r"[a-zA-Z0-9_]+", text.lower())
    cjk = re.findall(r"[一-鿿]", text)
    return words + [a + b for a, b in zip(cjk, cjk[1:])]


def _cosine(a: list[str], b: list[str]) -> float:
    if not a or not b:
        return 0.0
    sa, sb = set(a), set(b)
    inter = len(sa & sb)
    return inter / math.sqrt(len(sa) * len(sb))


class VectorIndex:
    """词袋余弦召回（教学版）。定位：召回加速器，**不是门禁**。"""

    def __init__(self) -> None:
        self._docs: dict[str, list[str]] = {}

    def upsert(self, memory_id: str, text: str) -> None:
        self._docs[memory_id] = _tokens(text)

    def delete(self, memory_id: str) -> None:
        self._docs.pop(memory_id, None)      # 删除传播（篇08 §4.3）：索引同步删除

    def search(self, query: str, k: int) -> list[tuple[str, float]]:
        q = _tokens(query)
        scored = [(mid, _cosine(q, doc)) for mid, doc in self._docs.items()]
        return sorted(scored, key=lambda x: x[1], reverse=True)[:k]


class EvidenceStore:
    """原始证据层：用户指令原文、Run 摘要。写入后只读，不参与在线召回。"""

    def __init__(self) -> None:
        self._blobs: dict[str, str] = {}

    def put(self, evidence_ref: str, text: str) -> None:
        self._blobs[evidence_ref] = text

    def get(self, evidence_ref: str) -> str | None:
        return self._blobs.get(evidence_ref)


class MemoryStore:
    """关系主库（SQLite）：记忆的唯一事实来源（篇08 §2.6）。"""

    def __init__(self, path: str | Path = ":memory:"):
        self.db = sqlite3.connect(str(path))
        self.db.execute("""
        CREATE TABLE IF NOT EXISTS memories(
          memory_id TEXT PRIMARY KEY,
          write_request_id TEXT UNIQUE,     -- 幂等键：重复写入请求返回首次结果
          mem_type TEXT, content TEXT,
          tenant_id TEXT, user_id TEXT, project_id TEXT, task_type TEXT,
          provenance TEXT, evidence_ref TEXT,
          ttl REAL, status TEXT, version INTEGER, supersedes TEXT,
          fingerprint TEXT, created_at REAL)
        """)
        self.db.commit()

    def insert(self, rec: MemoryRecord, write_request_id: str, fingerprint: str) -> bool:
        """返回 True=首次写入；False=幂等键命中，重复请求被吞掉（篇08 §2.4）。"""
        s, p = rec.scope, rec.provenance
        cur = self.db.execute(
            "INSERT OR IGNORE INTO memories VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (rec.memory_id, write_request_id, rec.mem_type.value, rec.text,
             s.tenant_id, s.user_id, s.project_id, s.task_type,
             json.dumps(p, ensure_ascii=False), rec.evidence_ref,
             rec.ttl, rec.status.value, rec.version, rec.supersedes,
             fingerprint, rec.created_at))
        self.db.commit()
        return cur.rowcount == 1

    def get(self, memory_id: str) -> MemoryRecord | None:
        row = self.db.execute("SELECT * FROM memories WHERE memory_id=?",
                              (memory_id,)).fetchone()
        return self._to_record(row) if row else None

    def by_request_id(self, write_request_id: str) -> str | None:
        row = self.db.execute("SELECT memory_id FROM memories WHERE write_request_id=?",
                              (write_request_id,)).fetchone()
        return row[0] if row else None

    def find_by_fingerprint(self, fingerprint: str) -> MemoryRecord | None:
        row = self.db.execute(
            "SELECT * FROM memories WHERE fingerprint=? AND status='active'",
            (fingerprint,)).fetchone()
        return self._to_record(row) if row else None

    def find_active(self, tenant_id: str, mem_type: MemoryType,
                    subject_key: str) -> MemoryRecord | None:
        """同 scope 同 subject 的 active 记忆（冲突检测用）。"""
        rows = self.db.execute(
            "SELECT * FROM memories WHERE tenant_id=? AND mem_type=? AND status='active'",
            (tenant_id, mem_type.value)).fetchall()
        for r in rows:
            rec = self._to_record(r)
            if rec.content.get("subject") == subject_key:
                return rec
        return None

    def set_status(self, memory_id: str, status: MemoryStatus) -> None:
        self.db.execute("UPDATE memories SET status=? WHERE memory_id=?",
                        (status.value, memory_id))
        self.db.commit()

    def all_records(self) -> list[MemoryRecord]:
        return [self._to_record(r) for r in self.db.execute("SELECT * FROM memories")]

    def _to_record(self, row) -> MemoryRecord:
        (mid, _wrid, mtype, content, tid, uid, pid, ttype,
         prov, eref, ttl, status, ver, sup, _fp, cat) = row
        return MemoryRecord(mid, MemoryType(mtype), json.loads(content),
                            Scope(tid, uid, pid, ttype), json.loads(prov), eref,
                            ttl, MemoryStatus(status), ver, sup, cat)
