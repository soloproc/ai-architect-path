# AI 全栈架构师之路

一套从小白到 AI 全栈架构师的自学教程，覆盖完整成长路径：**服务端筑基 → 分布式架构 → DDIA 数据密集型系统 → AI Infra → SRE 可靠性工程 → Agent 工程化 → AI FDE 交付实战**，内含贯穿全程的实战项目 **RetailHub / DataAgent** 源码与 **37 个交互 Demo**。

## 在线阅读

- 主站（GitHub Pages）：https://soloproc.github.io/ai-architect-path/
- 备用地址：https://g0cyg8bhmf.feishuapp.com/app/app_17e5p3qx6ev

## 目录结构

```
tutorial/     教程正文（22 课 Markdown + 课程大纲原文）
  ├── README.md            教程首页（网站首页的 Markdown 源）
  ├── 总纲-从小白到AI架构师.md
  ├── 00-课程分析报告.md
  ├── 卷01-服务端筑基.md ～ 卷08-SRE与可靠性工程.md
  ├── 篇00-小白前置篇.md ～ 篇10-面向未来的工程判断.md
  └── 课程大纲原文.txt
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

## 源码包下载

- 在 GitHub 页面点击 **Code → Download ZIP**
- 或直接下载：https://github.com/soloproc/ai-architect-path/archive/refs/heads/main.zip

源码为 Python 3.11+，纯 pip 依赖，无需安装 Redis / MySQL / GPU 即可运行全部里程碑实验。
