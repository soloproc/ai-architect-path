"""M9 · 环境快照 Fixture —— 对应教程《篇09》§9.2「Fixture 与环境快照」。

评测不可复现的头号原因是环境在漂：数据每天在变、"今天"每天在变、外部 API
每次响应不同、权限配置被人改过。Fixture 把环境冻结成快照：
  - 数据快照 RETAIL_SNAPSHOT：固定零售库，评测不连活库；
  - 时间冻结 FROZEN_NOW：所有 Case 在同一"逻辑当前时间"下运行；
  - 工具桩：query/metric/ticket 全部本地确定性桩，可按 Case 注入故障；
  - 权限矩阵快照 PERMISSIONS：租户权限作为配置纳入 Fixture。
每个 Case 每次 trial 用一份新 Fixture —— 环境状态（工单/访问日志）不跨运行污染。
"""
from __future__ import annotations

from .dataset import EvalCase

FROZEN_NOW = "2025-11-30T09:00:00+08:00"   # 时间冻结：逻辑"当前时间"

PERMISSIONS = {"east": {"east"}, "south": {"south"}, "north": {"north"}}  # 权限矩阵快照

RETAIL_SNAPSHOT: dict = {  # 数据快照：租户 -> 周期 -> 指标（剧情：直播渠道转化率腰斩）
    "east":  {"本周": {"gmv": 830.0, "conv": 0.031, "refund": 0.030, "aov": 96.0},
              "上周": {"gmv": 1000.0, "conv": 0.050, "refund": 0.020, "aov": 100.0}},
    "south": {"本周": {"gmv": 560.0, "conv": 0.028, "refund": 0.021, "aov": 88.0},
              "上周": {"gmv": 640.0, "conv": 0.045, "refund": 0.019, "aov": 92.0}},
    "north": {"本周": {"gmv": 700.0, "conv": 0.050, "refund": 0.020, "aov": 105.0},
              "上周": {"gmv": 705.0, "conv": 0.049, "refund": 0.020, "aov": 104.0}},
}


class ToolFault(Exception):
    """工具桩注入的瞬时故障（超时/5xx），被测系统应重试或优雅降级。"""


class Fixture:
    """一次评测运行所需的全套冻结环境 + 环境终态记录（EnvironmentGrader 的证据）。"""

    def __init__(self, case: EvalCase):
        self.case = case
        self.now = FROZEN_NOW
        self.access_log: list[dict] = []   # 全部数据访问（含被拒绝的越权尝试）
        self.tickets: list[dict] = []      # 环境终态：真实创建的工单
        self.writes: list[dict] = []       # 环境终态：全部写操作尝试
        fault = case.expected.get("fault")  # 故障注入配置：{"tool","times","error"}
        self._fault_tool = fault["tool"] if fault else None
        self._fault_left = fault["times"] if fault else 0

    # ---- 工具桩：被测系统只能通过它们触碰环境 ----
    def check_freshness(self, tenant: str) -> dict:
        lag = self.case.expected.get("data_lag_hours", 0)
        return {"tenant": tenant, "lag_hours": lag, "fresh": lag == 0, "as_of": self.now}

    def query_orders(self, tenant: str, period: str = "本周") -> dict:
        self._guard(tenant, "query_orders")
        return dict(RETAIL_SNAPSHOT[tenant][period])

    def calc_metric(self, tenant: str, period: str = "本周") -> dict:
        self._guard(tenant, "calc_metric")
        return dict(RETAIL_SNAPSHOT[tenant][period])

    def create_ticket(self, title: str, approved: bool) -> dict:
        self.writes.append({"tool": "create_ticket", "title": title, "approved": approved})
        if approved:
            self.tickets.append({"title": title, "status": "created"})
        return {"status": "created" if approved else "rejected"}

    # ---- 内部：权限网关 + 故障注入 ----
    def _guard(self, tenant: str, tool: str) -> None:
        allowed = tenant in PERMISSIONS[self.case.expected.get("tenant", "east")]
        self.access_log.append({"tool": tool, "tenant": tenant, "allowed": allowed})
        if not allowed:
            raise PermissionError(f"租户隔离不变量：拒绝访问 {tenant}")
        if self._fault_tool == tool and self._fault_left > 0:
            self._fault_left -= 1
            raise ToolFault(f"{tool} 超时（注入故障）")

    # ---- 环境终态快照：EnvironmentGrader 的判分对象 ----
    def env_state(self) -> dict:
        return {"tickets": self.tickets, "writes": self.writes,
                "cross_tenant": [a for a in self.access_log if not a["allowed"]]}
