# RetailHub：教程《从小白到 AI 架构师》配套源码

贯穿项目 RetailHub（零售经营数据平台）的里程碑源码仓库。每个里程碑目录
**自包含、可独立运行**，对应教程的一卷实战：

| 目录 | 对应卷目 | 演进主题 |
|---|---|---|
| `m1-monolith/` | 卷01《服务端筑基》 | FastAPI + SQLite 单体：分页、JOIN 明细、GMV 口径 |
| `m2-cache-mq/` | 卷02《服务端架构演进实践》 | Cache-Aside 缓存、异步队列、读写分离、防雪崩 |
| `m3-oversell-lab/` | 卷03《数据密集型系统 DDIA》 | 隔离级别实验：naive 必现超卖 vs 原子方案正确互斥 |
| `m4-traffic-observability/` | 卷04《分布式架构与平台工程》 | 熔断器状态机、令牌桶限流、Outbox 本地消息表、极简调用链 |
| `m6-inference-bench/` | 卷06《AI 基础设施 AI Infra》 | OpenAI 兼容 mock 推理服务、TTFT/TPOT 压测、自建 vs 云成本计算器 |
| `m7-agent-runtime/` | 篇04/篇05《LLM 执行底座 / Agent Harness 与 Runtime》 | 最小企业级 Agent Runtime：统一执行模型、Checkpoint 恢复、人工审批幂等、DataAgent 雏形 |
| `m8-context-memory/` | 篇06/篇08《上下文治理 / 记忆治理》 | Context 装配管线（硬过滤/分区预算/充分性检查）+ 记忆写入五段管线与 Recall Contract |
| `m9-eval-ops/` | 篇09《评测与受控进化》 | 评测集/Fixture/四类 Grader/Multi-Trial/四维 Scorecard/Regression Gate；含质量契约与 M0 基线模板 |

> 卷05（架构师方法论）的产出物是文档而非代码——参考 `m1-monolith/docs/adr/0001` 的 ADR 实例作为起点；卷08（SRE）的告警/postmortem 模板见卷08 正文骨架。

## 学习路径对照

按教程阶段顺序运行里程碑：M1 → M2 → M3 → M4 →（卷05 文档实战）→ M6 → M7 → M8 → M9（M7-M9 分别配合篇04/05、篇06/08、篇09）。每个里程碑跑通后，回到对应卷目完成「本卷实战」的验收清单。

## 通用说明

- Python 3.11+；依赖见各目录 `requirements.txt`（fastapi / uvicorn /
  fakeredis / httpx / pytest，全部纯 pip 安装，无需装 Redis/MySQL）。
- 仓库根的 `.venv` 是本地开发环境，**不要提交进源码树**（.gitignore 已排除）；
  在干净机器上按各目录 README 的步骤重建即可。
- 种子数据确定性生成（`random.seed(42)`）：50 商品 / 5000 订单 / 跨 30 天，
  任何人跑出的验收数字一致。
- 快速开始（以 M1 为例）：

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r m1-monolith/requirements.txt
cd m1-monolith && python -m app.seed && uvicorn app.main:app --port 8000
```

各里程碑的运行步骤、验收命令、讨论点见各自目录的 README。
