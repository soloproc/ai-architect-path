"""M7 · DataAgent 雏形 —— RetailHub 零售数据平台上的第一个 Agent。

业务口径（篇03）：回答"上周 GMV 为什么下滑"——
查询订单 → 计算指标 → 维度对比 → 归因结论 → 建议建工单（高风险，走审批）。

演示重点（对照篇05 §1.3 控制权矩阵）：
  - query_orders / calc_metric → 低风险只读工具，模型自主调用；
  - create_ticket              → 高风险副作用，Human Gate 审批 + 幂等键防重复；
  - 指标口径由 calc_metric 的代码持有（语义层雏形），模型不许猜口径。

运行：cd m7-agent-runtime && python -m agent.data_agent
"""
from __future__ import annotations

import random
import sqlite3
import zlib
from pathlib import Path

from runtime.execution import EventStore
from runtime.harness import AgentHarness, AutonomyBudget, ToolContract, ToolRegistry
from runtime.llm import MockProvider, ReliableExecutor

DB_PATH = Path(__file__).parent / "retail.db"          # M1 风格零售库
STORE_PATH = Path(__file__).parent / "agent_events.db"  # 事件库


# ---------- M1 风格零售库：自带 seed，数据即 fixture（篇03 §4.2，基线可复现） ----------

def seed_retail_db(path: Path = DB_PATH) -> None:
    """生成 28 天订单数据。剧情设定：上周起「直播」渠道转化率腰斩（5%→2.5%），
    拖累整体 GMV 环比下滑约 17% —— 这就是 DataAgent 要诊断出的归因。"""
    if path.exists():
        return
    db = sqlite3.connect(path)
    db.execute("""CREATE TABLE orders(
        day INTEGER,          -- 距今天数，0=今天
        channel TEXT, visits INTEGER, orders INTEGER, gmv REAL, refunded INTEGER)""")
    rng = random.Random(42)  # 固定种子：每次 seed 出同一份数据
    for day in range(28):
        for ch in ["搜索", "推荐", "直播"]:
            visits = rng.randint(900, 1100)
            conv = 0.025 if (ch == "直播" and day < 7) else 0.05  # 核心剧情
            orders = int(visits * conv * rng.uniform(0.9, 1.1))
            db.execute("INSERT INTO orders VALUES(?,?,?,?,?,?)",
                       (day, ch, visits, orders, round(orders * rng.uniform(95, 105), 2),
                        int(orders * (0.03 if day < 7 else 0.02))))
    db.commit()
    db.close()


# ---------- 三个工具（篇03 八类任务的 M7 最小子集） ----------

def make_tools(db_path: Path = DB_PATH) -> ToolRegistry:
    reg = ToolRegistry()

    def query_orders(args: dict) -> list[dict]:
        """低风险只读：按天区间查询各渠道订单聚合数据。"""
        con = sqlite3.connect(db_path)
        rows = con.execute(
            "SELECT channel, SUM(visits), SUM(orders), ROUND(SUM(gmv),2), SUM(refunded) "
            "FROM orders WHERE day BETWEEN ? AND ? GROUP BY channel",
            (args.get("day_from", 0), args.get("day_to", 13))).fetchall()
        con.close()
        return [{"channel": c, "visits": v, "orders": o, "gmv": g, "refunded": r}
                for c, v, o, g, r in rows]

    def calc_metric(args: dict) -> dict:
        """低风险：GMV/转化率/退款率。口径由代码持有，模型只选区间（语义层雏形）。"""
        con = sqlite3.connect(db_path)
        v, o, g, r = con.execute(
            "SELECT SUM(visits), SUM(orders), SUM(gmv), SUM(refunded) "
            "FROM orders WHERE day BETWEEN ? AND ?",
            (args.get("day_from", 0), args.get("day_to", 6))).fetchone()
        con.close()
        return {"GMV": round(g, 2), "转化率": round(o / v, 4),
                "退款率": round(r / o, 4), "客单价": round(g / o, 2)}

    def create_ticket(args: dict) -> dict:
        """高风险副作用：创建诊断跟进工单。真实系统这里会调工单系统 API。"""
        print(f"  🎫 工单已创建: {args['title']}")
        return {"ticket_id": f"TK-{zlib.crc32(args['title'].encode()) % 10**6}",
                "status": "created"}

    obj = {"type": "object",
           "properties": {"day_from": {"type": "integer"}, "day_to": {"type": "integer"}}}
    reg.register(ToolContract("query_orders", "按天区间查询各渠道订单聚合数据", obj, "low", query_orders))
    reg.register(ToolContract("calc_metric", "计算指定区间的 GMV/转化率/退款率/客单价", obj, "low", calc_metric))
    reg.register(ToolContract("create_ticket", "创建诊断跟进工单（高风险，需人工审批）",
                              {"type": "object", "properties": {"title": {"type": "string"},
                               "detail": {"type": "string"}}}, "high", create_ticket))
    return reg


# ---------- MockProvider 脚本：模拟"理想模型"的诊断决策序列（等价于篇05 §2.2 的 Plan） ----------

def gmv_diagnosis_script() -> list[dict]:
    return [
        {"tool_calls": [{"name": "calc_metric", "arguments": {"day_from": 0, "day_to": 6}}]},    # 本周指标
        {"tool_calls": [{"name": "calc_metric", "arguments": {"day_from": 7, "day_to": 13}}]},   # 上周指标
        {"tool_calls": [{"name": "query_orders", "arguments": {"day_from": 0, "day_to": 6}}]},   # 本周分渠道
        {"tool_calls": [{"name": "query_orders", "arguments": {"day_from": 7, "day_to": 13}}]},  # 上周分渠道
        {"tool_calls": [{"name": "create_ticket", "arguments": {                                  # 建议行动（高风险）
            "title": "直播渠道转化率异常下跌排查",
            "detail": "直播渠道转化率约 5%→2.5%，拖累 GMV 环比下滑约 17%，"
                      "建议排查直播投放与商详页改动"}}]},
        {"content": ("【GMV 下滑归因结论】\n"
                     "1. 本周 GMV 环比下滑约 17%，根因是「直播」渠道转化率从约 5% 跌至约 2.5%（腰斩）；\n"
                     "2. 搜索/推荐渠道指标平稳，排除大盘流量因素；退款率小幅上升但非主因；\n"
                     "3. 已创建跟进工单，建议优先排查直播投放计划与商详页近一周改动。")},
    ]


def main() -> None:
    seed_retail_db()
    store = EventStore(STORE_PATH)
    executor = ReliableExecutor(MockProvider(gmv_diagnosis_script()))
    harness = AgentHarness(executor, make_tools(DB_PATH), store,
                           AutonomyBudget(max_steps=10, max_cost_usd=0.01))
    print("=" * 64)
    print("DataAgent · 场景：上周 GMV 为什么下滑（MockProvider 离线驱动）")
    print("=" * 64)
    run = harness.run("分析上周 GMV 为什么下滑，并给出行动建议")
    print("\n---- Run Timeline（事件流回放，篇05 §3.4）----")
    for ev in store.events(run.run_id):
        print(f"  #{ev.seq:02d} {ev.type}")
    u = executor.total_usage
    print(f"\n成本合计: {u['prompt_tokens']}+{u['completion_tokens']} tokens, "
          f"${u['cost_usd']:.4f} | Run 状态: {run.state.value}")


if __name__ == "__main__":
    main()
