"""demo.py —— 把熔断 + 限流 + 追踪串起来，跑一段模拟下单流量。

故事线（对应卷04 任务 1/2/5）：
  RetailHub 大促，两个租户在下单。订单服务调用库存服务——
  库存服务在中途"故障"了几秒。看三层防护各自的表现：
  1. 限流器：租户 quota 用完后直接 429，不拖垮系统；
  2. 熔断器：库存故障率过半 → 跳闸，请求快速失败而不是卡满超时；
     库存恢复后经半开探测自动合闸；
  3. 追踪：每个成功下单留下一棵"查询→订单→库存"的 span 树。

跑法：python demo.py
"""
import random
import time

from src.circuit_breaker import CircuitBreaker, CircuitOpenError
from src.rate_limiter import RateLimitExceeded, TenantRateLimiter
from src.tracing import trace, tracer

random.seed(42)  # 确定性：教学演示要求每次跑出同样的故事


# ---------- 模拟下游"库存服务"（含故障窗口） ----------

class InventoryService:
    """第 0.25–0.45 秒之间是故障窗口：全部抛异常。"""

    def __init__(self):
        self.boot = time.monotonic()

    def deduct(self, sku: str, qty: int):
        elapsed = time.monotonic() - self.boot
        if 0.25 < elapsed < 0.45:
            raise RuntimeError("inventory: connection refused (故障窗口)")
        time.sleep(0.005)  # 正常时 5ms 的扣减耗时


inventory = InventoryService()


# ---------- 装配三层防护 ----------

breaker = CircuitBreaker(
    name="inventory",
    window_size=6,
    failure_rate_threshold=0.5,
    min_requests=4,
    recovery_timeout=0.20,   # 演示用短冷却：200ms
    half_open_probes=2,
    on_state_change=lambda n, old, new: print(f"  ⚡ 熔断器[{n}]: {old} → {new}"),
)
limiter = TenantRateLimiter(capacity=5, refill_rate=8)  # 每租户突发 5、平均 8 QPS


# ---------- 业务调用链（被 trace 装饰，自动成树） ----------

@trace("查询商品")
def query_product(sku):
    time.sleep(0.002)
    return {"sku": sku, "price": 99.0}


@trace("库存扣减")
def deduct_stock(sku, qty):
    # 通过熔断器调用不可靠的下游；超时+重试在真实系统里也包在这里
    return breaker.call(inventory.deduct, sku, qty)


@trace("创建订单")
def create_order(tenant, sku, qty):
    product = query_product(sku)      # 子 span：查询
    deduct_stock(sku, qty)            # 子 span：库存
    return {"tenant": tenant, "sku": sku, "amount": product["price"] * qty}


def place_order_guarded(tenant, sku, qty):
    """流量入口：先限流，再进业务链路。"""
    limiter.acquire(tenant)           # 超配额 → 429
    return create_order(tenant, sku, qty)


# ---------- 模拟流量 ----------

def main():
    print("== M4 综合演示：限流 + 熔断 + 追踪 ==")
    stats = {"ok": 0, "rate_limited": 0, "circuit_open": 0, "downstream_err": 0}
    tenants = ["mall-A", "mall-B"]
    start = time.monotonic()
    example_trace_id = None

    for i in range(60):
        tenant = tenants[i % 2]
        try:
            place_order_guarded(tenant, "SKU-1001", 1)
            stats["ok"] += 1
            if example_trace_id is None:
                # 记录第一个成功订单的 trace，稍后打印它的调用树
                example_trace_id = tracer._spans[-1].trace_id
        except RateLimitExceeded:
            stats["rate_limited"] += 1
        except CircuitOpenError:
            stats["circuit_open"] += 1     # 快速失败，没打向下游
        except RuntimeError:
            stats["downstream_err"] += 1   # 熔断未开前，真实尝到的下游故障
        time.sleep(0.012)                  # 两租户合计 ~80 QPS 的到达节奏

    wall = time.monotonic() - start
    print("-" * 60)
    print(f"流量统计（{wall:.2f}s，共 60 次下单尝试）：")
    print(f"  成功下单              : {stats['ok']}")
    print(f"  被限流拒绝 (429)      : {stats['rate_limited']}")
    print(f"  熔断快速失败 (fail-fast): {stats['circuit_open']}")
    print(f"  下游故障 (熔断打开前) : {stats['downstream_err']}")
    print()
    if example_trace_id:
        print("第一个成功订单的调用链（教学版 OTel 树形视图）：")
        print(tracer.render_tree(example_trace_id))


if __name__ == "__main__":
    main()
