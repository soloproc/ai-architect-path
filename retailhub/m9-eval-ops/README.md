# M9 · EvalOps 教学版 —— Agent 评测与受控进化

为"多租户零售经营分析 DataAgent"建立从**质量定义、自动评测、失败诊断到发布门禁**的
EvalOps 闭环（对应教程《篇09》；两份立项模板对应《篇03》§4）。
纯标准库、Python 3.11+、确定性运行（Mock 被测系统 + 固定 seed），无网无 Key 可完整复现。

## 快速开始

```bash
cd m9-eval-ops
python demo.py                               # 完整演示：建基线 → 候选变更 → Gate 阻断
python -m unittest discover -s tests -v      # 测试：硬门槛/多trial/复现性/gate 规则
python -m evals.dataset                      # 查看 Task Taxonomy 配额体检
```

## 目录结构

```
m9-eval-ops/
├── demo.py                     # 完整演示：v1.0 建基线 → v1.1 越权回退 → Gate 阻断
├── evals/
│   ├── dataset.py              # EvalCase + Task Taxonomy（数据在 cases.jsonl，12 条）
│   ├── cases.jsonl             # 正常诊断4 / 数据缺失2 / 工具故障2 / 越权2 / 审批拒绝2
│   ├── fixture.py              # 环境快照：数据/时间/权限冻结 + 故障注入
│   ├── sut.py                  # 被测系统适配层：MockDataAgent v1.0/v1.1 + RunRecord
│   ├── graders.py              # Code / Environment / Trace / MockLLMJudge 四类 Grader
│   ├── runner.py               # BatchEvalRunner：Multi-Trial + 多维 Scorecard
│   └── gate.py                 # Regression Gate：baseline vs candidate 三条规则
├── tests/                      # 硬门槛不被掩盖 / 多trial / fixture复现 / gate触发
├── templates/
│   ├── quality_contract.md     # 质量契约模板（篇03 §4.1，已按 GMV 诊断预填）
│   └── m0_baseline.md          # M0 评测基线记录模板（篇03 §4.2，六栏预填）
└── reports/                    # demo 运行产物：baseline.json / candidate.json / gate_report.md
```

## 与篇09 概念对照表

| 篇09 概念 | 代码落点 |
|---|---|
| Eval Contract 三层：Outcome / Trajectory / System | `templates/quality_contract.md`；grader 的 `dimension` 字段 |
| 软评分 vs 硬门槛（一票否决，不被平均分掩盖） | `GraderResult.hard_gate` + `runner.system_scorecard()` 的 verdict |
| Task Taxonomy 配额采样（长尾类别一个不能缺） | `dataset.TAXONOMY` + `quota_report()` |
| 结构化验收点（AcceptPoint），而非标准答案 | `EvalCase.expected`（factor_keywords / tolerance / must_declare ...） |
| Fixture：数据快照 / 时间冻结 / 工具桩 / 权限矩阵 | `fixture.py` 四要素 + 每 trial 一份新 Fixture |
| Code / Environment / Trace / LLM 四类 Grader | `graders.py` 四个类，统一 `grade(run, case)` 接口 |
| Grader 自身版本化与校准 | `MockLLMJudge.version` + docstring 校准说明 |
| Multi-Trial（pass^k 思想） | `runner.TRIALS=3`，pass_rate<1 记 FLAKY |
| 多维 Scorecard（质量/安全/成本/时延） | `runner.system_scorecard()` |
| Regression Gate（安全零容忍/质量回退/成本告警） | `gate.evaluate_gate()` |
| 版本元组（VersionTuple） | 教学版简化为 `MockDataAgent.version`；生产按篇09 §9.2 六维度扩展 |
| M0 评测基线六栏 | `templates/m0_baseline.md` |

## 被测系统说明：为什么是 MockDataAgent

M7 的 DataAgent 用 `MockProvider` 脚本驱动，只覆盖"GMV 下滑"单一场景，无法应答
12 条 Task Taxonomy（越权诱导、审批拒绝、数据延迟等）。因此 M9 默认用
`evals/sut.py` 的确定性 MockDataAgent 模拟 v1.0/v1.1 两个版本的行为差异——
**先有评测集，再谈能力提升**：被测系统要"毕业"，就得逐条通过这些 Case。

## 把被测系统换成真实 DataAgent（M7）

M9 可独立运行；要接 M7 的真实 Harness，用 `sys.path` 组合（不复制代码），
只需实现同一个 SUT 协议 `run(case, fixture, seed) -> RunRecord`：

```python
import sys
sys.path.insert(0, "../m7-agent-runtime")      # 直接复用 M7，不复制桩件
from agent.data_agent import make_tools, seed_retail_db, gmv_diagnosis_script
from runtime.execution import EventStore
from runtime.harness import AgentHarness, AutonomyBudget
from runtime.llm import MockProvider, ReliableExecutor
from evals.sut import RunRecord

class RealDataAgentSUT:
    version = "m7-data-agent"

    def run(self, case, fixture, seed=0):
        seed_retail_db()
        store = EventStore(":memory:")
        harness = AgentHarness(
            ReliableExecutor(MockProvider(gmv_diagnosis_script())),
            make_tools(), store, AutonomyBudget(),
            approver=lambda req: True)           # 评测注入自动审批器，不阻塞
        run = harness.run(case.input)
        events = store.events(run.run_id)        # 事件流即轨迹来源
        return RunRecord(
            case_id=case.id, version=self.version, seed=seed,
            answer={...},                        # 从 run_completed 事件提取最终答复
            trace=[...],                         # 从 llm_call/tool_result/approval_* 事件映射
            env={...},                           # 从工单/审批副作用映射为环境终态
            cost_usd=..., latency_ms=..., steps=...)
```

映射要点：M7 的 append-only 事件流天然就是 TraceGrader 的输入；
`approvals` 表的决策记录就是 EnvironmentGrader 要的"环境终态"。
要为 12 条 taxonomy 全部接真实系统，需为 MockProvider 补齐各场景的确定性脚本
（或接入真实模型 + 固定 seed/温度 0）。

## 设计要点速记

- **确定性**：所有随机性走 `_rng(case_id, version, seed)`，两次运行逐字节一致（有测试守护）。
- **硬门槛不被平均分掩盖**：`system_scorecard` 里安全违规直接整体 FAIL（有测试守护）。
- **公平比较五同一**：同一评测集 / Fixture / Grader 版本 / 种子 / 资源配额，gate 比较才有归因能力。
