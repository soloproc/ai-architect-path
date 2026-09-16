"""M8 · 上下文装配管线 —— 对应教程《篇06-Agent上下文治理》§3。

六阶段管线（篇06 §3.1）：
  ① 硬性过滤（租户/权限/过期/信任 —— 不可被相关性绕过，§3.2）
  ② 软性排序（只在过闸者内部按相关性打分）
  ③ 去重与冲突处理（同指标新旧版本取新，冲突事实打标，§3.4）
  ④ 分区 Token Budget 分配（必需信息优先保底，§3.3）
  ⑤ 可信压缩（超长 item 摘要化并保留引用指针，§3.4）
  ⑥ 调用前充分性检查（关键区为空 → InsufficientContext，§1.5）

每一步的取舍都写入 DecisionTrace（§6.3）：审计、排障、Replay 的共同底座。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from .schema import ContextItem


class InsufficientContext(RuntimeError):
    """关键上下文缺失即停止（篇06 §1.5）：宁可报错停止，不可带着猜测继续。"""


@dataclass
class AssembleRequest:
    run_id: str
    tenant_id: str
    role: str
    step: str                       # 决策步骤：planning/sql_design/reporting...
    query: str = ""                 # 当前任务文本，相关性打分用
    required_zones: tuple[str, ...] = ("rules", "task", "semantic")  # 关键区
    budgets: dict[str, int] = field(default_factory=lambda: {
        "rules": 300, "task": 200, "state": 300,
        "semantic": 400, "evidence": 500, "output": 300})


class Provider(Protocol):
    """Context Provider（篇06 §1.4）：每类信息一个 Provider，独立缓存/测试/版本化。"""
    def collect(self, req: AssembleRequest) -> list[ContextItem]: ...


class DecisionTrace:
    """Context Decision Trace（篇06 §6.3）：记录每个候选的取舍原因。"""

    def __init__(self, run_id: str) -> None:
        self.run_id = run_id
        self.entries: list[tuple[str, str, str]] = []   # (item_id, 阶段, 决策与原因)

    def log(self, item_id: str, stage: str, decision: str) -> None:
        self.entries.append((item_id, stage, decision))

    def report(self) -> str:
        lines = [f"== DecisionTrace run={self.run_id} =="]
        for iid, stage, why in self.entries:
            lines.append(f"  [{stage:<10}] {iid:<28} {why}")
        return "\n".join(lines)


class ContextAssembler:
    """装配器：管线每一阶段可单测、可打日志、可替换实现（篇06 §3.1）。"""

    def __init__(self, providers: list[Provider]):
        self.providers = providers

    def assemble(self, req: AssembleRequest) -> tuple[list[ContextItem], DecisionTrace]:
        trace = DecisionTrace(req.run_id)
        # ---- 候选收集 ----
        cands = [c for p in self.providers for c in p.collect(req)]
        for c in cands:
            trace.log(c.item_id, "collect", f"候选 source={c.source.value} {c.version}")

        # ---- ① 硬性过滤：安全底线，不接受"它真的很相关所以破例"（篇06 §3.2） ----
        kept = []
        for c in cands:
            why = self._hard_reject(c, req)
            if why:
                trace.log(c.item_id, "hard_filter", f"拒绝: {why}")
            else:
                kept.append(c)
                trace.log(c.item_id, "hard_filter", "通过")

        # ---- ② 软性排序：只在过闸者内部（先过滤后排序，顺序不能反） ----
        ranked = sorted(kept, key=lambda c: self._relevance(c, req), reverse=True)

        # ---- ③ 去重与冲突：同指标取新版本；冲突事实打标让模型知悉（篇06 §3.4） ----
        ranked = self._dedup_resolve(ranked, trace)

        # ---- ④⑤ 分区预算 + 可信压缩 ----
        packed = self._pack(ranked, req, trace)

        # ---- ⑥ 充分性检查：关键区为空 → 拒绝调用并报缺失项（篇06 §1.5/§3.4） ----
        missing = [z for z in req.required_zones
                   if not any(c.zone == z for c in packed)]
        if missing:
            raise InsufficientContext(f"关键分区为空: {missing}")
        return packed, trace

    # 权限先于相关性（篇06 §2.2-5）：无权访问的内容根本不进入候选池之后的世界
    def _hard_reject(self, c: ContextItem, req: AssembleRequest) -> str | None:
        if c.tenant_id != req.tenant_id:
            return "跨租户"
        if req.role not in c.scope:
            return "角色越权"
        if c.expired:
            return "已过有效期"
        return None

    def _relevance(self, c: ContextItem, req: AssembleRequest) -> float:
        """教学版相关性：查询词命中数 + required 加权。真实系统换 embedding。"""
        words = {w for w in req.query.split() if w}
        hit = sum(1 for w in words if w in c.content)
        return hit * 10 + (5 if c.required else 0)

    def _dedup_resolve(self, items: list[ContextItem], trace: DecisionTrace) -> list[ContextItem]:
        best: dict[str, ContextItem] = {}
        for c in items:
            key = c.item_id                      # 同一信息 ID 的多版本/重复
            if key not in best:
                best[key] = c
                continue
            old = best[key]
            if old.content == c.content:
                trace.log(c.item_id, "dedup", f"重复丢弃(保留 {old.version})")
            else:   # 冲突裁决：版本新者优先，且冲突事实本身写入上下文（篇06 §3.4）
                new, drop = (c, old) if c.version > old.version else (old, c)
                best[key] = new
                trace.log(key, "conflict", f"冲突: {new.version} 胜出, {drop.version} 标记作废")
                new.content += f"\n[冲突提示: 存在旧版 {drop.version} 口径「{drop.content[:40]}…」，已作废]"
        return list(best.values())

    def _pack(self, ranked: list[ContextItem], req: AssembleRequest,
              trace: DecisionTrace) -> list[ContextItem]:
        """必需信息优先保底（篇06 §3.3）：弹性区物品永远不许挤占保底区。"""
        packed: list[ContextItem] = []
        used: dict[str, int] = {}
        for c in sorted(ranked, key=lambda x: (not x.required)):  # required 先装
            budget = req.budgets.get(c.zone, 0)
            cost, cur = c.token_estimate, used.get(c.zone, 0)
            if cur + cost <= budget:
                packed.append(c)
                used[c.zone] = cur + cost
                trace.log(c.item_id, "budget", f"装入 {c.zone} 区 ({cur}+{cost}/{budget})")
            elif c.required:   # 必需项超预算 → 可信压缩，绝不丢弃
                c2 = c.compressed(max_chars=80, pointer=f"artifact://{c.item_id}")
                packed.append(c2)
                used[c.zone] = used.get(c.zone, 0) + c2.token_estimate
                trace.log(c.item_id, "compress", f"必需项压缩装入 {c.zone} 区")
            elif budget - cur >= 60 and len(c.content) > 100:
                # 弹性区的长物品也尝试可信压缩：摘要化装入剩余预算，指针保留（篇06 §3.4）
                c2 = c.compressed(max_chars=(budget - cur - 22) * 3 // 2,
                                  pointer=f"artifact://{c.item_id}")
                packed.append(c2)
                used[c.zone] = cur + c2.token_estimate
                trace.log(c.item_id, "compress",
                          f"超长压缩装入 {c.zone} 区 ({cur}+{c2.token_estimate}/{budget})")
            else:
                trace.log(c.item_id, "budget", f"{c.zone} 区预算不足被挤掉")
        return packed


# ---------- 五个内置 Provider（篇06 §1.4） ----------

class TenantProvider:
    def __init__(self, items: list[ContextItem]): self.items = items
    def collect(self, req): return self.items

TaskProvider = TenantProvider     # 教学版：候选由种子数据注入，结构同构
StateProvider = TenantProvider


class KnowledgeProvider(TenantProvider):
    """SemanticProvider：指标口径库（Metric Registry）的读取端。

    模型在上下文中只见到"指标 ID + 定义引用"，口径 SQL 由语义层注入——
    模型不再"猜口径"，只能"引口径"（篇06 §2.2）。
    """


class EvidenceProvider(TenantProvider):
    """证据区候选：Artifact 引用卡而非原始大结果集（篇06 §5.4）。"""
