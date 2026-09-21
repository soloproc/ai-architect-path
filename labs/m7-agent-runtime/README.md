# M7 · 最小企业级 Agent Runtime 骨架（教学版）

> 《从小白到 AI 架构师》教程配套源码 · RetailHub 零售数据平台之上的 DataAgent 雏形。
> 对应篇目：**篇04-LLM执行底座**、**篇05-AgentHarness与Runtime**，业务口径来自 **篇03-实战立项**。

本模块回答一个问题：一个能离线跑通的企业级 Agent，**最不能省的骨架**是什么？
答案是四层：LLM Runtime（可靠模型调用）→ 统一执行模型（Run/Step/Attempt/Event/Checkpoint）
→ Agent Harness（Loop 之外的管理制度）→ DataAgent（业务工具与场景）。

## 快速开始

```bash
cd retailhub
python3 -m venv .venv && ./.venv/bin/pip install -r m7-agent-runtime/requirements.txt
cd m7-agent-runtime

# 1. 跑通完整诊断场景（MockProvider，无需 API Key；遇到审批提示输入 y）
../.venv/bin/python -m agent.data_agent

# 2. 跑全部测试（事件重放 / Checkpoint 恢复 / 审批幂等）
../.venv/bin/python -m unittest discover -s tests -v

# 3.（可选）切换到真实 Provider
export OPENAI_BASE_URL=... OPENAI_API_KEY=... OPENAI_MODEL=...
# 然后把 agent/data_agent.py 里的 MockProvider 换成 OpenAICompatibleProvider()
```

## 架构图

```
┌────────────────────────────────────────────────────────────────┐
│ agent/data_agent.py   DataAgent 雏形（业务层）                    │
│   工具: query_orders(low) calc_metric(low) create_ticket(high)  │
│   场景: "上周 GMV 为什么下滑" → 查询→计算→对比→归因→建工单        │
├────────────────────────────────────────────────────────────────┤
│ runtime/harness.py    Agent Harness（管理制度，≠ Loop）           │
│   计划-执行-观察循环 · ToolRegistry(ToolContract+risk_level)      │
│   Stop Condition(done/预算/人工) · Autonomy Budget · Human Gate  │
├────────────────────────────────────────────────────────────────┤
│ runtime/execution.py  统一执行模型（状态层）                      │
│   Run 状态机 · Event(append-only→SQLite) · Checkpoint 保存/恢复  │
│   approvals 表 = 审批持久化 + 副作用幂等键                        │
├────────────────────────────────────────────────────────────────┤
│ runtime/llm.py        LLM Runtime（模型底座）                     │
│   ModelRequest/ModelResponse 统一契约 · ProviderAdapter 协议      │
│   MockProvider(离线脚本) / OpenAICompatibleProvider(真实)         │
│   ReliableExecutor: 超时·指数退避重试·Deadline·token 成本记账     │
└────────────────────────────────────────────────────────────────┘
              ▼ SQLite: agent/agent_events.db（事件流+检查点+审批）
              ▼ SQLite: agent/retail.db（M1 风格零售库，自带 seed）
```

## 代码 ↔ 教程概念对照表

| 代码（类/函数） | 教程概念 | 出处 |
| --- | --- | --- |
| `llm.ModelRequest` / `ModelResponse` | 统一调用契约（统一入口 + 保留能力差异） | 篇04 §1.3 |
| `llm.ProviderAdapter` | Provider Adapter（协议翻译 + 故障语义映射） | 篇04 §1.3 |
| `llm.MockProvider` | 离线确定性模型；评测/回放雏形 | 篇04 §4.3 → 篇09 |
| `llm.OpenAICompatibleProvider` | 真实 Provider 适配器（function calling） | 篇04 §1.3 |
| `llm.RetryableError` / `NonRetryableError` | 故障语义统一（只对瞬时故障重试） | 篇04 §3.2 |
| `llm.ReliableExecutor` | Logical Call 的 Attempt 生命周期：Timeout/Retry/Deadline | 篇04 §3.1/§3.2 |
| `ReliableExecutor.total_usage` | 成本记账（事中闸门 + 事后归集的雏形） | 篇04 §4.2 |
| `execution.Run` / `RunState` / `transition` | Run 状态机（白名单迁移，模型无权改状态） | 篇05 §3.2 |
| `execution.Event` / `EventStore` | append-only 事件流，Event Sourcing | 篇05 §3.1/§6.3 |
| `execution.Checkpoint` / `latest_checkpoint` | Step 边界快照 + 事件游标，崩溃恢复 | 篇05 §3.1/§4.2 |
| `execution.replay()` | "状态即事件的结果"的可执行证明 | 篇05 §3.3 |
| `EventStore.approvals` 表 | Human Approval 持久化 + 副作用幂等键 | 篇05 §4.3/§4.4 |
| `EventStore.mark_executed()` | 恢复查账：同一幂等键业务效果最多一次 | 篇05 §4.4 |
| `harness.ToolContract` / `ToolRegistry` | 工具契约与风险分级（控制权矩阵工具侧） | 篇05 §1.3 |
| `harness.AutonomyBudget` | 自主性不是开关，是预算 | 篇05 §1.5 |
| `harness.AgentHarness._loop` | 计划-执行-观察循环 + 五类 Stop Condition 的三类 | 篇05 §2.1/§2.3 |
| `AgentHarness._execute_tool` 高风险分支 | Human Gate：持久化挂起 + 事件回调 | 篇05 §4.3 |
| `data_agent.calc_metric` | 指标口径由代码持有（语义层雏形，模型不许猜） | 篇05 §1.3 → 篇06 |
| `data_agent.seed_retail_db` | 数据即 fixture，基线可复现 | 篇03 §4.2 |

