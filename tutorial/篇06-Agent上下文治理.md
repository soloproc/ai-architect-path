# 第六篇：Agent 上下文治理——为每一步决策构建最小充分、可信可控的上下文

## 导语

如果把第五篇的 Runtime 比作 DataAgent 的"心脏和血管"，上下文就是它的"血液"：模型每一个决策的质量上限，不取决于模型本身，而取决于这一次调用时它看到了什么。生产环境里最扎心的一类故障是：模型没挂、工具没挂、数据也在，但结论就是错的——因为该看到的指标口径没进上下文，不该看到的邻租户数据倒进去了。

Demo 阶段的上下文工程通常是一行 `prompt = system + history + tool_results`，字符串越拼越长，直到撞上三个天花板：

1. **质量天花板**：窗口被历史记录和大查询结果塞满，真正关键的指标口径被挤出注意力焦点；
2. **安全天花板**：外部文档里的恶意文本、邻租户的数据、过期的指标定义，和系统指令混在同一个信任级别里；
3. **治理天花板**：出了错无法回答"它当时到底看到了什么"，更无法回归"改了检索策略会不会变好"。

本篇把"拼 Prompt"升级为 **Context Runtime（上下文运行时）**：为 DataAgent 的每一个决策步骤定义信息契约，用统一的 Context Schema 携带元数据，用装配管线在预算内做硬性过滤与软性排序，用语义层保证"先理解指标再接触数据"，用证据体系区分假设/证据/结论，并在安全、追踪和评测上让每一次信息选择可审计、可回放、可回归。贯穿案例仍是多租户零售经营分析 DataAgent：GMV 下滑诊断的证据链，和一次跨小时的中断恢复。

---

## 1. 从 Prompt 拼接到 Context Runtime：先定义每一步决策的信息契约

### 1.1 上下文 ≠ Prompt

"上下文"常被默认等同于"发给模型的那串文本"。这个等式是治理失败的起点。拆解一下，一次模型调用的输入里其实混着四类性质完全不同的东西：

| 信息类别 | 来源 | 生命周期 | 信任级别 |
|---|---|---|---|
| 对话历史 | 用户与模型的过往消息 | 整个 Session | 中（用户输入，需防注入） |
| 任务与运行状态 | Task Contract、Analysis State | 单个 Run | 高（系统持有） |
| 业务知识 | 指标口径、经营规则、文档 | 跨 Run、按版本演进 | 高（治理过的）/ 低（未治理的外部内容） |
| 工具与检索结果 | SQL 结果、文档、网页 | 单个 Step 为主 | 低（外部数据，视为不可信） |

它们混在一起拼接，就意味着：治理策略（谁能看）、生命周期（该留多久）、信任级别（能不能当指令）全都丢失了。Context Runtime 的第一步就是把这四类**分库、分 schema、分生命周期**管理，只在"调用模型前一刻"按需装配。

### 1.2 面向决策组织上下文

DataAgent 的一次 Run 里有性质迥异的决策点，它们需要看到的东西完全不同：

| 决策步骤 | 必须看到 | 可以看到 | 禁止看到 |
|---|---|---|---|
| 分析规划 | 任务契约、指标口径、可用数据源清单 | 历史类似案例摘要 | 原始大表、具体证据数据 |
| 查询设计（写 SQL） | 指标口径、目标表 schema、行列权限、时间语义 | 少量样例值 | 无关表结构、超权限字段 |
| 证据验证 | 当前假设、对应查询结果（Artifact 引用）、数据新鲜度 | 相邻假设结论 | 无来源的二手结论 |
| 建议生成 | 已验证的证据链、经营规则、风险分级 | 原始明细的摘要 | 未验证的假设、超权限数据 |

"共用一套大 Prompt 模板"的问题在这里一目了然：给写 SQL 的步骤塞进整份经营规则文档，既浪费 token 又稀释注意力；给建议生成步骤放进未验证假设，报告就会一本正经地写推测。**每个决策点有自己的输入契约（Decision Context Contract）：必须看到、可以看到、禁止看到，三张清单都由代码执行，不靠模型自觉。**

