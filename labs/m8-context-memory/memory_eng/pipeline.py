"""M8 · 记忆写入管线五段 —— 对应教程《篇08-Agent记忆治理》§2.2。

  提取 Extract     从 Run 事件流产生候选（记忆不在推理中途产生，§2.1）
  标准化 Normalize  统一实体/口径，否则同一条偏好以十种写法存十份
  校验 Validate    禁止写入：临时结论/原始查询结果/模型推测（规则分类器演示）
  策略判断 Policy   MemoryPolicy：白名单、确认级别、Scope、TTL（§1.4）
  提交 Commit      幂等键防重；同 scope 冲突时版本+1、旧版标记 superseded（§2.5）

不变量（§1.5）：记忆不替代权威数据源、不继承历史权限、不覆盖当前任务要求。
"""
from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass

from .store import (EvidenceStore, MemoryRecord, MemoryStatus, MemoryStore,
                    MemoryType, Scope, VectorIndex)


@dataclass
class Candidate:
    """候选记忆：提取段的产出，还没资格进主库。"""
    mem_type: str              # 期望类型（策略段会再裁决）
    content: dict
    scope: Scope
    provenance: dict
    evidence_ref: str
    source_event: str          # 来源事件类型：user_explicit / behavior_stat / model_guess
    signal: str = "explicit"   # 触发信号强度：explicit > behavior > model


@dataclass
class WriteResult:
    decision: str              # committed / duplicate / superseded / rejected / needs_confirm
    memory_id: str | None = None
    reason: str = ""


class MemoryPolicy:
    """Memory Policy（篇08 §1.4）：对每类记忆回答四问——写什么/确认否/存多久/谁能用。"""

    ALLOWED = {                    # 白名单：type -> (是否需确认, TTL 天数)
        MemoryType.USER_PREFERENCE: (False, None),       # 偏好静默写，长期，可查看可改
        MemoryType.TASK_REFERENCE: (False, 180),         # 任务引用随项目归档失效
        MemoryType.PROCESS_EXPERIENCE: (True, 90),       # 经验是推断，需人背书 + 复审
    }
    # 黑名单特征词（校验段规则分类器）：命中即拒（篇08 §1.6 决策表）
    FORBIDDEN_HINTS = ("临时结论", "原始查询结果", "模型推测", "未经证实", "昨日", "实时")


class MemoryWritePipeline:
    """写入只发生在任务边界，由独立的 Writer 处理（篇08 §2.1）。"""

    def __init__(self, store: MemoryStore, index: VectorIndex,
                 evidence: EvidenceStore, policy: MemoryPolicy | None = None):
        self.store, self.index, self.evidence = store, index, evidence
        self.policy = policy or MemoryPolicy()

    # ---- ① 提取：从一次 Run 的事件流提取候选 ----
    def extract(self, run_id: str, events: list[dict]) -> list[Candidate]:
        cands = []
        for ev in events:
            if ev.get("memory_candidate"):
                mc = ev["memory_candidate"]
                cands.append(Candidate(
                    mem_type=mc["mem_type"], content=mc["content"],
                    scope=Scope(**mc["scope"]),
                    provenance={"run_id": run_id, "signal": mc.get("signal", "model"),
                                **mc.get("provenance", {})},
                    evidence_ref=mc["evidence_ref"], source_event=ev["type"],
                    signal=mc.get("signal", "model")))
        return cands

    # ---- ② 标准化：实体/口径归一（教学版：文本去空白 + 键排序，指纹可复现） ----
    def normalize(self, cand: Candidate) -> Candidate:
        cand.content = {k.strip(): (v.strip() if isinstance(v, str) else v)
                        for k, v in sorted(cand.content.items())}
        return cand

    # ---- ③ 校验：禁止写入黑名单（规则分类器演示，篇08 §1.6/§2.2） ----
    def validate(self, cand: Candidate) -> str | None:
        text = repr(cand.content)
        for hint in MemoryPolicy.FORBIDDEN_HINTS:
            if hint in text:
                return f"命中黑名单「{hint}」：事实类/临时结论/未证实推测禁止写入"
        if not cand.evidence_ref:
            return "缺少证据引用 evidence_ref"
        return None

    # ---- ④ 策略判断：白名单 + 确认级别 + Scope/TTL ----
    def policy_check(self, cand: Candidate) -> tuple[str, MemoryType | None, bool]:
        try:
            mtype = MemoryType(cand.mem_type)
        except ValueError:
            return "rejected", None, False
        need_confirm, _ttl = MemoryPolicy.ALLOWED[mtype]
        # 信号分级（篇08 §2.1）：模型单次判断是最弱信号，推断类必须确认
        if need_confirm and cand.signal != "explicit":
            return "needs_confirm", mtype, True
        return "allowed", mtype, need_confirm

    # ---- ⑤ 提交：幂等 + 语义去重 + 冲突版本治理 ----
    def commit(self, cand: Candidate, mtype: MemoryType,
               write_request_id: str) -> WriteResult:
        if old_id := self.store.by_request_id(write_request_id):
            return WriteResult("duplicate", old_id, "幂等键命中：重复请求返回首次结果")
        fp = self._fingerprint(cand, mtype)
        if hit := self.store.find_by_fingerprint(fp):
            return WriteResult("duplicate", hit.memory_id, "语义去重：内容指纹相同")

        _, ttl_days = MemoryPolicy.ALLOWED[mtype]
        rec = MemoryRecord(
            # memory_id 由幂等键派生：输出确定性（教学可复现），且天然与请求一一对应
            memory_id=hashlib.sha256(write_request_id.encode()).hexdigest()[:12],
            mem_type=mtype, content=cand.content,
            scope=cand.scope, provenance=cand.provenance, evidence_ref=cand.evidence_ref,
            ttl=(time.time() + ttl_days * 86400) if ttl_days else None)
        # 冲突仲裁（篇08 §2.5）：同 scope 同 subject 内容不同 → 新版本取代旧版本
        if conflict := self.store.find_active(cand.scope.tenant_id, mtype,
                                              str(cand.content.get("subject", ""))):
            rec.supersedes = conflict.memory_id
            rec.version = conflict.version + 1
            self.store.set_status(conflict.memory_id, MemoryStatus.SUPERSEDED)
            self.index.delete(conflict.memory_id)   # 失效传播到向量层
        self.store.insert(rec, write_request_id, fp)
        self.index.upsert(rec.memory_id, rec.text)
        return WriteResult("committed" if not rec.supersedes else "superseded",
                           rec.memory_id, f"v{rec.version}" + (f" 取代 {rec.supersedes}" if rec.supersedes else ""))

    # ---- 管线入口：五段串行，每段防一类故障 ----
    def submit(self, cand: Candidate, write_request_id: str) -> WriteResult:
        cand = self.normalize(cand)
        if why := self.validate(cand):
            return WriteResult("rejected", None, why)
        decision, mtype, _ = self.policy_check(cand)
        if decision == "rejected":
            return WriteResult("rejected", None, f"类型 {cand.mem_type} 不在白名单")
        if decision == "needs_confirm":
            return WriteResult("needs_confirm", None, "推断类记忆需用户确认后写入")
        return self.commit(cand, mtype, write_request_id)

    @staticmethod
    def _fingerprint(cand: Candidate, mtype: MemoryType) -> str:
        raw = f"{mtype.value}|{cand.scope.tenant_id}|{cand.scope.user_id}|{sorted(cand.content.items())}"
        return hashlib.sha256(raw.encode()).hexdigest()[:16]
