"""circuit_breaker.py —— 迷你熔断器：闭合/断开/半开状态机。

对应卷04 实战任务 1（超时+重试+熔断，本文件负责"熔断"部分）。

为什么需要熔断器：库存服务挂了之后，订单服务的每个请求都会卡满超时
才失败。成千上万个请求各自"慢死"，会把线程池/连接池全部占满——
一个服务的故障顺着调用链传染成全站雪崩。熔断器的思想来自电路：
故障超过阈值就"跳闸"，之后快速失败（不真的发起调用），给下游
留出恢复时间；冷却一段时间后"半开"放几个探测请求，确认恢复了再合闸。

设计要点（教学版，在卷04 代码骨架基础上扩展）：
- 失败率阈值而非裸计数：用滑动窗口统计最近 N 次调用的失败比例，
  避免"低流量时零星失败也跳闸"或"高流量时大量失败却不跳闸"。
- 半开放探测请求数：HALF_OPEN 状态下只放行少量请求，成功足够多才合闸，
  防止下游刚恢复就被瞬间涌入的流量再次打垮。
- 事件回调：状态跃迁是对运维最重要的事件，必须可插桩（打日志/发告警）。
- 时钟可注入：测试里用假时钟快进"冷却时间"，不用真的 sleep 30 秒。
"""
import time
from collections import deque
from enum import Enum
from threading import Lock


class State(Enum):
    CLOSED = "closed"          # 闭合：正常放行
    OPEN = "open"              # 断开：快速失败，不发起真实调用
    HALF_OPEN = "half_open"    # 半开：放行少量探测请求


class CircuitOpenError(Exception):
    """熔断打开时抛出。调用方应捕获并走降级逻辑（缓存/默认值/排队）。"""


class CircuitBreaker:
    def __init__(
        self,
        name: str,
        window_size: int = 10,          # 滑动窗口：统计最近多少次调用
        failure_rate_threshold: float = 0.5,   # 窗口内失败率超过它 → 跳闸
        min_requests: int = 5,          # 窗口内请求太少时不跳闸（统计无意义）
        recovery_timeout: float = 30.0, # 断开后多久进入半开（秒）
        half_open_probes: int = 3,      # 半开状态连续成功多少次才合闸
        on_state_change=None,           # 事件回调 fn(name, old, new)，接日志/告警
        clock=time.monotonic,           # 可注入时钟，便于测试
    ):
        self.name = name
        self.window_size = window_size
        self.failure_rate_threshold = failure_rate_threshold
        self.min_requests = min_requests
        self.recovery_timeout = recovery_timeout
        self.half_open_probes = half_open_probes
        self._on_state_change = on_state_change
        self._clock = clock

        self.state = State.CLOSED
        self._window = deque(maxlen=window_size)  # 最近 N 次结果：True=成功
        self._opened_at = 0.0
        self._half_open_successes = 0
        self._half_open_inflight = 0   # 半开时正在飞行中的探测数
        self._lock = Lock()

    # ---------- 对外主入口 ----------

    def call(self, fn, *args, **kwargs):
        """通过熔断器调用 fn。熔断打开时抛 CircuitOpenError（快速失败）。"""
        self._before_call()
        try:
            result = fn(*args, **kwargs)
        except Exception:
            self._record(success=False)
            raise
        self._record(success=True)
        return result

    # ---------- 状态机内部 ----------

    def _before_call(self):
        with self._lock:
            if self.state == State.OPEN:
                if self._clock() - self._opened_at >= self.recovery_timeout:
                    # 冷却到点：进入半开，开始探测
                    self._set_state(State.HALF_OPEN)
                else:
                    raise CircuitOpenError(
                        f"[{self.name}] circuit OPEN, fail fast "
                        f"(cooling down, retry later)"
                    )
            if self.state == State.HALF_OPEN:
                if self._half_open_inflight >= self.half_open_probes:
                    # 探测名额已满，多余请求也快速失败——保护刚苏醒的下游
                    raise CircuitOpenError(
                        f"[{self.name}] circuit HALF_OPEN, probing, fail fast"
                    )
                self._half_open_inflight += 1

    def _record(self, success: bool):
        with self._lock:
            if self.state == State.HALF_OPEN:
                self._half_open_inflight -= 1
                if success:
                    self._half_open_successes += 1
                    if self._half_open_successes >= self.half_open_probes:
                        self._set_state(State.CLOSED)  # 探测全过，合闸
                        self._window.clear()
                else:
                    # 探测期间任何一次失败都说明下游没好，重新跳闸
                    self._set_state(State.OPEN)
                return

            # CLOSED 状态：滑动窗口统计失败率
            self._window.append(success)
            if len(self._window) >= self.min_requests:
                failures = sum(1 for ok in self._window if not ok)
                if failures / len(self._window) >= self.failure_rate_threshold:
                    self._set_state(State.OPEN)

    def _set_state(self, new: State):
        old = self.state
        if old == new:
            return
        self.state = new
        if new == State.OPEN:
            self._opened_at = self._clock()
        if new == State.HALF_OPEN:
            self._half_open_successes = 0
            self._half_open_inflight = 0
        if self._on_state_change:
            # 回调不放锁外执行是教学简化；生产实现应异步派发避免回调阻塞状态机
            self._on_state_change(self.name, old.value, new.value)
