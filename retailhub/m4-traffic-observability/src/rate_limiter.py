"""rate_limiter.py —— 租户级令牌桶限流器。

对应卷04 实战任务 2（租户级令牌桶限流中间件）。

为什么是令牌桶而不是固定窗口计数器：
- 固定窗口（"每秒 100 次"）有临界突刺问题：窗口末尾 100 次 + 窗口开头
  100 次，实际 1 秒内打了 200 次。
- 令牌桶把"速率"和"突发"分开建模：桶以恒定速率 refill（平均速率），
  桶的容量 capacity 允许短时突发（攒下的令牌可以一次花掉）。
  这正好对应真实业务语义："这个租户平均 10 QPS，允许偶尔冲到 20"。

为什么按租户隔离：RetailHub 是多租户 SaaS。单租户流量失控
（比如某个客户写了死循环脚本）不能挤占其他租户的份额——
每个租户一个独立的桶，超限的返回 429，互不干扰。
"""
import time
from threading import Lock


class RateLimitExceeded(Exception):
    """请求被限流。Web 层应把它翻译成 HTTP 429 + Retry-After。"""


class TokenBucket:
    """单租户令牌桶。令牌 = 允许通过的请求数。"""

    def __init__(self, capacity: float, refill_rate: float, clock=time.monotonic):
        self.capacity = capacity        # 桶容量：允许的最大突发
        self.refill_rate = refill_rate  # 每秒补充的令牌数：平均速率上限
        self._tokens = capacity         # 桶初始是满的（新租户有启动额度）
        self._last = clock()
        self._clock = clock

    def try_acquire(self, tokens: float = 1.0) -> bool:
        """尝试取走 tokens 个令牌。成功返回 True，不够则返回 False。"""
        now = self._clock()
        # 惰性补充：只在取用时结算"这段时间该长多少个令牌"，
        # 不需要后台线程定时 refill——简单且精确。
        self._tokens = min(self.capacity, self._tokens + (now - self._last) * self.refill_rate)
        self._last = now
        if self._tokens >= tokens:
            self._tokens -= tokens
            return True
        return False

    @property
    def available(self) -> float:
        return self._tokens


class TenantRateLimiter:
    """按租户隔离的限流器。每个 tenant_id 一个独立令牌桶，惰性创建。"""

    def __init__(self, capacity: float, refill_rate: float, clock=time.monotonic):
        self.capacity = capacity
        self.refill_rate = refill_rate
        self._clock = clock
        self._buckets = {}
        self._lock = Lock()

    def _bucket_for(self, tenant_id: str) -> TokenBucket:
        # 双重检查之外的简化：教学版直接在锁内惰性创建
        with self._lock:
            if tenant_id not in self._buckets:
                self._buckets[tenant_id] = TokenBucket(
                    self.capacity, self.refill_rate, clock=self._clock
                )
            return self._buckets[tenant_id]

    def allow(self, tenant_id: str, tokens: float = 1.0) -> bool:
        """该租户本次请求是否放行。"""
        return self._bucket_for(tenant_id).try_acquire(tokens)

    def acquire(self, tenant_id: str, tokens: float = 1.0):
        """不放行就抛异常——中间件风格。"""
        if not self.allow(tenant_id, tokens):
            raise RateLimitExceeded(
                f"tenant {tenant_id!r} rate limited "
                f"(capacity={self.capacity}, rate={self.refill_rate}/s)"
            )