### 1.3 统一 Context Schema：每条信息自带元数据

契约要可执行，前提是每条进入上下文的信息是结构化对象而不是裸字符串：

```text
ContextItem {
  id, content 或 artifact_ref,
  source: "semantic_layer" | "sql_result" | "user_input" | "external_doc" | ...,
  version: "metric_registry v42"           # 来源版本，可追溯可复现
  trust: "system" | "tenant_governed" | "external_untrusted",
  permission_scope: { tenant_id, roles, row_col_policy_ref },
  confidence: 0.0~1.0 或枚举(governed/derived/unverified),
  lifecycle: "step" | "run" | "session" | "persistent",
  freshness: { data_as_of, ingested_at, ttl },
  token_cost: 估计占用
}
```

元数据不是装饰：权限过滤看 `permission_scope`，新鲜度检查看 `freshness`，防注入看 `trust`，预算分配看 `token_cost`，审计回放看 `source + version`。**没有元数据的上下文不可治理**——这句是本篇的元规则。

### 1.4 拆分 Context Provider

把信息获取从 Prompt 构造逻辑里解耦，每类信息一个 Provider：

- `TenantContextProvider`：租户身份、角色、行列级权限；
- `TaskContextProvider`：Task Contract、当前 Step 目标；
- `RunStateProvider`：Analysis State、计划进度、预算消耗；
- `SemanticProvider`：指标口径、术语别名（下一节的主角）；
- `EvidenceProvider`：Artifact 引用与证据包。

Provider 化让每类信息可以独立缓存、独立测试、独立版本化。第 6 节的 ContextOps 会证明这种拆分的回报。

### 1.5 关键上下文缺失即停止

最重要的治理规则只有一条：**宁可报错停止，不可带着猜测继续。** 指标口径查不到、租户身份解析失败、目标表权限不明确——这些情况下正确行为是 Run 进入"阻塞待补全"状态并报出缺什么，而不是让模型"根据经验合理推测"。DataAgent 猜错一次 GMV 口径，损失的可能是一次真实预算决策。

---

## 2. 经营语义上下文：让 DataAgent 先理解指标，再接触数据

### 2.1 数据库字段 ≠ 业务语义

让模型对着 `dwd_trade_order_di` 表猜"GMV"，它会编造：是含退款还是不含？含运费吗？按下单时间还是支付时间？企业里这些问题都有**确定答案**，但答案不在字段名里，在人的约定里。语义层（Semantic Layer）就是把这些约定显式化、机器可读化。

### 2.2 语义层的六个构件

1. **指标统一定义（Metric Registry）**：每个核心指标一条注册记录——`gmv = sum(pay_amount) where pay_status='success'`，含统计口径、责任部门、版本号。多租户环境下口径允许按租户定制，但**每个租户每个时刻只有一个生效版本**，模型只引用不创造。
2. **术语与别名**：建立"销售额 / 成交额 / GMV / gmv"→ 同一指标 ID 的映射，自然语言映射由查表完成，不靠模型联想。
3. **粒度与时间语义**：显式声明指标的粒度（日/周/自然月）、时区（UTC+8）、币种、以及"上周"指自然周还是近 7 天。这类歧义是经营分析错误的高发区，且错得毫无痕迹。
4. **Data Catalog 与血缘**：指标 → 物理表字段 → 计算规则 → 上游数据源的链路。它让每条结论可追溯，也让"这个字段能不能这么用"有据可查。
5. **权限先于相关性**：检索和装配的第一道闸是权限——当前租户+角色无权访问的表、字段、行，**根本不进入候选池**，而不是"检出来再提醒模型别用"。相关性永远排在权限之后。
6. **数据新鲜度与质量**：每个数据资产带 `data_as_of`（数据截止时间）与质量标记。用延迟 6 小时的库存数据解释"此刻为什么缺货"，结论必然失真；上下文应显式携带新鲜度，让模型（和人类读者）知道证据的时间边界。

