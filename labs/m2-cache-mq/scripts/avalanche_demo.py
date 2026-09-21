#!/usr/bin/env python3
"""缓存雪崩对比实验：同时过期 vs 随机抖动过期。

实验设计：100 个热点 key 同时写入缓存，等基础 TTL 过后瞬间来 100 个请求，
统计"打到数据库"的回源次数（cache miss 数）。
- 场景 A（固定 TTL）：所有 key 同一秒过期 → 100 次回源，数据库被瞬间打满；
- 场景 B（TTL + 0~2s 随机抖动）：过期时刻被摊平 → 只有少量 key 已过期，
  回源次数大幅下降。这就是"app/cache.py 里 make_expire() 加抖动"的意义。
"""
import random
import time

import fakeredis

N_KEYS = 100
BASE_TTL = 1          # 教学演示用短 TTL，真实系统通常是分钟/小时级
SLEEP = 1.2           # 等待到"基础 TTL 刚过"的时刻


def run_scenario(jitter: bool) -> int:
    redis = fakeredis.FakeRedis(decode_responses=True)
    rng = random.Random(42)
    db_queries = 0

    def loader(key: str) -> str:
        nonlocal db_queries
        db_queries += 1  # 每次回源就是一次数据库查询
        return f"value-of-{key}"

    keys = [f"hot:{i}" for i in range(N_KEYS)]
    for k in keys:  # 同时写入（模拟同一波热点数据被同时加载进缓存）
        ttl = BASE_TTL + (rng.randint(0, 2) if jitter else 0)
        redis.set(k, "cached", ex=ttl)
    time.sleep(SLEEP)

    db_queries = 0  # 只统计"过期后突发请求"阶段的回源次数
    for k in keys:
        if redis.get(k) is None:
            redis.set(k, loader(k), ex=BASE_TTL)
    return db_queries


def main() -> None:
    a = run_scenario(jitter=False)
    b = run_scenario(jitter=True)
    print("缓存雪崩对比实验（100 个热点 key，过期后瞬间 100 个请求）")
    print("-" * 56)
    print(f"场景 A 固定 TTL（同时过期）   ：回源 DB {a:3d} 次")
    print(f"场景 B TTL+随机抖动（陆续过期）：回源 DB {b:3d} 次")
    print("-" * 56)
    print(f"随机过期将瞬时回源压力降低了 {round((a - b) / a * 100)}%")


if __name__ == "__main__":
    main()
