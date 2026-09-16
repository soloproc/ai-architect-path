"""M8 · Recall Contract 受控召回 —— 对应教程《篇08-Agent记忆治理》§3。

为什么不是 Blind Top-K（§3.1）：向量相似度不管租户、不管状态、不管
可信度、不分步骤。Recall Contract 五要素（§3.2）：
  召回意图 intent → 类型白名单
  Scope 过滤      → 硬条件，全部来自安全上下文，不接受模型自报
  状态与时效过滤   → 仅 active 且未过期
  综合排序        → 相关性 × 可信度 × 新鲜度（权重可调），向量分只是因子之一
  预算与截断      → 最小注入，超出进候选池留痕

架构铁律（§3.3）：**召回与行动权限分离**——记忆只能进 Context 影响"说什么"，
标记为不可作为 SQL 参数/授权来源；"做什么"永远查实时权限系统。
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum

from .store import MemoryRecord, MemoryStatus, MemoryStore, MemoryType, VectorIndex


class RecallIntent(str, Enum):
    PLANNING = "planning"      # 规划：参考历史行动与任务引用
    REPORTING = "reporting"    # 报告：使用表达与格式偏好
    DIAGNOSIS = "diagnosis"    # 诊断：参考已确认的领域经验


# 意图 → 类型白名单（防"什么记忆都往报告里塞"，篇08 §3.2）
INTENT_TYPES = {
    RecallIntent.PLANNING: {MemoryType.TASK_REFERENCE, MemoryType.PROCESS_EXPERIENCE},
    RecallIntent.REPORTING: {MemoryType.USER_PREFERENCE},
    RecallIntent.DIAGNOSIS: {MemoryType.PROCESS_EXPERIENCE},
}


@dataclass
class SecurityContext:
    """调用方安全上下文：Scope 只能来自这里，不接受模型或用户自报（§3.2）。"""
    tenant_id: str
    user_id: str
    project_id: str | None = None


@dataclass
class RecallContract:
    intent: RecallIntent
    query_text: str
    token_budget: int = 400
    top_k: int = 5
    min_score: float = 0.05
    weights: dict[str, float] = field(default_factory=lambda: {
        "relevance": 0.5, "confidence": 0.3, "freshness": 0.2})


@dataclass
class RecalledMemory:
    """注入 Context 的记忆视图：标注来源与可信度，且**标记不可作为 SQL 参数来源**。"""
    record: MemoryRecord
    score: float
    as_sql_param: bool = False     # 召回/行动权限分离（§3.3）：永远是 False

    def render(self) -> str:
        r = self.record
        return (f"[memory {r.memory_id} v{r.version} score={self.score:.2f} "
                f"仅可影响表达与规划, 不可作为 SQL 参数或授权依据] {r.text}")


class UsageTrace:
    """Memory 使用追踪（篇08 §3.5）：候选、过滤原因、注入结果全程留痕。"""

    def __init__(self) -> None:
        self.records: list[dict] = []

    def write(self, contract: RecallContract, trace: dict) -> None:
        self.records.append({"intent": contract.intent.value,
                             "query": contract.query_text, **trace})

    def report(self) -> str:
        lines = ["== UsageTrace 记忆召回审计 =="]
        for t in self.records:
            lines.append(f"  intent={t['intent']} query={t['query']!r}")
            for mid, why in t["candidates"]:
                lines.append(f"    candidate {mid}: {why}")
            lines.append(f"    injected: {t['injected'] or '无'}")
        return "\n".join(lines)


def governed_recall(contract: RecallContract, ctx: SecurityContext,
                    store: MemoryStore, index: VectorIndex,
                    trace: UsageTrace) -> list[RecalledMemory]:
    """受控召回：向量层只产候选，主库校验才是门禁（篇08 §2.6/§3.2）。"""
    allowed = INTENT_TYPES[contract.intent]
    # 过采样召回候选，留过滤余量
    cands = index.search(contract.query_text, k=max(contract.top_k * 4, 8))
    log: list[tuple[str, str]] = []
    scored: list[tuple[float, MemoryRecord]] = []
    for mid, sim in cands:
        rec = store.get(mid)                    # 关键：回主库校验
        if rec is None:
            log.append((mid, "reject: 主库无记录(索引残留)")); continue
        if rec.scope.tenant_id != ctx.tenant_id:
            log.append((mid, "reject: 跨租户")); continue
        if rec.scope.user_id and rec.scope.user_id != ctx.user_id:
            log.append((mid, "reject: user scope 不匹配")); continue
        if rec.status != MemoryStatus.ACTIVE:
            log.append((mid, f"reject: 状态 {rec.status.value}")); continue
        if rec.expired:
            log.append((mid, "reject: 已过 TTL")); continue
        if rec.mem_type not in allowed:
            log.append((mid, f"reject: 类型 {rec.mem_type.value} 不在白名单")); continue
        score = _rank(sim, rec, contract.weights)
        scored.append((score, rec))
        log.append((mid, f"score={score:.3f} (sim={sim:.3f})"))

    injected: list[RecalledMemory] = []
    budget = contract.token_budget
    for score, rec in sorted(scored, key=lambda x: x[0], reverse=True)[:contract.top_k]:
        cost = max(1, len(rec.text) * 2 // 3)
        if score < contract.min_score:
            log.append((rec.memory_id, "skip: 低于 min_score")); continue
        if cost > budget:
            log.append((rec.memory_id, "skip: 预算耗尽, 进候选池留痕")); continue
        injected.append(RecalledMemory(rec, score))
        budget -= cost
    trace.write(contract, {"candidates": log,
                           "injected": [m.record.memory_id for m in injected]})
    return injected     # 只影响 Context, 不影响权限（§3.3）


def _rank(sim: float, rec: MemoryRecord, w: dict[str, float]) -> float:
    """综合排序 = 相关性 × 可信度 × 新鲜度（篇08 §3.2-4，权重可调）。"""
    # 可信度：经确认/显式指令来源的记忆排在随口提及前面
    confidence = 1.0 if rec.provenance.get("signal") == "explicit" else 0.6
    # 新鲜度：按创建时间指数衰减（半衰期 30 天）
    age_days = (time.time() - rec.created_at) / 86400
    freshness = 0.5 ** (age_days / 30)
    return w["relevance"] * sim + w["confidence"] * confidence + w["freshness"] * freshness
