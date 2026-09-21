"""令牌桶限流器单元测试。

跑法：python -m unittest tests.test_rate_limiter -v
"""
import unittest

from src.rate_limiter import RateLimitExceeded, TenantRateLimiter, TokenBucket


class FakeClock:
    def __init__(self):
        self.now = 0.0
    def __call__(self):
        return self.now
    def advance(self, seconds: float):
        self.now += seconds


class TokenBucketTest(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        # 容量 5，每秒补 2 个
        self.bucket = TokenBucket(capacity=5, refill_rate=2, clock=self.clock)

    def test_initial_bucket_is_full(self):
        # 桶初始满：新租户/冷启动允许一个突发
        for _ in range(5):
            self.assertTrue(self.bucket.try_acquire())
        self.assertFalse(self.bucket.try_acquire())  # 第 6 个被挡

    def test_refill_is_proportional_to_elapsed_time(self):
        for _ in range(5):
            self.bucket.try_acquire()
        self.clock.advance(1.0)   # 过 1 秒 → 补 2 个
        self.assertTrue(self.bucket.try_acquire())
        self.assertTrue(self.bucket.try_acquire())
        self.assertFalse(self.bucket.try_acquire())

    def test_refill_never_exceeds_capacity(self):
        self.clock.advance(100)   # 闲置很久，令牌不能无限攒
        for _ in range(5):
            self.assertTrue(self.bucket.try_acquire())
        self.assertFalse(self.bucket.try_acquire())  # 最多就是容量 5

    def test_average_rate_is_bounded(self):
        # 10 秒最多放行 5（初始）+ 10*2（补充）= 25 个
        allowed = 0
        for _ in range(10):
            for _ in range(10):
                if self.bucket.try_acquire():
                    allowed += 1
            self.clock.advance(1.0)
        self.assertLessEqual(allowed, 25)
        # 最后一次 advance 补上的 2 个令牌本轮没机会消费，所以下界是 23
        self.assertGreaterEqual(allowed, 23)


class TenantIsolationTest(unittest.TestCase):
    def test_tenants_have_independent_buckets(self):
        clock = FakeClock()
        limiter = TenantRateLimiter(capacity=3, refill_rate=1, clock=clock)
        # 租户 A 打满自己的桶
        for _ in range(3):
            self.assertTrue(limiter.allow("tenant-A"))
        self.assertFalse(limiter.allow("tenant-A"))
        # 租户 B 完全不受影响 —— 这就是隔离的意义
        for _ in range(3):
            self.assertTrue(limiter.allow("tenant-B"))
        self.assertFalse(limiter.allow("tenant-B"))

    def test_acquire_raises_with_tenant_info(self):
        limiter = TenantRateLimiter(capacity=1, refill_rate=0.1, clock=FakeClock())
        limiter.acquire("mall-X")
        with self.assertRaises(RateLimitExceeded) as ctx:
            limiter.acquire("mall-X")
        self.assertIn("mall-X", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