DataAgent 实战落点：为 GMV、订单数、客单价、转化率、退款率建 Metric Registry，每条含口径 SQL、粒度、时区、币种、版本、负责人。模型在上下文中只见到**指标 ID + 定义引用**，口径 SQL 由语义层在查询设计时注入——模型不再"猜口径"，只能"引口径"。

---

## 3. 动态上下文装配与预算

### 3.1 装配管线化

把"拼字符串"改造成可观测的流水线：

```mermaid
flowchart LR
    subgraph Candidates["候选收集"]
        P1[TenantProvider] & P2[TaskProvider] & P3[StateProvider] & P4[SemanticProvider] & P5[EvidenceProvider]
    end
    Candidates --> F1["① 硬性过滤<br/>权限/租户/有效期/信任级别"]
    F1 --> F2["② 软性排序<br/>与当前决策的相关性打分"]
    F2 --> F3["③ 去重与冲突处理<br/>同指标多版本/矛盾证据"]
    F3 --> F4["④ 分区 Token Budget 分配<br/>必需信息保底"]
    F4 --> F5["⑤ 可信压缩<br/>摘要化 / Artifact 引用替换"]
    F5 --> F6["⑥ 调用前充分性检查<br/>必需项是否齐备"]
    F6 --> LLM["LLM 调用"]
    F1 -.->|被过滤原因| T[(Context Decision Trace)]
    F2 & F3 & F4 & F5 -.-> T
```

管线化的意义：每一阶段可单测、可打日志、可替换实现。"这次调用为什么没看到退款率口径"能被定位到具体阶段——是候选没产出、被权限过滤了、还是被预算挤掉了。

### 3.2 硬性过滤与软性排序

- **硬性过滤**不可被相关性绕过：跨租户数据、超角色权限的字段、已过有效期的口径版本、`trust=external_untrusted` 的内容想进指令区——一律在第一阶段出局，无论它和问题"多相关"。这是安全底线，不接受"它真的很相关所以破例"。
- **软性排序**只在通过硬闸的候选内进行：按与当前 Step 决策的相关性打分排序，决定预算不够时谁先谁后。

顺序绝对不能反：**先过滤后排序**。反过来做，等于让相关性有机会为越权内容说情。

### 3.3 分区 Token Budget

不给上下文分区，结果就是谁嗓门大（内容长）谁占窗口：一次 5 万行的 SQL 结果把指标口径挤没了。分区预算给每类信息划地：

| 分区 | 内容 | 典型占比 | 保障级别 |
|---|---|---|---|
| 规则区 | 系统指令、行为准则、输出格式 | 15% | 硬性保底 |
| 任务区 | Task Contract、当前 Step 目标 | 10% | 硬性保底 |
| 状态区 | Analysis State 摘要、未闭合问题 | 15% | 硬性保底 |
| 语义区 | 本步涉及的指标口径、维度定义 | 20% | 高优先 |
| 证据区 | Artifact 引用、关键证据摘要 | 25% | 弹性 |
| 输出预留 | 模型回答空间 | 15% | 硬性保底 |

核心原则：**必需信息优先保障**。工具描述、历史记录、检索结果只能在弹性区内竞争，永远不许挤占保底区。

### 3.4 去重、冲突与可信压缩

- **去重**：同一指标定义被三个 Provider 各送一遍？按 `source + version` 去重，保留一份。重复证据只留引用计数。
- **冲突处理**：两条信息矛盾（口径 v41 说 GMV 含运费、v42 说不含）时，规则化裁决：版本新者优先、治理级别高者优先、且**冲突事实本身写入上下文**让模型知悉，而不是静默二选一。
- **可信压缩与 Artifact 引用**：5 万行的查询结果不进上下文，进 Artifact Store，上下文中只放 `{artifact_id, 行列规模, 关键统计量, 数据时间}` 的引用卡。压缩必须"可信"：摘要须保留来源引用与数据时间，禁止摘要改写成与原文矛盾的新断言（压缩不变量见第 5 节）。
- **调用前充分性检查**：装配完成、调用模型前的最后一道闸：当前 Step 契约里"必须看到"的项是否都在？缺了，停止调用并报缺失项——把"能调就调"改成"够了才调"。

