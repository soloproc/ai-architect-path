# RetailHub 实操源码包 · 《从小白到 AI 架构师 / AI 全栈架构师之路》配套实验

贯穿项目 RetailHub（零售经营数据平台）的里程碑源码仓库。每个里程碑目录
**自包含、可独立运行**：解压 → 建一次虚拟环境 → 进目录 `bash run.sh` 即可。

## 环境准备（macOS，只需一次）

```bash
# 1. 确认有 python3（≥ 3.10）。没有的话先装命令行工具：
xcode-select --install
#    或者用 Homebrew：brew install python3

# 2. 在本目录（labs/）建统一虚拟环境并装全部依赖
bash bootstrap.sh
#    等价于手工执行：
#    python3 -m venv .venv
#    source .venv/bin/activate
#    pip install -r requirements-all.txt
```

> pip 下载慢/超时：换国内镜像再试
> `pip install -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements-all.txt`
>
> 也可以给每个里程碑单独建环境（各目录 README 有说明），但**一个根 .venv 就够全部里程碑用**。
> M3/M4/M8/M9 只用标准库，不装依赖也能跑。

## 里程碑地图

| 目录 | 对应教程 | 学什么 | 一键冒烟 |
|---|---|---|---|
| `m1-monolith/` | 卷01《服务端筑基》 | FastAPI + SQLite 单体：分页、JOIN 明细、GMV 口径、访问日志 | `bash run.sh` 起服务，验收命令见目录 README |
| `m2-cache-mq/` | 卷02《服务端架构演进实践》 | Cache-Aside 缓存（防穿透/防雪崩）、异步队列、读写分离 | `bash run.sh` 起服务 |
| `m3-oversell-lab/` | 卷03《数据密集型系统 DDIA》 | 隔离级别实验：naive 必现超卖 vs 原子 UPDATE 正确互斥 | `bash run.sh` |
| `m4-traffic-observability/` | 卷04《分布式架构与平台工程》 | 熔断器状态机、令牌桶限流、Outbox 本地消息表、极简调用链 | `bash run.sh` |
| `m5-architecture-docs/` | 卷05《架构师方法论 / 软考备考》 | **文档实战，无代码**：产物是架构文档包（4+1 视图 / 质量属性场景 / ADR / 评审纪要）。本目录提供全套可填模板 | 打开 `docs/` 模板按目录 README 填写 |
| `m6-inference-bench/` | 卷06《AI 基础设施 AI Infra》 | OpenAI 兼容 mock 推理服务、TTFT/TPOT 压测、容量曲线拐点、自建 vs 云成本 | `bash run.sh` |
| `m7-agent-runtime/` | 篇04/篇05《LLM 执行底座 / Harness 与 Runtime》 | 最小企业级 Agent Runtime：统一执行模型、Checkpoint 恢复、人工审批幂等 | `bash run.sh` |
| `m8-context-memory/` | 篇06/篇08《上下文治理 / 记忆治理》 | Context 装配六阶段管线 + 记忆写入五段管线与 Recall Contract | `bash run.sh` |
| `m9-eval-ops/` | 篇09《评测与受控进化》 | 评测集/Fixture/四类 Grader/Multi-Trial/Scorecard/Regression Gate | `bash run.sh` |

学习路径：M1 → M2 → M3 → M4 → M5（文档）→ M6 → M7 → M8 → M9。
每个里程碑跑通后，回到对应卷目完成「本卷实战」的验收清单。

## 通用说明

- 种子数据确定性生成（`random.seed(42)`）：任何人跑出的验收数字一致。
- 仓库根的 `.venv` 是本地环境，**不要打进源码包**（.gitignore 已排除）。
- 各目录 README 内含：运行步骤、预期输出、验收命令、常见报错 FAQ。

## 仓库结构

```
labs/
├── README.md               # 本文件
├── bootstrap.sh            # 一键环境准备（检测 python3 ≥ 3.10 → 建 venv → 装依赖）
├── requirements-all.txt    # 全部代码里程碑的依赖并集
├── m1-monolith/            # 卷01 实战
├── m2-cache-mq/            # 卷02 实战
├── m3-oversell-lab/        # 卷03 实战
├── m4-traffic-observability/  # 卷04 实战
├── m5-architecture-docs/   # 卷05 实战（文档模板，无代码）
├── m6-inference-bench/     # 卷06 实战
├── m7-agent-runtime/       # 篇04/05 实战
├── m8-context-memory/      # 篇06/08 实战
└── m9-eval-ops/            # 篇09 实战
```
