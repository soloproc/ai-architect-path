# AI 全栈架构师之路

一套从小白到 AI 全栈架构师的自学教程，覆盖完整成长路径：**服务端筑基 → 分布式架构 → DDIA 数据密集型系统 → AI Infra → SRE 可靠性工程 → Agent 工程化 → AI FDE 交付实战**，内含贯穿全程的实战项目 **RetailHub / DataAgent** 源码与 **37 个交互 Demo**。

## ☁️ 云端运行（免安装）

无需本地安装任何环境，点击下面的按钮即可在 **GitHub Codespaces** 云端虚拟机中打开本仓库，9 个里程碑实操源码（`labs/`）和全部 Python 依赖会**自动装好**：

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/soloproc/ai-architect-path)

开机后等待 1-2 分钟（`postCreateCommand` 会自动执行 `pip install -r labs/requirements-all.txt`），然后在终端运行第一个里程碑实验：

```bash
cd labs/m1-monolith && bash run.sh
```

其余里程碑（`labs/m2-cache-mq` … `labs/m9-eval-ops`）用同样方式运行，各目录内均有 `run.sh` 与说明，详见 [labs/README.md](labs/README.md)。

## 在线阅读

- 主站（GitHub Pages）：https://soloproc.github.io/ai-architect-path/
- 备用地址：https://g0cyg8bhmf.feishuapp.com/app/app_17e5p3qx6ev

## 目录结构

```
tutorial/     教程正文（46 页 Markdown + 参考资料存档 + 课程大纲原文）
  ├── README.md            教程首页（网站首页的 Markdown 源）
  ├── 总纲-从小白到AI架构师.md
  ├── 00-课程分析报告.md
  ├── 卷01-1-HTTP与网络基础.md ～ 卷08-3-发布工程与AI服务SRE.md
  │     （篇幅较长的卷已拆分为子页，如 卷02-1 / 卷02-2 / 卷02-3）
  ├── 篇00-1-基本功.md ～ 篇10-面向未来的工程判断.md
  │     （篇幅较长的篇同样拆分为子页，如 篇06-1 / 篇06-2）
  ├── 附录-术语表.md       全书术语速查
  ├── 资料01-服务端架构演进14次.md ～ 资料07-BuildingEffectiveAgents.md
  └── 课程大纲原文.txt
labs/         里程碑实操源码（M1-M9，可在 Codespaces 一键运行，见上方「云端运行」）
  ├── m1-monolith/              M1 单体应用
  ├── m2-cache-mq/              M2 缓存与消息队列
  ├── m3-oversell-lab/          M3 超卖实验
  ├── m4-traffic-observability/ M4 流量治理与可观测
  ├── m5-architecture-docs/     M5 架构文档与评审
  ├── m6-inference-bench/       M6 推理压测与容量规划
  ├── m7-agent-runtime/         M7 Agent Runtime / DataAgent
  ├── m8-context-memory/        M8 上下文与记忆工程
  └── m9-eval-ops/              M9 评测与受控进化
retailhub/    贯穿实战项目源码（M1-M9 里程碑）
  ├── m1-monolith/              M1 单体应用
  ├── m2-cache-mq/              M2 缓存与消息队列
  ├── m3-oversell-lab/          M3 超卖实验
  ├── m4-traffic-observability/ M4 流量治理与可观测
  ├── m6-inference-bench/       M6 推理压测与容量规划
  ├── m7-agent-runtime/         M7 Agent Runtime / DataAgent
  ├── m8-context-memory/        M8 上下文与记忆工程
  └── m9-eval-ops/              M9 评测与受控进化
```

## 学习路径（十阶段）

- **阶段一 · 服务端筑基**：卷01-1 → 卷01-2（HTTP/REST、FastAPI、SQL、部署最小集）
- **阶段二 · 服务端架构演进**：卷02-1 → 卷02-2 → 卷02-3（缓存三事故、读写分离、MQ 异步、服务拆分）
- **阶段三 · 数据密集型系统（DDIA）**：卷03-1 → 卷03-2（存储/复制/分区/事务/一致性/批流处理）
- **阶段四 · 分布式架构与平台工程**：卷04-1 → 卷04-2 → 卷04-3（流量治理、分布式事务与共识、可观测、K8s）
- **阶段五 · 架构师方法论与软考**：卷05-1 → 卷05-2（架构风格、质量属性、4+1 视图、ATAM、ADR）
- **阶段六 · AI 开发基础**：篇00-1 → 篇00-2 → 篇01 → 篇02（LLM 开发基本功、Agent 范式认知、AI Coding 道法术器）
- **阶段七 · AI Infra**：卷06-1 → 卷06-2（GPU 与推理服务化、推理成本、向量检索、LLMOps）
- **阶段八 · SRE 与可靠性工程**：卷08-1 → 卷08-2 → 卷08-3（SLI/SLO、错误预算、监控告警、发布工程、AI 服务 SRE）
- **阶段九 · 企业级 Agent 工程化**：00-课程分析报告 + 篇03 → 篇10（立项、LLM 执行底座、Harness/Runtime、Context/Tool/Memory 治理、EvalOps）
- **阶段十 · AI FDE 交付实战**：卷07（FDE 角色、PoC 方法、价值度量、客户现场工程纪律）

## 源码包下载

- 在 GitHub 页面点击 **Code → Download ZIP**
- 或直接下载：https://github.com/soloproc/ai-architect-path/archive/refs/heads/main.zip

源码为 Python 3.11+，纯 pip 依赖，无需安装 Redis / MySQL / GPU 即可运行全部里程碑实验。
