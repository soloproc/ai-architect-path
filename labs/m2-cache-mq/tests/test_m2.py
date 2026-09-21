"""M2 演进验收测试：缓存、异步队列、读写分离、雪崩脚本。"""
import os
import sqlite3
import subprocess
import sys
import time

import pytest

REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASTER = os.environ["RETAILHUB_DB_MASTER"]


def test_cache_hit_after_first_request(client):
    """第一次 miss 回源，第二次命中：hits/misses 各 +1，命中率 50%。"""
    from app import cache
    cache.reset_stats()
    assert client.get("/orders/2").status_code == 200
    assert client.get("/orders/2").status_code == 200
    s = client.get("/cache/stats").json()
    assert s["misses"] == 1 and s["hits"] == 1
    assert s["hit_rate"] == 0.5


def test_null_caching_blocks_penetration(client):
    """不存在的订单查 100 次，只回源 1 次——空值缓存防穿透（卷02 验收项）。"""
    from app import cache
    cache.reset_stats()
    for _ in range(100):
        assert client.get("/orders/99999").status_code == 404
    s = client.get("/cache/stats").json()
    assert s["misses"] == 1 and s["hits"] == 99


def test_ttl_jitter_enabled(client):
    """随机过期开关默认打开（防雪崩），stats 里可观测。"""
    assert client.get("/cache/stats").json()["jitter_enabled"] is True


def test_async_report_status_flow(client):
    """异步任务：202 投递 → 轮询直到 done，结果与 SQL 核算一致（最终一致）。"""
    from app.db import get_slave
    r = client.post("/reports/daily", json={"date": "2025-06-01"})
    assert r.status_code == 202
    job_id = r.json()["job_id"]

    seen_statuses = set()
    result = None
    for _ in range(100):  # 最多等 20s
        body = client.get(f"/reports/{job_id}").json()
        seen_statuses.add(body["status"])
        if body["status"] == "done":
            result = body["result"]
            break
        if body["status"] == "failed":
            pytest.fail(f"任务失败：{body}")
        time.sleep(0.2)
    assert result is not None, "任务未在超时内完成"
    assert "pending" in seen_statuses or "running" in seen_statuses

    slave = get_slave()
    try:
        row = slave.execute(
            "SELECT COUNT(*) AS c, ROUND(SUM(amount),2) AS g FROM orders "
            "WHERE status != 'refunded' AND substr(created_at,1,10) = '2025-06-01'"
        ).fetchone()
    finally:
        slave.close()
    assert result["order_count"] == row["c"]
    assert result["gmv"] == pytest.approx(row["g"], abs=0.01)

    # 幂等落库：daily_report 表中该日期只有一行
    master = sqlite3.connect(MASTER)
    try:
        n = master.execute(
            "SELECT COUNT(*) FROM daily_report WHERE date='2025-06-01'"
        ).fetchone()[0]
    finally:
        master.close()
    assert n == 1


def test_report_job_not_found(client):
    assert client.get("/reports/99999").status_code == 404


def test_avalanche_demo_script_runs():
    """雪崩脚本可运行，且随机抖动确实降低了回源次数。"""
    r = subprocess.run([sys.executable, "scripts/avalanche_demo.py"],
                       cwd=REPO_DIR, capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    assert "随机抖动" in r.stdout
    # 场景 A 必须 100 次全回源，场景 B 必须显著更少
    assert "回源 DB 100 次" in r.stdout
    line_b = [l for l in r.stdout.splitlines() if "场景 B" in l][0]
    b_count = int(line_b.split("DB")[1].strip().split(" ")[0])
    assert b_count < 50


def test_replicate_script_runs():
    """复制脚本可运行：跑完从库订单数与主库一致。"""
    r = subprocess.run([sys.executable, "scripts/replicate.py"],
                       cwd=REPO_DIR, capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    assert "orders 共 5000 行" in r.stdout


def test_reads_work_from_slave(client):
    """读写分离冒烟：删了从库连接降级逻辑之外的正常路径，读端点仍正常。"""
    assert client.get("/orders", params={"page": 1, "size": 3}).json()["total"] == 5000
    assert client.get("/stats/gmv", params={"date": "2025-06-02"}).status_code == 200
