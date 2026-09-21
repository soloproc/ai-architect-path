"""熔断器单元测试。用可注入假时钟替代真实 sleep，测试快进冷却时间。

跑法：python -m unittest tests.test_circuit_breaker -v
"""
import unittest

from src.circuit_breaker import CircuitBreaker, CircuitOpenError, State


class FakeClock:
    """假时钟：手动拨针，测试不用等真的 30 秒。"""
    def __init__(self):
        self.now = 0.0
    def __call__(self):
        return self.now
    def advance(self, seconds: float):
        self.now += seconds


def boom():
    raise RuntimeError("库存服务挂了")


class CircuitBreakerTest(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        self.events = []  # 收集状态跃迁事件
        self.cb = CircuitBreaker(
            name="inventory",
            window_size=4,
            failure_rate_threshold=0.5,
            min_requests=4,
            recovery_timeout=30.0,
            half_open_probes=2,
            on_state_change=lambda name, old, new: self.events.append((old, new)),
            clock=self.clock,
        )

    def test_closed_passes_calls_through(self):
        self.assertEqual(self.cb.call(lambda: 42), 42)
        self.assertEqual(self.cb.state, State.CLOSED)
        self.assertEqual(self.events, [])  # 正常时不应有任何跃迁

    def test_opens_when_failure_rate_exceeded(self):
        # 窗口内 4 次调用、3 次失败 → 失败率 75% > 50%，跳闸
        for _ in range(3):
            self.assertRaises(RuntimeError, self.cb.call, boom)
        self.cb.call(lambda: "ok")  # 窗口：失败 3 / 总数 4 = 75%
        self.assertEqual(self.cb.state, State.OPEN)
        self.assertIn(("closed", "open"), self.events)

    def test_open_fails_fast_without_calling(self):
        for _ in range(4):
            self.assertRaises(RuntimeError, self.cb.call, boom)
        self.assertEqual(self.cb.state, State.OPEN)
        called = []
        with self.assertRaises(CircuitOpenError):
            self.cb.call(lambda: called.append(1))
        self.assertEqual(called, [])  # 快速失败：根本没发起真实调用

    def test_min_requests_guard(self):
        # 请求数不足 min_requests 时，即使全失败也不跳闸（统计无意义）
        cb = CircuitBreaker("t", window_size=4, failure_rate_threshold=0.5,
                            min_requests=4, clock=self.clock)
        for _ in range(3):  # 只调了 3 次 < 4
            self.assertRaises(RuntimeError, cb.call, boom)
        self.assertEqual(cb.state, State.CLOSED)

    def test_half_open_probe_then_close(self):
        for _ in range(4):
            self.assertRaises(RuntimeError, self.cb.call, boom)
        self.assertEqual(self.cb.state, State.OPEN)

        self.clock.advance(29.9)  # 冷却还没到
        with self.assertRaises(CircuitOpenError):
            self.cb.call(lambda: 1)

        self.clock.advance(0.2)   # 冷却到点 → 下一次调用触发半开探测
        self.cb.call(lambda: "probe-1")
        self.assertEqual(self.cb.state, State.HALF_OPEN)
        self.cb.call(lambda: "probe-2")  # 连续 2 次探测成功 → 合闸
        self.assertEqual(self.cb.state, State.CLOSED)
        self.assertIn(("open", "half_open"), self.events)
        self.assertIn(("half_open", "closed"), self.events)

    def test_probe_failure_reopens(self):
        for _ in range(4):
            self.assertRaises(RuntimeError, self.cb.call, boom)
        self.clock.advance(30.0)
        self.assertRaises(RuntimeError, self.cb.call, boom)  # 探测失败
        self.assertEqual(self.cb.state, State.OPEN)  # 立刻重新跳闸
        self.assertIn(("half_open", "open"), self.events)


if __name__ == "__main__":
    unittest.main()
