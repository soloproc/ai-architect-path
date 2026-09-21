# RetailHub M1：单体查询服务（对应卷01《服务端筑基》实战）

FastAPI + SQLite 的零售经营查询单体。无缓存、无中间件——这是后续所有演进的起点。

## 目录结构

```
m1-monolith/
├── app/
│   ├── main.py      # 路由 + 参数校验 + JSON 访问日志
│   ├── db.py        # SQLite 连接管理 + 建表
│   └── seed.py      # 确定性种子数据（50 商品 / 5000 订单 / 30 天）
├── tests/test_api.py
├── docs/adr/0001-gmv-exclude-refunded.md   # GMV 口径决策
├── requirements.txt
└── run.sh
```

## 运行步骤

> 本仓库根目录的 `.venv` 是本地开发环境，**不要提交进源码树**（.gitignore 已排除）；
> 在干净机器上按下面步骤重建即可。

```bash
# 在 m1-monolith 目录下
python3 -m venv .venv && source .venv/bin/activate   # 或使用仓库根的 .venv
pip install -r requirements.txt
python -m app.seed        # 生成种子数据（幂等，库非空则跳过）
uvicorn app.main:app --port 8000
# 或一步到位：bash run.sh
```

## 验收命令对照表（对应卷01「本卷实战」验收标准）

| 卷01 验收项 | 命令 | 预期 |
|---|---|---|
| 分页结构 | `curl "http://localhost:8000/orders?page=1&size=5"` | 返回 `items/total/page/size`，total=5000 |
| 详情含商品 | `curl http://localhost:8000/orders/1` | JSON 含 `items[]`，每行有 `name`/`price` |
| 404 为 JSON | `curl http://localhost:8000/orders/99999` | HTTP 404，响应体为 JSON |
| 参数校验 | `curl "http://localhost:8000/orders?page=0"` | HTTP 422 |
| GMV 口径 | `curl "http://localhost:8000/stats/gmv?date=2025-06-01"` | 返回 `order_count/gmv/avg_order_value`，不含 refunded（口径见 ADR 0001） |
| 健康检查 | `curl http://localhost:8000/health` | `{"status":"ok"}` |
| 访问日志 | 任意请求后看终端 | 每请求一行 JSON 日志，含 path 与 cost_ms |
| 自动化测试 | `python -m pytest tests/ -q` | 全部通过 |

> 注：教程正文中 GMV 端点写作 `?start=&end=` 区间形式；本配套源码简化为
> 单日 `?date=YYYY-MM-DD` 并增加客单价字段，口径（剔除 refunded）与教程一致。
> 有余力可自行扩展为区间版本——这正是卷01 自测清单的好练习。

## 讨论点：N+1 问题（卷01 常见误区 #2）

`GET /orders/{id}` 用一次 JOIN 取回商品明细。试着给 `GET /orders` 列表也加上
"每张订单的商品名列表"：如果写成"先查 20 条订单、再循环查 20 次明细"，
就是 1+20 次查询的 N+1。本地 5000 条数据感觉不出来，上线后随分页并发线性恶化。
正确做法：`WHERE order_id IN (...)` 一次批量取回再在内存分组。这个问题会在
卷02 加缓存后再次出现——缓存只能缓解、不能消灭错误的查询模式。

## 常见报错 FAQ

- **`ModuleNotFoundError: No module named 'fastapi'`**：没装依赖或没进虚拟环境。
  回到仓库根执行 `source .venv/bin/activate`（或直接全程用 `.venv/bin/python` 代替 `python`）。
- **`pip install` 卡住或超时**：换国内镜像
  `pip install -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt`。
- **`Address already in use`（端口被占）**：换个端口 `uvicorn app.main:app --port 8001`，
  验收命令里的 `localhost:8000` 同步换成 8001。
- **`python3: command not found`**：macOS 先跑 `xcode-select --install`，
  或 `brew install python3`。
- **想重置数据**：删掉 `retailhub.db` 再跑 `python -m app.seed` 即可（种子确定性生成）。
