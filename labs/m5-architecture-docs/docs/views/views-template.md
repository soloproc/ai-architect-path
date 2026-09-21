# 4+1 视图图集（模板）

> 视图是骨架：用五个视图把系统当前形态完整表达，且视图间互相一致。
> 验收：5 张图 mermaid 可渲染；场景视图能串联其余四视图；随机抽一个组件，
> 它在逻辑、物理、开发视图里都能找到对应物。
> 骨架已按 RetailHub 卷04 末态预填（卷05-2 §10.3），换成你的系统时替换节点即可。

## 1. 逻辑视图 —— 模块划分与职责

```mermaid
flowchart TB
    subgraph 接入层
        GW[API 网关<br/>鉴权/租户路由/全局限流]
    end
    subgraph 业务服务层
        OS[订单服务<br/>下单/订单查询/订单状态机]
        IS[库存服务<br/>扣减/回补/防超卖]
        RS[报表服务<br/>报表任务受理/查询]
        RW[报表 Worker<br/>异步生成/结果落库]
    end
    subgraph 数据层
        PG[(PostgreSQL 主从<br/>订单/库存写库)]
        RD[(分析读库<br/>报表宽表)]
        MQ[[消息队列<br/>order.created / report.jobs]]
        RC[(Redis<br/>缓存/限流计数)]
    end
    GW --> OS & IS & RS
    OS --> PG
    IS --> PG
    OS -->|outbox 投递| MQ
    MQ --> IS
    RS --> MQ
    MQ --> RW
    RW --> RD
    OS & IS --> RC
```

## 2. 进程视图 —— 关键链路的并发与异步

```mermaid
sequenceDiagram
    autonumber
    participant C as 客户端
    participant G as 网关
    participant O as 订单服务(3副本)
    participant Q as MQ
    participant I as 库存服务(2副本)
    C->>G: POST /orders
    G->>G: 鉴权 + 租户限流(令牌桶)
    G->>O: 转发(traceparent 头)
    O->>O: 本地事务: 写订单 + 写 outbox
    O-->>C: 201 {order_id}（同步部分结束）
    Note over O,Q: 异步部分开始：outbox relay
    O->>Q: order.created
    Q->>I: 投递
    I->>I: 幂等校验 + 条件更新扣库存(防超卖)
    I->>Q: ack（失败则重投）
```

## 3. 物理视图 —— 部署拓扑

```mermaid
flowchart TB
    subgraph K8s集群["K8s 集群（生产）"]
        subgraph NS1["namespace: retailhub"]
            DP1[Deployment: gateway ×2]
            DP2[Deployment: order-service ×3]
            DP3[Deployment: inventory-service ×2]
            DP4[Deployment: report-worker ×2]
            SVC[Service / Ingress]
        end
        subgraph NS2["namespace: infra"]
            OTEL[OTel Collector DaemonSet]
            PROM[Prometheus + Grafana]
        end
    end
    EXT[云资源] --> RDS[(云 RDS PostgreSQL<br/>主从+自动备份)]
    EXT --> EMQ[(云消息队列)]
    EXT --> ER[(云 Redis)]
    DP1 & DP2 & DP3 & DP4 --> RDS
    DP2 & DP4 --> EMQ
    SVC --> DP1
    DP1 --> DP2 & DP3
    DP2 & DP3 & DP4 -.OTLP.-> OTEL
    OTEL --> PROM
```

## 4. 开发视图 —— 代码组织

```mermaid
flowchart LR
    subgraph repo["单仓（monorepo）"]
        common["common/<br/>circuit_breaker / rate_limit /<br/>tracing / outbox"]
        order["services/order/<br/>main.py service.py repo.py"]
        inv["services/inventory/"]
        rpt["services/report/ + worker/"]
        gw["gateway/"]
        deploy["deploy/<br/>*.yaml K8s 清单"]
        docs["docs/<br/>ADR / 质量属性场景 / 评审纪要"]
    end
    order & inv & rpt & gw --> common
    deploy -.引用镜像.-> order & inv & rpt & gw
```

## 5. 场景视图（+1）—— 用一条关键用例串联验证

> 【填写：选一条最关键用例（如"下单"），用文字说明它如何穿越其余四视图。】

示例（下单）：进程视图的"下单"序列图同时穿越逻辑视图的模块（订单/库存/MQ）、
物理视图的节点（各 Deployment）、开发视图的代码边界（services/order → common/outbox）
——四视图一致。
