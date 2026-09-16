"""并发执行时间线记录器（教学工具）。

为什么需要它：并发 bug 的可怕之处在于"看不到"。两个线程交错执行的顺序
每次都可能不同，事后只有一个错误的最终值，推理过程全靠脑补。
把时间线上每个线程的每一步都按真实发生时刻打印出来，"丢失更新"
就从一句定义变成一张看得见的图——这正是教程卷03 isolation-oversell
Demo 的叙事方式。
"""
import threading
import time


class Timeline:
    """线程安全地记录并发步骤，最后按真实时间排序打印。"""

    def __init__(self):
        self._t0 = time.perf_counter()
        self._events = []          # [(相对毫秒, 线程名, 事件描述)]
        self._lock = threading.Lock()

    def log(self, actor: str, message: str):
        """记录一步。actor 是线程的短名字，如 'T1' / 'DB'。"""
        elapsed_ms = (time.perf_counter() - self._t0) * 1000
        with self._lock:
            self._events.append((elapsed_ms, actor, message))

    def render(self) -> str:
        """按发生时刻排序，输出对齐的时间线表格。"""
        lines = ["  时刻(ms)  线程    事件", "  --------  ------  " + "-" * 40]
        for ms, actor, msg in sorted(self._events, key=lambda e: e[0]):
            lines.append(f"  {ms:8.1f}  {actor:<6}  {msg}")
        return "\n".join(lines)

    def print(self):
        print(self.render())
