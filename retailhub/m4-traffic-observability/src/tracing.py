"""tracing.py —— 极简分布式追踪（教学版 OpenTelemetry 概念）。

对应卷04 实战任务 5 的概念内核（生产接 OTel SDK + Jaeger，
本文件先把"TraceID / SpanID / 父子关系"三个概念手写一遍）。

三个必须理解的概念：
- trace_id：一次完整用户请求的全局身份证。请求穿过网关、订单、库存
  多个服务，所有日志都带同一个 trace_id，事后才能把它们拼回一条链。
- span_id：链路中"一段工作"的身份证（如"查库存"是一个 span）。
- parent_id：span 的父子关系。有了它，散落的 span 才能还原成一棵树——
  树形结构正是"哪个环节慢、哪个环节错"的可视化基础。

为什么用 contextvars：trace 上下文（当前 span）要跟着"调用栈"走，
但又不能靠参数层层传递（那会把所有函数签名污染掉）。contextvars
提供的"隐式上下文"正是 OTel Python SDK 实际采用的机制；
asyncio 下每个 task 有独立 context，天然支持并发请求互不串号。
"""
import contextvars
import time
import uuid
from functools import wraps

# 当前 span 栈顶（隐式传递的"调用链上下文"）
_current_span = contextvars.ContextVar("current_span", default=None)


class Span:
    def __init__(self, name: str, trace_id: str, span_id: str, parent_id: str | None):
        self.name = name
        self.trace_id = trace_id
        self.span_id = span_id
        self.parent_id = parent_id
        self.start = time.perf_counter()
        self.duration_ms = None


class Tracer:
    """收集 span 并按父子关系渲染成树。"""

    def __init__(self):
        self._spans: list[Span] = []

    def start_span(self, name: str) -> tuple[Span, object]:
        parent = _current_span.get()
        if parent is None:
            # 链路的第一个 span：生成新的 trace_id，它是根
            span = Span(name, trace_id=uuid.uuid4().hex[:16], span_id=uuid.uuid4().hex[:8],
                        parent_id=None)
        else:
            # 后继 span 继承父链路的 trace_id，挂上 parent_id
            span = Span(name, trace_id=parent.trace_id, span_id=uuid.uuid4().hex[:8],
                        parent_id=parent.span_id)
        token = _current_span.set(span)  # token 用于结束时恢复父上下文
        return span, token

    def end_span(self, span: Span, token):
        span.duration_ms = (time.perf_counter() - span.start) * 1000
        _current_span.reset(token)
        self._spans.append(span)

    def render_tree(self, trace_id: str) -> str:
        """把一条 trace 的所有 span 渲染成树形调用链。"""
        spans = [s for s in self._spans if s.trace_id == trace_id]
        by_parent = {}
        for s in spans:
            by_parent.setdefault(s.parent_id, []).append(s)
        lines = [f"trace_id={trace_id}"]
        def walk(parent_id, prefix):
            children = sorted(by_parent.get(parent_id, []), key=lambda s: s.start)
            for i, s in enumerate(children):
                last = i == len(children) - 1
                branch = "└── " if last else "├── "
                lines.append(f"{prefix}{branch}{s.name}  ({s.duration_ms:.1f} ms, span={s.span_id})")
                walk(s.span_id, prefix + ("    " if last else "│   "))
        walk(None, "")
        return "\n".join(lines)


# 进程级单例（教学简化；OTel 里对应 TracerProvider）
tracer = Tracer()


def trace(name: str | None = None):
    """装饰器：为被调函数开一个 span，自动接上父 span。

    用法：
        @trace("查询")
        def search(...): ...

    嵌套调用自动形成父子关系，无需手动传任何参数。
    """
    def decorator(fn):
        span_name = name or fn.__name__
        @wraps(fn)
        def wrapper(*args, **kwargs):
            span, token = tracer.start_span(span_name)
            try:
                return fn(*args, **kwargs)
            finally:
                tracer.end_span(span, token)
        return wrapper
    return decorator
