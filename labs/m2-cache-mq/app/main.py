"""RetailHub M2：缓存 + 异步队列 + 读写分离（对应卷02 实战）。

在 M1 基础上的演进点：
- GET /orders/{id} 接入 Cache-Aside（app/cache.py），空值缓存防穿透；
- GET /cache/stats 查看命中率；
- POST /reports/daily 投递异步任务（app/queue.py），GET /reports/{job_id}
  查询状态与结果——演示削峰与最终一致性；
- 所有查询读从库（get_slave），写走主库（get_master）。
"""
import json
import logging
import re
import time

from fastapi import FastAPI, HTTPException, Query, Request
from pydantic import BaseModel

from . import cache, queue
from .db import get_slave, init_db
from .seed import seed, table_empty

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("retailhub.access")

app = FastAPI(title="RetailHub M2 缓存与异步演进")


@app.middleware("http")
async def access_log(request: Request, call_next):
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
    if table_empty("orders"):
        seed()
    queue.start_worker()  # 报表 worker 随服务启动


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/orders")
def list_orders(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100)):
    conn = get_slave()  # 读从库
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


def _load_order_from_db(order_id: int):
    """缓存 miss 时的回源查询（读从库）。返回 None 表示订单不存在。"""
    conn = get_slave()
    try:
        order = conn.execute(
            "SELECT id, member_id, store_id, status, amount, created_at "
            "FROM orders WHERE id = ?", (order_id,)).fetchone()
        if order is None:
            return None
        lines = conn.execute(
            "SELECT oi.item_id, i.name, oi.qty, oi.price "
            "FROM order_items oi JOIN items i ON i.id = oi.item_id "
            "WHERE oi.order_id = ?", (order_id,)).fetchall()
        result = dict(order)
        result["items"] = [dict(r) for r in lines]
        return result
    finally:
        conn.close()


@app.get("/orders/{order_id}")
def get_order(order_id: int):
    """Cache-Aside：命中走缓存，miss 回源并回填；不存在的订单缓存空值。"""
    result = cache.get_or_set(f"order:{order_id}", lambda: _load_order_from_db(order_id))
    if result is None:
        raise HTTPException(status_code=404, detail={"error": "order_not_found",
                                                     "order_id": order_id})
    return result


@app.get("/cache/stats")
def cache_stats():
    """缓存命中率观测：没有它，"缓存生效了吗"只能靠猜。"""
    return cache.stats()


@app.get("/stats/gmv")
def daily_gmv(date: str = Query(..., description="YYYY-MM-DD")):
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        raise HTTPException(status_code=422, detail={"error": "bad_date_format"})
    conn = get_slave()
    try:
        row = conn.execute(
            "SELECT COUNT(*) AS order_count, ROUND(COALESCE(SUM(amount),0),2) AS gmv "
            "FROM orders WHERE status != 'refunded' AND substr(created_at,1,10) = ?",
            (date,)).fetchone()
    finally:
        conn.close()
    count, gmv = row["order_count"], row["gmv"]
    return {"date": date, "order_count": count, "gmv": gmv,
            "avg_order_value": round(gmv / count, 2) if count else 0.0}


class DailyReportRequest(BaseModel):
    date: str


@app.post("/reports/daily", status_code=202)
def submit_daily_report(req: DailyReportRequest):
    """投递日报任务：立即返回 202 + job_id，计算由 worker 异步完成。

    202 Accepted 的语义就是"我收下了，但还没办完"——异步架构的契约。
    """
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", req.date):
        raise HTTPException(status_code=422, detail={"error": "bad_date_format"})
    job_id = queue.enqueue("daily_report", {"date": req.date})
    return {"job_id": job_id, "status": "pending"}


@app.get("/reports/{job_id}")
def get_report(job_id: int):
    """查询任务状态：pending → running → done（带 result）/ failed。"""
    job = queue.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail={"error": "job_not_found"})
    if job["result"]:
        job["result"] = json.loads(job["result"])
    return job