### 3.5 代码骨架：ContextAssembler

```python
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Protocol

@dataclass
class ContextItem:
    id: str; content: str | None; artifact_ref: str | None
    source: str; version: str; trust: str        # system/governed/external
    tenant_id: str; roles: set[str]; lifecycle: str
    data_as_of: float; token_cost: int; required: bool = False

class Provider(Protocol):
    def collect(self, req: "AssembleRequest") -> list[ContextItem]: ...

@dataclass
class AssembleRequest:
    run_id: str; tenant_id: str; role: str
    step_contract: dict          # 本步决策契约：必须/可以/禁止
    budgets: dict[str, int]      # 分区 token 预算, 如 {"rules":3000,"semantic":4000,...}

class ContextAssembler:
    def __init__(self, providers: list[Provider], ranker, trace_sink):
        self.providers, self.ranker, self.trace = providers, ranker, trace_sink

    def assemble(self, req: AssembleRequest) -> "AssembledContext":
        # 1. 收集候选
        cands = [c for p in self.providers for c in p.collect(req)]
        self.trace.log("candidates", [(c.id, c.source, c.version) for c in cands])
        # 2. 硬性过滤：租户、角色权限、有效期、信任边界 —— 不可被相关性绕过
        kept = [c for c in cands if self._hard_pass(c, req)]
        self.trace.log("filtered", [(c.id, "hard_filter") for c in cands if c not in kept])
        # 3. 软性排序：只在过闸者内部按相关性排
        ranked = self.ranker.rank(kept, req)
        # 4. 去重与冲突裁决（按 source+version 去重；版本新/治理级别高者优先）
        ranked = self._dedup_and_resolve(ranked)
        # 5. 分区预算：required 项保底装入，弹性项按序填充
        packed = self._pack_by_budget(ranked, req.budgets)
        # 6. 充分性检查：契约必需项缺失即拒绝调用
        missing = [m for m in req.step_contract["required_ids"]
                   if m not in {c.id for c in packed}]
        if missing:
            raise InsufficientContext(missing)   # 停止执行，报告缺口
        return AssembledContext(items=packed, trace_id=self.trace.id)

    def _hard_pass(self, c: ContextItem, req) -> bool:
        return (c.tenant_id == req.tenant_id and req.role in c.roles
                and not self._expired(c) and self._trust_allowed(c, req))
```

### 3.6 DataAgent 实战：四个 Context Profile

为规划、查询设计、原因分析、建议生成各建一份 Profile：规划 Profile 的语义区占大头、证据区留空；查询设计 Profile 加大 schema 与行列权限、砍掉历史对话；原因分析 Profile 把预算向证据区倾斜；建议生成 Profile 只收"已验证"状态的证据引用。四个 Profile 共用同一条管线、不同的契约参数——这正是 Provider 化与契约化带来的复用。

看完代码骨架，用下面的交互 Demo 把整条管线亲手跑一遍：左侧候选池有 15 条信息，里面埋了四处隐患——一条租户 B 的口径、一份含注入指令的外部文档、一对冲突的 GMV 口径版本、一条重复投递的证据。点「开始装配」，观察四段管线如何依次裁决：跨租户与不可信条目在①硬过滤直接出局（无论它多"相关"），v41 口径在②冲突裁决中被 v42 取代，③分区装填时证据区预算不足会把 5 万行原始结果压缩成 Artifact 引用卡。然后把 Token Budget 拖到 4000 以下，看保底区纹丝不动、弹性证据区先压缩后剔除的取舍顺序；最后打开「关闭硬过滤」开关再跑一次——右侧审计日志会告诉你注入与跨租户泄漏是怎样发生的：

