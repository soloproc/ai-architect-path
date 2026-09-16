"""M7 · LLM Runtime 最小教学版 —— 对应教程《篇04-LLM执行底座》。

为什么要有这一层：业务代码直接调 SDK，重试、成本、故障语义会散落各处
（篇04 §1.1 的五种灾难）。本模块提供三件事：
  1. 统一契约 ModelRequest/ModelResponse —— 上层只面对它，不面对任何 SDK；
  2. ProviderAdapter —— 每个 Provider 一个适配器，做协议翻译与故障语义统一；
  3. ReliableExecutor —— 一次"逻辑调用(Logical Call)"内部的
     超时 / 有限重试(指数退避) / 成本记账（篇04 §3）。
"""
from __future__ import annotations

import json
import os
import random
import time
from dataclasses import dataclass, field
from typing import Protocol


# ---------- 统一契约（与 Provider 无关，篇04 §1.3） ----------

@dataclass
class ModelRequest:
    messages: list[dict]                            # OpenAI 风格消息列表
    tools: list[dict] = field(default_factory=list)  # function calling 工具描述
    task_profile: str = "diagnosis"                 # 任务画像（篇04 §2.2）
    deadline_ms: int = 30_000                       # 整个 Logical Call 的总预算
    trace_context: dict = field(default_factory=dict)  # run_id/step_id，审计用


@dataclass
class ModelResponse:
    content: str = ""                               # 文本结论（无工具调用时即最终答复）
    tool_calls: list[dict] = field(default_factory=list)  # [{id?, name, arguments}]
    provider: str = ""                              # 实际命中的 Provider，审计用
    model_version: str = ""
    usage: dict = field(default_factory=dict)       # prompt/completion tokens + cost
    attempts: int = 1                               # 本次 Logical Call 的 Attempt 数
    finish_reason: str = "stop"                     # stop | tool_call


# ---------- 故障语义统一：所有 Provider 的错误都映射成这两类（篇04 §3.2） ----------

class RetryableError(Exception):
    """超时 / 限流 / 5xx：瞬时故障，可重试。"""


class NonRetryableError(Exception):
    """4xx / 能力不满足：重试无意义，直接失败。"""


# ---------- Provider 适配器协议 ----------

class ProviderAdapter(Protocol):
    name: str

    def complete(self, req: ModelRequest) -> ModelResponse: ...


# ---------- MockProvider：离线可跑的教学核心 ----------

class MockProvider:
    """内置"规则引擎"：按脚本依次返回固定响应，无需 API Key。

    为什么需要它：教程配套代码必须在无网无 Key 的机器上完整复现
    "计划→执行→观察"全链路。脚本化响应 = 确定性模型，可复现、可回放，
    也正是篇09 评测与受控进化的雏形。
    """
    name = "mock"

    def __init__(self, script: list[dict] | None = None):
        # script 元素：{"content": str} 或 {"tool_calls": [{name, arguments}]}
        self._script = list(script or [])

    def fast_forward(self, n: int) -> None:
        """Resume 时跳过已消耗的响应，保证不重复已完成的 Step（配合 Checkpoint）。"""
        self._script = self._script[n:]

    def complete(self, req: ModelRequest) -> ModelResponse:
        if not self._script:
            return ModelResponse(content="[mock] 脚本耗尽，直接结束。", provider=self.name)
        item = self._script.pop(0)
        return ModelResponse(
            content=item.get("content", ""),
            tool_calls=item.get("tool_calls", []),
            provider=self.name,
            model_version="mock-rules-v1",
            usage={"prompt_tokens": 120, "completion_tokens": 40, "cost_usd": 0.0004},
            finish_reason="tool_call" if item.get("tool_calls") else "stop",
        )


# ---------- OpenAICompatibleProvider：真实 Provider（可选） ----------

