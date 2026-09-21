import os
import sys

import pytest

# 测试用独立数据库文件，不污染开发库；必须在 import app 之前设置
TEST_DB = os.path.join(os.path.dirname(__file__), "test_retailhub.db")
os.environ["RETAILHUB_DB"] = TEST_DB

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db import get_conn  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import seed  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def seeded_db():
    if os.path.exists(TEST_DB):
        os.remove(TEST_DB)
    seed()
    yield
    if os.path.exists(TEST_DB):
        os.remove(TEST_DB)


@pytest.fixture(scope="session")
def client(seeded_db):
    return TestClient(app)