```demo context-assembler
```

---

## 4. 企业知识与 Agentic Evidence：围绕信息缺口构建证据包

### 4.1 知识可用性治理

"文档已入库"和"知识可用"之间隔着一条鸿沟：PDF 表格丢了表头、指标文档解析后公式变成乱码、权限元数据没同步导致谁都检索不到、旧版本和新版本同时可被召回。**入库只是开始，可用性才是目标**：解析保结构（表格带表头、公式可机读）、元数据齐全（来源、版本、权限、时效）、入库前做可用性抽检（抽几篇让检索链路真跑一遍）。

### 4.2 面向信息缺口选择数据源

成熟的做法不是"所有问题先过一遍向量库"，而是让 Agent 先看 Analysis State 里的 `open_questions`，再按缺口类型选路：

| 信息缺口 | 首选数据源 |
|---|---|
| 这个指标怎么定义 | Metric Registry / 语义层 |
| 事实数据是多少 | SQL 经 Query Gateway 查数仓 |
| 这类情况一般怎么处理 | 经营规则库 / 治理过的知识库 |
| 上次类似分析的结论 | 历史 Run 的 Artifact（报告、图表） |
| 外部行情/竞品 | 外部检索（标记 external_untrusted） |

### 4.3 Agentic Search 与搜索预算

一次 Top-K 检索覆盖不了"GMV 为什么跌"这种复合问题。Agentic Search 是**多轮、由缺口驱动的检索循环**：检索 → 评估是否闭合了某个 open_question → 没闭合就改写查询或换数据源再来。但循环必须有笼头：

- **搜索预算**：每次 Run 的检索次数、检索成本上限（纳入 Autonomy Budget）；
- **停止条件**：缺口闭合、预算耗尽、或连续两轮无新增有效信息即停，并显式记录"缺口未闭合"——未闭合的缺口必须出现在最终报告里，而不是被沉默地带过。

### 4.4 假设 / 证据 / 结论：三分法与 Claim-Evidence 关系

经营报告最大的信任杀手，是把"我猜的"写成"我查到的"。工程上强制三分：

```mermaid
flowchart TD
    Q["GMV 环比 -12%（事实）"] --> H1["假设1: 流量下滑"]
    Q --> H2["假设2: 转化率下降"]
    Q --> H3["假设3: 客单价下降"]
    H1 --> E1["证据: UV 环比 -18%<br/>artifact#8821, 数据截至周一"]
    H2 --> E2["证据: CVR 环比 -9%<br/>artifact#8822"]
    H2 --> E3["证据: 跳失率 +6pp<br/>artifact#8823"]
    H3 --> E4["证据: 客单价持平 ±1%<br/>artifact#8824"]
    E1 --> C1["结论: 主因流量下滑（贡献约七成）"]
    E2 & E3 --> C2["结论: 次因转化恶化"]
    E4 -.->|假设3被排除| Q
```

三条铁律：

1. **假设先显式化**：每个待验证猜想进入假设树，状态 pending；
2. **证据定生死**：假设只能被挂有 Artifact 引用（含查询参数与数据时间）的证据支持或排除，模型"觉得合理"不算数；
3. **结论必须挂证据**：最终报告的每条 Claim 携带 `evidence_ids`，无证据的句子要么降级为"待验证假设"写入报告，要么删除。审计时可以沿着 Claim → Evidence → Artifact → SQL 与数据时间一路下钻。

GMV 诊断的实战形态就是"流量—转化—客单价—库存—退款"假设树逐层验证，被排除的分支同样保留在报告里——**"排除了什么"和"证实了什么"一样是结论的一部分**。

---

## 5. 长任务上下文治理：数小时运行不丢目标、不重做、不漂移

### 5.1 先分清四样东西

