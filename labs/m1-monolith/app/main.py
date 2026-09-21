"""RetailHub M1：单体查询服务（对应卷01 实战）。

教学要点：
- Query(ge=1) 让 FastAPI 自动把 page=0 拦成 422，参数校验不该手写 if。
- 404 返回 JSON 而不是框架默认 HTML 报错页——错误也是 API 契约的一部分。
- GMV 口径：status='refunded' 的订单不计入（决策依据见 docs/adr/0001）。
- 故意留下的讨论点：GET /orders 列表如果也要展示每张订单的商品明细，
  初学者容易写成"先查列表、再循环逐个查明细"的 N+1；正确做法是一次
  JOIN/IN 批量取回。M1 不在列表页展示明细，把这个问题留到卷02 讨论。
"""
import json
import logging
import re
import time

from fastapi import FastAPI, HTTPException, Query, Request

from .db import get_conn, init_db, table_empty
from .seed import seed

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("retailhub.access")

app = FastAPI(title="RetailHub M1 单体服务")


@app.middleware("http")
async def access_log(request: Request, call_next):
    """JSON 访问日志：每次请求一行，含路径与耗时（卷01 验收项）。"""
    start = time.perf_counter()
    response = await call_next(request)
    cost_ms = round((time.perf_counter() - start) * 1000, 1)
    logger.info(json.dumps({"path": request.url.path, "method": request.method,
                            "status": response.status_code, "cost_ms": cost_ms},
                           ensure_ascii=False))
    return response


@app.on_event("startup")
def startup() -> None:
    init_db()
    if table_empty("orders"):  # 首次启动自动灌数据，降低上手门槛
        seed()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/orders")
def list_orders(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100)):
    conn = get_conn()
    try:
        total = conn.execute("SELECT COUNT(*) AS c FROM orders").fetchone()["c"]
        rows = conn.execute(
            "SELECT id, member_id, store_id, status, amount, created_at "
            "FROM orders ORDER BY id LIMIT ? OFFSET ?",
            (size, (page - 1) * size)).fetchall()
        return {"items": [dict(r) for r in rows],
                "total": total, "page": page, "size": size}
    finally:
        conn.close()


@app.get("/orders/{order_id}")
def get_order(order_id: int):
    """订单详情：JOIN 出商品名称与单价。不存在的订单返回 404 JSON。"""
    conn = get_conn()
    try:
        order = conn.execute(
            "SELECT id, member_id, store_id, status, amount, created_at "
            "FROM orders WHERE id = ?", (order_id,)).fetchone()
        if order is None:
            raise HTTPException(status_code=404, detail={"error": "order_not_found",
                                                         "order_id": order_id})
        lines = conn.execute(
            "SELECT oi.item_id, i.name, oi.qty, oi.price "
            "FROM order_items oi JOIN items i ON i.id = oi.item_id "
            "WHERE oi.order_id = ?", (order_id,)).fetchall()
        result = dict(order)
        result["items"] = [dict(r) for r in lines]
        return result
    finally:
        conn.close()


@app.get("/stats/gmv")
def daily_gmv(date: str = Query(..., description="YYYY-MM-DD")):
    """按日汇总：GMV / 订单数 / 客单价。refunded 订单不计入 GMV。"""
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        raise HTTPException(status_code=422, detail={"error": "bad_date_format"})
    conn = get_conn()
    try:
        row = conn.execute(
            "SELECT COUNT(*) AS order_count, ROUND(COALESCE(SUM(amount), 0), 2) AS gmv "
            "FROM orders WHERE status != 'refunded' AND substr(created_at, 1, 10) = ?",
            (date,)).fetchone()
    finally:
        conn.close()
    count, gmv = row["order_count"], row["gmv"]
    return {"date": date, "order_count": count, "gmv": gmv,
            "avg_order_value": round(gmv / count, 2) if count else 0.0}
