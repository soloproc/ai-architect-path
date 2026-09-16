"""M1 接口验收测试：与 README 的 curl 验收命令一一对应。"""

import pytest


def test_pagination_structure(client):
    """分页：返回 items/total/page/size，total 与种子订单数一致。"""
    r = client.get("/orders", params={"page": 1, "size": 5})
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 5000
    assert body["page"] == 1 and body["size"] == 5
    assert len(body["items"]) == 5


def test_pagination_boundary_last_page(client):
    """分页边界：最后一页不满 size 时返回剩余条数，越界页返回空列表。"""
    r = client.get("/orders", params={"page": 500, "size": 10})
    assert r.status_code == 200 and len(r.json()["items"]) == 10
    r = client.get("/orders", params={"page": 501, "size": 10})
    assert r.status_code == 200 and r.json()["items"] == []


def test_page_zero_rejected(client):
    """page=0 必须被参数校验拦成 422，而不是悄悄当第一页。"""
    r = client.get("/orders", params={"page": 0})
    assert r.status_code == 422


def test_order_detail_contains_items(client):
    """详情：JOIN 出商品 name 与 price，且明细合计 == 订单 amount。"""
    r = client.get("/orders/1")
    assert r.status_code == 200
    body = r.json()
    assert body["items"], "详情必须含商品明细"
    for line in body["items"]:
        assert "name" in line and "price" in line and "qty" in line
    detail_sum = round(sum(l["price"] * l["qty"] for l in body["items"]), 2)
    assert detail_sum == pytest.approx(body["amount"], abs=0.01)


def test_order_not_found(client):
    """不存在的订单返回 404，且响应体是 JSON 而非 HTML 报错页。"""
    r = client.get("/orders/99999")
    assert r.status_code == 404
    assert r.headers["content-type"].startswith("application/json")
    assert r.json()["detail"]["error"] == "order_not_found"


def test_gmv_matches_sql_and_excludes_refunded(client, seeded_db):
    """GMV：接口数值与直接 SQL 核算一致，且 refunded 订单不计入。"""
    from app.db import get_conn
    conn = get_conn()
    try:
        day = conn.execute(
            "SELECT substr(created_at,1,10) AS d FROM orders "
            "WHERE status='paid' GROUP BY d ORDER BY COUNT(*) DESC LIMIT 1"
        ).fetchone()["d"]
        expect = conn.execute(
            "SELECT COUNT(*) AS c, ROUND(SUM(amount),2) AS g FROM orders "
            "WHERE status != 'refunded' AND substr(created_at,1,10) = ?", (day,)
        ).fetchone()
        with_refund = conn.execute(
            "SELECT ROUND(SUM(amount),2) AS g FROM orders "
            "WHERE substr(created_at,1,10) = ?", (day,)
        ).fetchone()["g"]
    finally:
        conn.close()
    r = client.get("/stats/gmv", params={"date": day})
    assert r.status_code == 200
    body = r.json()
    assert body["order_count"] == expect["c"]
    assert body["gmv"] == pytest.approx(expect["g"], abs=0.01)
    assert body["gmv"] < with_refund  # 含退款的全额一定更大，证明口径生效
    assert body["avg_order_value"] == pytest.approx(
        round(body["gmv"] / body["order_count"], 2), abs=0.01)


def test_gmv_bad_date_format(client):
    r = client.get("/stats/gmv", params={"date": "2025/06/01"})
    assert r.status_code == 422


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}