## 教学版已实现的 Stop Condition（篇05 §2.3 五选三）

1. **成功停止**：模型返回无工具调用的最终答复（done 信号）→ `COMPLETED`；
2. **预算耗尽**：`AutonomyBudget.check()` 任一维度触顶 → 落 `budget_exhausted` 事件后降级退出；
3. **人工停止**：Human Gate 拒绝 → `FAILED`。
（未实现：无进展检测、同类错误升级——见下文演进指引。）

## 教学版的已知简化（有意为之）

- 单进程同步执行：没有 Scheduler/Queue/Worker/Lease（篇05 §5），因为"先把幂等键与事件流建好，分布式只是顺手的事"（篇05 常见误区 #5）；
- MockProvider 不校验 `response_schema`，Output Contract 三道防线（篇04 §3.3）只做了一道（结构化 tool_calls）；
- 无多租户与配额（篇05 §5.4）；无 Artifact Store，工具结果直接进消息。

## 下一步：怎么把它演进成篇06-09 的样子

| 方向 | 从这里的哪块长出去 | 对应篇目 |
| --- | --- | --- |
| 上下文治理：`state["messages"]` 换成结构化 `AnalysisState`（假设树/证据引用），加压缩与分层 | `harness._loop` 里的 `state` | 篇06 |
| 工具治理：ToolContract 加版本/配额/权限，SQL 只读强制与行列权限做成 Query Gateway | `ToolContract` / `query_orders` | 篇07 |
| 记忆治理：把 Run 结论沉淀为可检索记忆，跨 Run 复用诊断经验 | `EventStore` 之上加 Memory 层 | 篇08 |
| 评测与受控进化：`MockProvider` 脚本 → Golden Dataset；`replay()` → 轨迹对比；M0 基线冻结 | `replay` / `seed_retail_db` | 篇09（+篇03 §4） |
| 分布式化：Run 入队、Worker Lease + fencing token、审批超时扫描 | `EventStore` 换成共享存储即可 | 篇05 §5 |
| Durable Workflow 外壳：取数→自主分析→报告→审批→副作用的确定性骨架 | `AgentHarness` 内层 Loop 不动，外套 Workflow | 篇05 §4.1 |

## 目录

```
m7-agent-runtime/
├── runtime/
│   ├── llm.py          # LLM Runtime：契约 / Adapter / Mock / OpenAI兼容 / ReliableExecutor
│   ├── execution.py    # 统一执行模型：Run/Step/Attempt/Event/Checkpoint + SQLite 事件库
│   └── harness.py      # Agent Harness：Loop + 工具注册 + Stop Condition + 审批 + 预算
├── agent/
│   └── data_agent.py   # DataAgent：3 个工具 + GMV 诊断场景（python -m agent.data_agent）
├── tests/              # 事件重放 / Checkpoint 恢复 / 审批幂等（unittest，共 5 例）
├── requirements.txt    # 仅 httpx（仅真实 Provider 需要；MockProvider 纯标准库）
└── README.md
```

## 常见报错 FAQ

- **程序停在 `批准执行 create_ticket?` 不动**：这是高风险工具的人工审批点（Human Gate），
  输入 `y` 回车即继续；这正是篇05 要体验的"持久化挂起"。
- **想重跑但事件库里有旧数据**：删掉 `agent/agent_events.db` 和 `agent/retail.db`
  再跑，seed 是确定性的。
- **`ModuleNotFoundError: No module named 'httpx'`**：教学主路径（MockProvider）
  不需要 httpx；只有切真实 Provider 时才需要 `pip install httpx`。
- **`Ran 0 tests`**：在 m7 根目录跑 `python -m unittest discover -s tests -v`。