class OpenAICompatibleProvider:
    """OpenAI 兼容端点（function calling 格式）。
    读环境变量 OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL。"""
    name = "openai-compatible"

    def __init__(self) -> None:
        self.base_url = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")
        self.api_key = os.environ.get("OPENAI_API_KEY", "")
        self.model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
        if not self.api_key:
            raise NonRetryableError("缺少 OPENAI_API_KEY，无法使用真实 Provider")

    def complete(self, req: ModelRequest) -> ModelResponse:
        import httpx  # 延迟导入：只用 MockProvider 时无需 httpx
        payload: dict = {"model": self.model, "messages": req.messages}
        if req.tools:
            payload["tools"] = [{"type": "function", "function": t} for t in req.tools]
        try:
            r = httpx.post(f"{self.base_url}/chat/completions", json=payload,
                           headers={"Authorization": f"Bearer {self.api_key}"},
                           timeout=req.deadline_ms / 1000)
        except httpx.TimeoutException as e:
            raise RetryableError(f"请求超时: {e}") from e
        if r.status_code == 429 or r.status_code >= 500:
            raise RetryableError(f"限流/服务端错误: HTTP {r.status_code}")
        if r.status_code >= 400:
            raise NonRetryableError(f"客户端错误: HTTP {r.status_code} {r.text[:200]}")
        msg = r.json()["choices"][0]["message"]
        tool_calls = [{"id": tc["id"], "name": tc["function"]["name"],
                       "arguments": json.loads(tc["function"]["arguments"] or "{}")}
                      for tc in (msg.get("tool_calls") or [])]
        usage = r.json().get("usage", {})
        usage.setdefault("cost_usd", 0.0)  # 教学版不维护价目表；生产应按模型单价计费
        return ModelResponse(content=msg.get("content") or "", tool_calls=tool_calls,
                             provider=self.name, model_version=self.model, usage=usage,
                             finish_reason="tool_call" if tool_calls else "stop")


# ---------- ReliableExecutor：Logical Call 的可靠执行（篇04 §3.1/§3.2） ----------

class ReliableExecutor:
    """把一次"逻辑调用"内部的 Attempt 生命周期管起来：
    超时是单次 Attempt 的地板，Deadline 是整个调用的天花板，
    重试只针对瞬时故障并做指数退避；每次调用记账并打印 token 成本。
    """

    def __init__(self, provider: ProviderAdapter, max_attempts: int = 3):
        self.provider = provider
        self.max_attempts = max_attempts
        self.total_calls = 0
        self.total_usage = {"prompt_tokens": 0, "completion_tokens": 0, "cost_usd": 0.0}

    def call(self, req: ModelRequest) -> ModelResponse:
        t0 = time.monotonic()
        last_err: Exception | None = None
        for attempt in range(1, self.max_attempts + 1):
            if time.monotonic() - t0 > req.deadline_ms / 1000:
                break  # Deadline 天花板：宁可失败，也不让重试堆积成雪崩
            try:
                resp = self.provider.complete(req)
                resp.attempts = attempt
                self._bookkeep(resp, req)
                return resp
            except RetryableError as e:
                last_err = e
                time.sleep(min(2 ** attempt, 8) * 0.05 + random.random() * 0.05)  # 教学版缩短退避
        raise RetryableError(f"Logical Call 失败（{self.max_attempts} 次 Attempt 耗尽）: {last_err}")

    def _bookkeep(self, resp: ModelResponse, req: ModelRequest) -> None:
        for k in self.total_usage:
            self.total_usage[k] += resp.usage.get(k, 0)
        self.total_calls += 1
        ctx = req.trace_context
        print(f"  [LLM] {ctx.get('run_id', '-')}/{ctx.get('step_id', '-')} "
              f"provider={resp.provider} tokens={resp.usage.get('prompt_tokens', 0)}+"
              f"{resp.usage.get('completion_tokens', 0)} "
              f"cost=${resp.usage.get('cost_usd', 0):.4f} attempts={resp.attempts}")