| 概念 | 是什么 | 存哪 | 给谁用 |
|---|---|---|---|
| History | 原始消息与工具调用流水 | 事件流/日志 | 审计、Replay |
| State | 当前计划、假设树、预算消耗 | Analysis State（结构化） | Harness 决策 |
| Checkpoint | State 在某 Step 边界的快照 | Checkpoint Store | 崩溃恢复 |
| Summary | 面向特定读者的压缩视图 | 上下文内 | 模型/人阅读 |

四者混用（典型：什么都靠翻聊天记录）是长任务一切病症的总根：窗口爆炸、目标丢失、重复劳动。

### 5.2 生命周期与按用途摘要

每条 ContextItem 的 `lifecycle` 决定它活到哪：`step` 级（本次工具调用的中间输出，用完即弃）、`run` 级（本次任务的假设树）、`session` 级（用户偏好）、`persistent` 级（指标口径）。**错误地延长生命周期是上下文污染的温床**——上一步的临时 SQL 报错被带进三小时后的报告生成，模型可能把它当成当前问题。

摘要也不能一种通用，要**按用途生成**：

- **步骤摘要**：给下一步用，保留"做了什么、产出引用、下一步要做什么"；
- **阶段摘要**：给 Verifier 和恢复用，保留假设状态迁移与证据引用清单；
- **交接摘要**：给另一个 Agent（或人）用，突出目标、约束、未闭合问题；
- **用户报告摘要**：给业务读者，自然语言、结论先行、附证据链接。

混用的典型事故：把给模型续跑用的步骤摘要直接发给业务老板——满屏 artifact_id。

### 5.3 压缩保留不变量

压缩必然丢信息，所以要先立法——**压缩后必须保留的不变量**：

1. 原始目标与 Task Contract 原文（或其不可变引用）；
2. 未完成任务与未闭合问题清单；
3. 关键约束（预算余额、权限边界、禁区）；
4. 失败记录（什么试过、为什么不行——防止重做已排除的路径）；
5. 证据引用（artifact_id 指针必须存活，正文可压，指针不许丢）。

压缩策略上线前用 Replay 验证：压缩前后的 State 跑同一批下游 Step，结论不应漂移。

### 5.4 Artifact Store 与恢复时装配

SQL 结果集、图表、日志等大对象一律入 Artifact Store，上下文只留引用卡。这把"上下文窗口"从存储介质解放成"工作台"。

**恢复时重新装配，而不是重放历史**：中断两小时后的 Run 恢复时，正确做法是从 Checkpoint 加载 State，然后**走一遍装配管线**重新取数——租户权限可能已收窄、指标口径可能已发新版、数据新鲜度已变化。直接重放旧上下文等于用过期权限和过期口径继续干活。

### 5.5 多 Agent 协作拓扑与 Parent-Child Handoff

| 拓扑 | 做法 | 优点 | 风险 |
|---|---|---|---|
| 共享完整上下文 | 子 Agent 读父 Run 全部历史 | 简单 | 权限放大、窗口爆炸、目标稀释 |
| 显式 Handoff | 父打包"交接摘要"传给子 | 可控、可审计 | 摘要写不好就丢关键信息 |
| Artifact 引用 | 只传 artifact 指针 | 省 token | 子 Agent 缺背景，易误读 |
| **Parent-Child Run** | 子 Run 是独立 Run，父沿图边传受控载荷 | 权限收敛、可独立恢复审计 | 架构最重 |

DataAgent 的推荐形态是 Parent-Child Run：月度分析派生"库存分析"Child Run 时，父 Run 显式构造交接载荷——子目标、该子任务专属的只读数据权限、相关证据引用、预算子额度。子 Run 不继承父的全部上下文和全部权限（**权限随子任务收敛而非继承放大**），完成后回传结论摘要 + 证据引用，父 Run 将其并入自己的假设树。

### 5.6 Context Drift 检测

