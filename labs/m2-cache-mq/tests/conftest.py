import os
import sys

import pytest

# 测试用独立主/从库，必须在 import app 之前设置环境变量
TEST_DIR = os.path.dirname(os.path.abspath(__file__))
os.environ["RETAILHUB_DB_MASTER"] = os.path.join(TEST_DIR, "test_master.db")
os.environ["RETAILHUB_DB_SLAVE"] = os.path.join(TEST_DIR, "test_slave.db")

sys.path.insert(0, os.path.dirname(TEST_DIR))

from app.seed import seed  # noqa: E402
from scripts.replicate import replicate  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def seeded_dbs():
    for suffix in ("test_master.db", "test_slave.db"):
        path = os.path.join(TEST_DIR, suffix)
        if os.path.exists(path):
            os.remove(path)
    seed()        # 种子数据进主库
    replicate()   # 全量复制到从库（教学模拟主从）
    yield
    for suffix in ("test_master.db", "test_slave.db"):
        path = os.path.join(TEST_DIR, suffix)
        if os.path.exists(path):
            os.remove(path)


@pytest.fixture(scope="session")
def client(seeded_dbs):
    from fastapi.testclient import TestClient
    from app.main import app
    # 用 with 触发 startup：建表 + 启动后台 worker 线程
    with TestClient(app) as c:
        yield c
