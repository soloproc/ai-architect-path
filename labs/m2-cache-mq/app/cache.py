"""Cache-Aside 缓存层（fakeredis 实现）。

教学要点（对应卷02 任务 C）：
- Cache-Aside 读路径：先查缓存 → miss 则查库 → 回填缓存。写后是"删缓存"
  而不是"改缓存"（并发下旧值会覆盖新值，卷02 常见误区 #3）。
- 空值缓存防穿透：查询不存在的订单也缓存一个占位符，否则恶意刷不存在的
  id 会让每次请求都打到数据库。
- TTL 加随机抖动防雪崩：大批 key 若同一时刻过期，请求会同时打到数据库。
  给每个 key 的 TTL 加 0~30s 随机偏移，过期时刻就被摊平了
  （对比实验见 scripts/avalanche_demo.py）。
- fakeredis：与 redis-py 同 API 的内存实现，学习者无需安装 Redis；
  上生产只换客户端构造这一行。
"""
import json
import os
import random

import fakeredis

_redis = fakeredis.FakeRedis(decode_responses=True)

BASE_TTL = 60                    # 基础过期时间（秒）
JITTER_ENABLED = os.environ.get("CACHE_JITTER", "1") == "1"  # 抖动开关
NULL_MARK = "__null__"           # 空值占位符

_hits = 0
_misses = 0


def make_expire(ttl: int = BASE_TTL) -> int:
    """TTL + 随机抖动。抖动把"同时写入的一批 key 同时过期"摊平成陆续过期。"""
    return ttl + (random.randint(0, 30) if JITTER_ENABLED else 0)


def get_or_set(key: str, loader, ttl: int = BASE_TTL):
    """Cache-Aside 核心：命中返回缓存值；未命中调 loader() 查库并回填。

    loader() 返回 None 表示"数据库里也没有"，此时缓存空值占位符防穿透。
    """
    global _hits, _misses
    raw = _redis.get(key)
    if raw is not None:
        _hits += 1
        return None if raw == NULL_MARK else json.loads(raw)
    _misses += 1
    value = loader()
    payload = NULL_MARK if value is None else json.dumps(value, ensure_ascii=False)
    _redis.set(key, payload, ex=make_expire(ttl))
    return value


def invalidate(key: str) -> None:
    """写后删缓存：数据变更时调用，下次读 miss 后回填新值。"""
    _redis.delete(key)


def stats() -> dict:
    total = _hits + _misses
    return {"hits": _hits, "misses": _misses,
            "hit_rate": round(_hits / total, 4) if total else 0.0,
            "keys": _redis.dbsize(), "jitter_enabled": JITTER_ENABLED}


def reset_stats() -> None:
    """清零计数器与缓存（测试与演示用）。"""
    global _hits, _misses
    _hits = _misses = 0
    _redis.flushall()
