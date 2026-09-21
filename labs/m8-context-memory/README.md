# M8 · Context 装配与 Memory 治理（教学版）

> 《从小白到 AI 架构师》教程配套源码 · RetailHub 零售数据平台之上的 DataAgent。
> 对应篇目：**篇06-Agent上下文治理**、**篇08-Agent记忆治理**。仅标准库，Python 3.11+。

本模块回答两个问题：

1. **上下文**：模型每一次决策时"该看到什么"，能不能由管线决定而不是由字符串拼接决定？
   —— 统一 Context Schema + 六阶段装配管线（硬过滤 → 软排序 → 去重冲突 → 分区预算 → 可信压缩 → 充分性检查）。
2. **记忆**：Agent 能不能"有选择地记住、正确地回忆"而不记错、记脏、记串？
   —— 写入管线五段 + 存储三层分离 + Recall Contract 受控召回。

## 快速开始

```bash
cd retailhub/m8-context-memory

# 1. 全流程演示：GMV 下滑诊断的上下文装配 + 记忆写入/召回
python3 demo.py

# 2. 治理行为测试（6 条安全/治理不变量）
python3 -m unittest discover -s tests -v
```

## 目录结构

```
context_eng/            上下文工程（篇06）
  schema.py             ContextItem：内容 + 来源/信任/版本/租户/Scope/TTL/token 元数据
                        不可信来源（external/tool_result）自动包裹"数据而非指令"定界标记
  assembler.py          ContextAssembler 六阶段管线 + 五个 Provider + DecisionTrace
memory_eng/             记忆工程（篇08）
  store.py              存储三层：SQLite 主库（唯一事实来源）/ 词袋余弦向量索引 / Evidence Store
  pipeline.py           写入管线五段：提取→标准化→校验→策略判断→提交（幂等+版本治理）
  recall.py             Recall Contract：意图白名单 + Scope/状态硬过滤 + 三因子排序 + UsageTrace
demo.py                 "GMV 下滑诊断"三幕剧：装配 → 写入 → 召回
tests/test_m8.py        六条治理不变量的可执行证明
```

## 代码 ↔ 教程概念对照表

| 代码（类/函数） | 教程概念 | 出处 |
| --- | --- | --- |
| `schema.ContextItem` | 统一 Context Schema：没有元数据的上下文不可治理 | 篇06 §1.3 |
| `schema.Source` / `Trust` | 信任三圈：system / tenant_governed / external_untrusted | 篇06 §6.1 |
| `schema.ContextItem.render()` | 不可信内容包裹定界标记，永远只是"被引用的数据" | 篇06 §6.1 |
| `schema.ContextItem.compressed()` | 可信压缩：正文可压，引用指针不许丢 | 篇06 §3.4/§5.3 |
| `assembler.ContextAssembler` | 装配管线六阶段 | 篇06 §3.1 |
| `assembler._hard_reject` | 硬性过滤：权限先于相关性，不可被相关性绕过 | 篇06 §3.2/§2.2-5 |
| `assembler._relevance` | 软性排序：只在过闸者内部打分（先过滤后排序） | 篇06 §3.2 |
| `assembler._dedup_resolve` | 去重与冲突：版本新者优先，冲突事实写入上下文 | 篇06 §3.4 |
| `assembler._pack` | 分区 Token Budget：必需信息优先保底 | 篇06 §3.3 |
| `assembler.InsufficientContext` | 关键上下文缺失即停止，不带着猜测继续 | 篇06 §1.5 |
| `assembler.DecisionTrace` | Context Decision Trace：审计/排障/Replay 的底座 | 篇06 §6.3 |
| `KnowledgeProvider` | Metric Registry：模型从"猜口径"变"引口径" | 篇06 §2.2 |
| `store.MemoryStore/VectorIndex/EvidenceStore` | 存储三层：主库是门禁，向量索引只是召回加速器 | 篇08 §2.6 |
| `store.Scope` | 可见范围四元组：召回过滤的全部依据 | 篇08 §2.3 |
| `pipeline.MemoryPolicy` | Memory Policy 四问：写什么/确认否/存多久/谁能用 | 篇08 §1.4 |
| `pipeline.MemoryWritePipeline` | 写入管线五段；任务边界写入，不在推理中途 | 篇08 §2.1/§2.2 |
| `pipeline.validate` | 黑名单：事实数据/临时结论/未证实推测禁止写入 | 篇08 §1.6 |
| `pipeline.commit` | 幂等键 + 语义去重 + 冲突版本治理（superseded 可追溯） | 篇08 §2.4/§2.5 |
| `recall.RecallContract` | Recall Contract 五要素，替代 Blind Top-K | 篇08 §3.1/§3.2 |
| `recall.governed_recall` | 向量层只产候选，回主库校验才是门禁 | 篇08 §2.6/§3.2 |
| `recall.RecalledMemory.as_sql_param=False` | 召回/注入/行动权限分离：记忆不授权"做什么" | 篇08 §3.3 |
| `recall.UsageTrace` | Memory 使用追踪：为什么召回这条，可解释可审计 | 篇08 §3.5 |