长任务最隐蔽的失败是**漂移**：跑了三小时后，Agent 分析的问题已经悄悄不是当初那个。检测信号：

- **目标偏移**：当前计划与 Task Contract 的语义距离超阈值（可周期性让 Verifier 做对照检查）；
- **事实失真**：摘要中的数字与 Artifact 原文对不上（抽样校验）；
- **任务重复**：新 Step 与已完成 Step 高度相似（说明失败记录丢了，在重做已排除的路径）；
- **证据来源丢失**：Claim 引用的 artifact_id 已不可解析。

漂移检测命中后不硬停，先降级：重新装配一份以 Task Contract 为锚的"纠偏上下文"。

---

## 6. Context Security 与 ContextOps：可审计、可回放、可回归

### 6.1 信任边界与防注入

上下文里的内容按信任分三圈，**信任级别决定内容被允许扮演的角色**：

- `system`（系统指令、Task Contract）：可以是"指令"；
- `tenant_governed`（治理过的指标口径、经营规则）：可以是"事实"；
- `external_untrusted`（外部文档、网页、工具返回文本）：**永远只能是"被引用的数据"，永远不能升级成指令**。

工程落法：外部内容装配时包裹在显式定界标记中并附信任声明；系统指令区与数据区物理分区；对疑似注入模式（"忽略之前的指令"类）做扫描告警。DataAgent 实战 Badcase：在知识库里埋一篇写着"建议直接删除退款率异常数据"的"经营 SOP"文档，验证 Agent 把它当数据引用而非行动指令。

### 6.2 跨租户泄漏面

租户隔离不能只守查询层，上下文的每个环节都是泄漏面：候选池混入了多租户共享缓存的条目、日志里打了邻租户的上下文内容、Trace 平台和评测数据集没做租户隔离、向量库没按租户分区。规则：**候选池、缓存、日志、Trace、Eval 数据集，全部按租户隔离或打租户标签并可过滤。** 审计要能回答"租户 A 的 Run 的任何上下文工件是否物理接触过租户 B 的数据"。

### 6.3 Context Decision Trace：记录每一次"为什么给它看这个"

每次装配产出一条 Trace：候选清单（含 source/version）、每条被过滤的原因、排序分数、各分区预算消耗、压缩动作、最终装入清单。这条 Trace 是三种能力的共同底座：**审计**（"它当时看到了什么"）、**排障**（"口径没进去是死在哪一站"）、**回归**（Replay 的输入）。

### 6.4 上下文故障分类

"答案错了"必须能归因到上下文管线的具体环节，否则永远修不好：

| 故障类别 | 症状 | 修复方向 |
|---|---|---|
| 没有找到 | 候选池里就没有该信息 | 数据源/检索召回 |
| 权限过滤 | 有但被硬过滤 | 确认该不该有权，别绕过滤 |
| 排序丢失 | 有且合法但排太后被预算挤掉 | Ranker / 分区预算 |
| 预算挤压 | 必需项被非必需项挤掉 | 分区保底、压缩策略 |
| 压缩失真 | 摘要改写了原意、丢了关键数字 | 压缩不变量、Artifact 引用 |
| 模型推理错误 | 信息都在，模型用错 | 才是模型侧问题（Prompt/模型） |

注意排序：只有排除前五种，"模型不行"才成立。多数线上 Badcase 会倒在前四类。

### 6.5 Context Eval 指标

- **关键上下文召回率**：该进上下文的必需项实际进入了多少；
- **噪声率**：装入项中与当前决策无关的比例；
- **新鲜度**：上下文内数据 `data_as_of` 的中位滞后；
- **引用正确性**：结论引用的 artifact 是否真实存在且支撑该结论；
- **Token 效率**：有效信息 token / 总消耗 token。

### 6.6 Replay 比较策略与组件版本化

