# M0 评测基线记录模板 —— 篇03 §4.2

> 用法：M0（模块化单体跑通后的第一个可评测版本）冻结时填写，入库打 tag，之后任何人不许改。
> 后续每个里程碑的验收标准 = 相对本基线的改进量（Regression Gate 的数据来源）。
> ⚠️ 下表为**示例值**，必须用真实运行数据替换（运行 `python demo.py` 生成 `reports/baseline.json`）。

## 0. 基线元信息

- 版本元组（VersionTuple）：code=`git-commit` / model=`模型及版本` / prompt=`Prompt 资产版本` / context=`Context 配置版本` / tools=`工具集版本` / memory=`Memory 策略版本`
- 评测集版本 / Fixture 版本 / Grader 版本：cases-v1 / fixture-v1 / graders-v1
- 冻结时间：YYYY-MM-DD HH:mm

## 1. 六栏基线（示例值 → 用真实运行数据替换）

| 栏目 | 指标 | 示例值（待替换） | 数据来源 |
|---|---|---|---|
| 任务质量 | Outcome 质量均分（百分制） | 95.8 | baseline.json `quality_avg` |
| 证据完整性 | 证据 ≥ 2 条的 Case 占比 | 100% | MockLLMJudge rubric 逐 Case 统计 |
| 成本 | 单任务平均成本（USD） | 0.0017 | baseline.json `cost_avg_usd` |
| 时延 | P95 端到端时延（ms） | 1200 | baseline.json `p95_latency_ms` |
| 安全 | 硬门槛违规次数（越权 / 未审批写） | 0 | baseline.json `safety_violations` |
| 失败类型 | Failure Taxonomy 分布 | 口径错误 0 / 证据缺失 0 / 越权 0 / 未收敛 0 | 逐 Case 人工标注 |

## 2. 失败类型登记（Failure Taxonomy 首批分类，示例）

| Case ID | 失败现象 | 分类 | 根因假设 | 是否已沉淀 Regression Case |
|---|---|---|---|---|
| diag-003 | v1.0 漏掉"退款率"因子（软失败，质量 75） | 模型层-推理遗漏 | Prompt 未提示关联指标 | 是（永久防复发） |
| （示例）xxx | 结论缺少证据 | Context 层-检索缺失 | 指标口径未注入 | 待补 |

## 3. 基线使用纪律

- 基线文件入库并打 tag，M0 之后任何人不许改；
- 候选版本比较必须满足"五个同一"：同一评测集、同一 Fixture、同一 Grader、同批种子、同一资源配额；
- 每次根因修复的终点 = Regression Set 新增一个 Case（只增不改）；
- 用 fixture 快照而非活库 —— 数据漂移会让三个月后所有回归对比失去意义（篇03 §4.2）。
