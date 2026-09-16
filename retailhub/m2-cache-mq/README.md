# RetailHub M2：缓存与异步演进（对应卷02《服务端架构演进实践》实战）

在 M1 单体基础上做三次"手术"：缓存（Cache-Aside）、异步队列（削峰 +
最终一致性）、读写分离（主/从双 SQLite 文件模拟）。

> 卷02 正文的实战用 docker-compose 编排 MySQL 主从 + Redis + RocketMQ。
> 本配套源码做**零依赖教学版**：fakeredis 替代 Redis、SQLite 任务表替代
> RocketMQ、双 SQLite 文件替代 MySQL 主从——模式与心态模型完全一致，
> 学完本目录再去跑 docker 版，只需要换"驱动"。

## 卷02 任务清单 → 实现位置对照表

| 卷02 任务 | 实现位置 | 说明 |
|---|---|---|
| A 基础设施编排 | （docker 版略） | 教学版无容器依赖，`run.sh` 一键起服务即等价"拉起全部组件" |
| B 迁移与复制配置 | `scripts/replicate.py` | 用 SQLite backup API 模拟主从复制；从库存在时所有读自动走从库 |
| C 缓存化改造 | `app/cache.py`、`app/main.py` 的 `GET /orders/{id}` | Cache-Aside + 空值缓存防穿透 + TTL 抖动防雪崩（`CACHE_JITTER=0` 可关）；命中率观测 `GET /cache/stats` |
| D MQ 异步日报 | `app/queue.py`、`app/main.py` 的 `POST /reports/daily`、`GET /reports/{job_id}` | SQLite 任务表 + worker 线程；`INSERT OR REPLACE` 落库保证幂等；202 语义演示最终一致性 |
| E 读写分离 | `app/db.py`（`get_master`/`get_slave`） | 写走主库、查询与报表聚合走从库；写后读陷阱见下方讨论 |
| F 压测对比 | `scripts/avalanche_demo.py` | 不是 QPS 压测，而是更本质的雪崩对照实验：同时过期 vs 随机抖动的回源次数 |

## 运行步骤

> `.venv` 不要提交进源码树（.gitignore 已排除）。

```bash
python3 -m venv .venv && source .venv/bin/activate   # 或用仓库根的 .venv
pip install -r requirements.txt
python -m app.seed          # 种子数据进主库
python scripts/replicate.py # 全量复制到从库
uvicorn app.main:app --port 8000
# 或一步到位：bash run.sh
```

## 验收命令

```bash
# 缓存：连查两次同一订单，再看命中率（第一次 miss、第二次 hit）
curl http://localhost:8000/orders/1 >/dev/null
curl http://localhost:8000/orders/1 >/dev/null
curl http://localhost:8000/cache/stats        # hits=1 misses=1

# 防穿透：刷 100 次不存在的订单，回源只有 1 次
for i in $(seq 100); do curl -s http://localhost:8000/orders/99999 >/dev/null; done
curl http://localhost:8000/cache/stats        # misses=2（含上一步的 1 次）

# 异步日报：投递 → 202 + job_id → 轮询直到 done
curl -X POST http://localhost:8000/reports/daily \
     -H 'Content-Type: application/json' -d '{"date":"2025-06-01"}'
curl http://localhost:8000/reports/1          # pending/running → done + result

# 雪崩对照实验
python scripts/avalanche_demo.py

# 自动化测试（含以上全部场景）
python -m pytest tests/ -q
```

## 讨论点

1. **写后读**：刚写入主库的数据还没"复制"到从库时，读请求查不到——真实
   主从的必现事故。解法：写后 N 秒读主库 / 读自己的写（按用户粘性路由）/
   等复制位点。本服务所有读走从库，把这个坑留给你亲手踩一次。
2. **为什么写后是删缓存而不是改缓存**？两个并发写 + 一个并发读时，
   "改缓存"可能让旧值覆盖新值；删缓存只会让下一次读 miss 回源，代价可控。
3. **fakeredis 与真 Redis 差在哪**？没有持久化、没有过期精度问题、
   单进程内存——够学模式，不够上生产。