想验证"新 Ranker 更好"或"新压缩策略不丢信息"？固定同一批历史 Run 的候选集（从 Decision Trace 回放），只换一个组件，比较装配结果与下游结论差异——这就是上下文层的 A/B。配套纪律：**Context Policy、Ranker、Assembler、Provider 各自独立版本化**，每次变更只动一个组件，否则行为整体漂移后无法归因。DataAgent 收官动作：注入恶意文档、过期指标版本、跨租户数据、预算挤压四类 Badcase 进 Replay 管线，全部拦截/降级成功，安全与回归测试才算收口。

---

## 常见误区

1. **上下文工程 = 写好 System Prompt**：写一段漂亮的"你是资深分析师"不叫上下文治理。没有元数据、没有契约、没有管线，Prompt 文学救不了生产事故。
2. **窗口大就使劲塞**：200K 窗口不是塞满 200K 的理由。塞得越多，关键信息注意力权重越低，且成本线性上涨。最小充分永远优于大而全。
3. **权限靠 Prompt 提醒**："请不要使用其他租户的数据"写在 Prompt 里约等于没写。权限必须在硬过滤层物理执行。
4. **检索一次就够**：复杂经营问题靠一次 Top-K 必漏。但也别走另一个极端——无预算的 Agentic Search 就是烧钱的原地打转。
5. **摘要一种通用**：给模型续跑的摘要直接发用户，或给用户写报告时丢了证据引用。摘要按用途分型，压缩有保留不变量。
6. **子 Agent 天然该继承一切**：把父 Run 全量上下文和权限复制给 Child Run，等于亲手制造权限放大和目标稀释。交接载荷要显式设计。
7. **上下文出故障怪模型**：先按故障分类表查管线（没召回？被过滤？被挤压？被压坏？），排完才轮到怀疑模型。

## 动手练习

1. **契约设计**：为 DataAgent 的"库存缺货归因"Step 写一份 Decision Context Contract（必须/可以/禁止三清单），并说明每条"禁止"的工程执行点在哪。
2. **装配管线实现**：基于 3.5 节骨架实现简化版 Assembler，构造 20 条候选 ContextItem（含跨租户、过期、超权限、重复项），跑通管线并输出 Decision Trace，验证硬过滤与预算保底行为。
3. **证据链 Badcase**：构造一个"客单价假设被零行 SQL 结果'支持'"的 Badcase，给你的 Verifier 加规则拦截，并写出拦截后 open_questions 的正确形态。
4. **压缩不变量测试**：写一段 5000 字的分析过程文本，实现一个摘要函数，然后用自动化检查验证 5 条压缩保留不变量逐条成立；找出你实现里最先违反的一条并修复。
5. **安全注入测试**：构造一篇含注入指令的经营知识文档入库，验证 (a) 它被标记 external_untrusted，(b) 装配后处于数据区，(c) Agent 行为不受其指令影响，(d) Decision Trace 记录了该文档的信任级别。

## 自测清单

- [ ] 我能说出上下文的四个信息类别及其生命周期、信任级别差异
- [ ] 我能解释 Decision Context Contract 的三张清单，并举出一个"关键缺失即停止"的例子
- [ ] 我能说出 Context Schema 至少六个元数据字段及各自被管线哪一环消费
- [ ] 我能解释为什么"权限先于相关性"，并指出硬过滤与软排序的正确顺序
- [ ] 我能画出装配管线六个阶段，并给每阶段举一个故障实例
- [ ] 我能说明 Metric Registry 如何让模型从"猜口径"变成"引口径"
- [ ] 我能区分假设/证据/结论，并描述 Claim-Evidence 链路的追溯路径
- [ ] 我能区分 History / State / Checkpoint / Summary 及各自存储位置
- [ ] 我能列出至少五条压缩保留不变量，并说明违反后果
- [ ] 我能解释 Parent-Child Run 相比共享上下文的权限优势
- [ ] 我能描述信任三圈模型及防注入的工程落法
- [ ] 我能按六类上下文故障定位一个 Badcase，并用 Replay 比较两种修复策略
