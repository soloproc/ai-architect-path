# M4：流量治理与可观测（对应《卷04 分布式架构与平台工程》本卷实战）

> 卷04 实战主线：*给订单服务装上"安全气囊"*。本目录交付其中
> 熔断、限流、Outbox、追踪四个可运行的核心组件与一个综合演示；
> 容器化 / K8s 清单（任务 4）由仓库其他目录负责。

## 文件 ↔ 卷04 实战任务对照表

| 卷04 实战任务 | 本目录文件 | 说明 |
| --- | --- | --- |
| 任务 1：超时 + 重试 + 熔断 | `src/circuit_breaker.py` + `tests/test_circuit_breaker.py` | 闭合/断开/半开状态机，滑动窗口失败率阈值，半开探测，状态跃迁事件回调；失败率口径是对教程 50 行骨架的教学扩展 |
| 任务 2：租户级令牌桶限流中间件 | `src/rate_limiter.py` + `tests/test_rate_limiter.py` | 令牌桶（容量=突发，速率=均值），按 tenant_id 隔离，惰性补充无需后台线程 |
| 任务 3：本地消息表 Outbox + 消费端幂等 | `src/outbox.py` | 订单与 outbox 消息同一本地事务提交；后台 relay 线程投递；模拟网络抖动演示"至少一次 + 幂等去重" |
| 任务 5：打通"网关→订单→库存"Trace | `src/tracing.py` | 教学版 OTel 概念：trace_id / span_id / parent_id，contextvars 隐式传上下文（与 OTel Python SDK 同机制），树形渲染调用链 |
| 综合 | `demo.py` | 一段带故障窗口的模拟下单流量，把三层防护串起来并打印统计与调用链树 |

## 运行步骤

```bash
cd retailhub/m4-traffic-observability

# 1) 单元测试（Python ≥ 3.11 标准库 unittest，无第三方依赖）
python -m unittest discover -s tests -v

# 2) 综合演示：限流 + 熔断 + 追踪
python demo.py

# 3) Outbox 单独演示
python src/outbox.py
```

## 预期输出

### 测试

6 个熔断器用例 + 6 个限流器用例全部 `OK`（假时钟注入，无需真实等待）：

```
test_half_open_probe_then_close ... ok
test_open_fails_fast_without_calling ... ok
...
Ran 12 tests in 0.0xs
OK
```

### demo.py

库存服务在第 0.25–0.45 秒进入故障窗口，可以看到：

```
== M4 综合演示：限流 + 熔断 + 追踪 ==
  ⚡ 熔断器[inventory]: closed → open        # 失败率过半，跳闸
  ⚡ 熔断器[inventory]: open → half_open     # 冷却 200ms 到点，开始探测
  ⚡ 熔断器[inventory]: half_open → closed   # 探测成功，合闸
------------------------------------------------------------
流量统计（0.xx s，共 60 次下单尝试）：
  成功下单              : ~20
  被限流拒绝 (429)      : ~30
  熔断快速失败 (fail-fast): ~5-8
  下游故障 (熔断打开前) : ~2-4

第一个成功订单的调用链（教学版 OTel 树形视图）：
trace_id=xxxxxxxxxxxxxxxx
└── 创建订单  (xx.x ms, span=xxxxxxxx)
    ├── 查询商品  (x.x ms, span=xxxxxxxx)
    └── 库存扣减  (x.x ms, span=xxxxxxxx)
```

注意三个防护的协作语义：**限流保护入口**（租户配额）、
**熔断保护下游**（故障不传染）、**追踪提供事后归因能力**。

### src/outbox.py

```
  [relay] 投递 evt-0001 … 网络抖动，失败！（下次重投）
  [relay] 投递 evt-0001 成功，库存已扣减
  ...
初始库存 100 → 最终库存 97（期望 97）；outbox 未投递消息 = 0（期望 0）
✅ 不丢（全部送达）且不重（重复投递被幂等挡下）。
```

## 思考题

1. 熔断器打开期间快速失败的请求，业务上应该怎么处理才不丢单？
   （提示：降级写本地队列、走缓存库存、还是直接拒单？各自的代价是什么？）
2. 令牌桶的"容量"和"速率"分别对应什么业务语义？为什么固定窗口
   计数器做不到"允许突发但限均值"？
3. Outbox 的 relay 如果先删消息再投递，会引入什么故障模式？
   为什么"投递成功后才标记 delivered"配合消费端幂等是正确顺序？
4. 为什么 trace 上下文要用 contextvars 而不是全局变量或线程局部变量？
   （提示：想想 asyncio 单线程内并发处理多个请求时会发生什么。）