## 测试 ↔ 治理不变量

| 测试 | 证明的不变量 |
| --- | --- |
| `test_high_relevance_cross_tenant_rejected` | 硬过滤不可绕过：相关性再高的跨租户 item 也被拒 |
| `test_rules_survive_squeeze` | 分区保底：9 条弹性候选挤压下 rules/task/semantic 区不丢 |
| `test_idempotent_replay` | 写入幂等：同幂等键重放不产生重复记忆 |
| `test_conflict_versioning` | 冲突治理：新版本 v2 生效，旧版本标记 superseded |
| `test_deleted_memory_not_recalled` | 删除传播：主库 deleted + 索引删除后不可召回 |
| `test_cross_tenant_not_recalled` | Scope 硬过滤：语义再像，跨租户记忆也不召回 |

## 与 M7（agent-runtime）组合使用

M8 独立可运行；与 M7 组合时，M8 是 M7 Harness 的"血液科"：
**每次 LLM 调用前过装配管线，每个 Run 结束后过写入管线，召回结果只进 Context。**

```python
# 伪代码：在 M7 的 Harness 循环里嵌入 M8（两模块无 import 依赖，靠组合接线）
from context_eng.assembler import ContextAssembler, AssembleRequest
from memory_eng.recall import RecallContract, RecallIntent, SecurityContext, governed_recall

# ① Harness 发起 LLM Step 前：装配最小充分上下文，替代手拼 prompt
packed, trace = assembler.assemble(AssembleRequest(
    run_id=run.run_id, tenant_id=ctx.tenant_id, role=ctx.role, step=step.name))

# ② 报告类 Step 前：按 Recall Contract 召回记忆，注入为 ContextItem
memories = governed_recall(RecallContract(RecallIntent.REPORTING, step.objective),
                           security_ctx, mem_store, mem_index, usage_trace)

# ③ Run 结束后（任务边界！）：Memory Writer 从 M7 事件流提取候选记忆
for cand in write_pipeline.extract(run.run_id,
        [e.payload for e in event_store.events(run.run_id)]):
    write_pipeline.submit(cand, write_request_id=f"{run.run_id}:{cand.evidence_ref}")
```

关键接线纪律（篇05/篇08 同一哲学）：模型只能**提交记忆候选**和**受控召回**，
没有直写、没有删除、没有 Scope 提升——和"模型不持有执行权"是同一条边界。

## 常见报错 FAQ

- **需要安装依赖吗**：不需要。M8 纯标准库，Python ≥ 3.11 直接跑。
- **`Ran 0 tests`**：在 m8 根目录跑 `python -m unittest discover -s tests -v`。
- **demo 想重跑**：demo 每次运行自动重建临时数据库，直接再跑一遍即可；
  召回打分是确定性的，两次运行结果应一致。
- **`python3: command not found`**：macOS 先 `xcode-select --install` 或 `brew install python3`。
