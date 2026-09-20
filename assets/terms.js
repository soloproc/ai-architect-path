/* terms.js —— 专有名词读法标注
 * 扫描 .content 正文，每个术语在本页首次出现时自动加虚线标注；
 * 点击弹出卡片：音标 / 中文谐音 / 一句话解释 / 🔊 发音（浏览器 TTS，无需联网服务）。
 * 在 notes.js 之前加载，纯前端无依赖。
 */
(function () {
  'use strict';

  /* t: 术语；say: 交给 TTS 读的文本；ipa: 音标；cn: 中文谐音/读法提示；zh: 一句话解释 */
  var TERMS = [
    /* ---- 云原生 / K8s 生态 ---- */
    { t: 'Kubernetes', say: 'Kubernetes', ipa: '/ˌkuːbərˈnetɪs/', cn: '库伯耐提斯', zh: '容器编排的事实标准，常缩写 K8s' },
    { t: 'K8s', say: 'Kubernetes', ipa: '读作 Kubernetes', cn: '库伯耐提斯（K 和 s 之间 8 个字母）', zh: 'Kubernetes 的数字缩写' },
    { t: 'etcd', say: 'et see dee', ipa: '/ˈetsiːdiː/', cn: '埃特-西-迪', zh: 'K8s 的元数据存储，基于 Raft 的分布式 KV' },
    { t: 'Istio', say: 'Istio', ipa: '/ˈɪstioʊ/', cn: '伊斯提欧', zh: '主流服务网格（Service Mesh）实现' },
    { t: 'Envoy', say: 'Envoy', ipa: '/ˈenvɔɪ/', cn: '恩沃伊', zh: '高性能边车代理，Istio 的数据面' },
    { t: 'containerd', say: 'container dee', ipa: '/kənˈteɪnər diː/', cn: '康特纳-迪', zh: 'K8s 标准容器运行时' },
    { t: 'runc', say: 'run see', ipa: '/rʌn siː/', cn: '润-西', zh: '底层 OCI 容器运行时' },
    { t: 'OCI', say: 'O C I', ipa: '逐字母 O-C-I', cn: '欧-西-爱', zh: '开放容器标准（镜像与运行时规范）' },
    { t: 'Helm', say: 'Helm', ipa: '/helm/', cn: '赫尔姆', zh: 'K8s 的包管理器， chart 即应用模板' },
    { t: 'Cilium', say: 'Cilium', ipa: '/ˈsɪliəm/', cn: '西里厄姆', zh: '基于 eBPF 的 K8s 网络方案' },
    { t: 'Calico', say: 'Calico', ipa: '/kəˈliːkoʊ/', cn: '卡利口', zh: 'K8s 网络与网络策略插件' },
    { t: 'eBPF', say: 'E B P F', ipa: '逐字母 E-B-P-F', cn: '伊-比-屁-埃夫', zh: '内核可编程技术，云原生网络/可观测的底座' },
    { t: 'CoreDNS', say: 'Core D N S', ipa: '/kɔːr diː en es/', cn: '考-D-N-S', zh: 'K8s 集群内 DNS 服务' },
    { t: 'Docker', say: 'Docker', ipa: '/ˈdɒkər/', cn: '多克', zh: '容器引擎，把应用和环境打包成镜像' },
    { t: 'Prometheus', say: 'Prometheus', ipa: '/prəˈmiːθiəs/', cn: '普罗米修斯', zh: '指标监控的事实标准，PromQL 查询' },
    { t: 'Grafana', say: 'Grafana', ipa: '/ɡrəˈfɑːnə/', cn: '格拉法纳', zh: '可视化大盘，常接 Prometheus' },
    { t: 'Jaeger', say: 'Jaeger', ipa: '/ˈjeɪɡər/', cn: '耶格', zh: '分布式链路追踪系统' },
    { t: 'OpenTelemetry', say: 'Open Telemetry', ipa: '/ˈoʊpən tɛləˈmɛtri/', cn: '欧盆-泰勒麦吹', zh: ' traces/metrics/logs 统一采集标准，简称 OTel' },
    { t: 'OTel', say: 'O tel', ipa: '/oʊ tɛl/', cn: '欧-太欧', zh: 'OpenTelemetry 的简称' },
    { t: 'SkyWalking', say: 'Sky Walking', ipa: '/skaɪ ˈwɔːkɪŋ/', cn: '斯盖-沃金', zh: '国产 APM 与链路追踪' },
    { t: 'Sentinel', say: 'Sentinel', ipa: '/ˈsentɪnəl/', cn: '森提诺', zh: '阿里开源的流量哨兵：限流/熔断/降级' },
    { t: 'Hystrix', say: 'Hystrix', ipa: '/hɪˈstrɪks/', cn: '希斯特里克斯', zh: 'Netflix 老牌熔断器（已停更，理念仍经典）' },
    { t: 'Resilience4j', say: 'Resilience for jay', ipa: '/rɪˈzɪliəns fɔː dʒeɪ/', cn: '瑞利恩斯-佛-杰', zh: 'Hystrix 的轻量继任者' },
    { t: 'Nacos', say: 'Nacos', ipa: '/ˈnɑːkoʊs/', cn: '纳科斯', zh: '阿里的注册中心 + 配置中心' },
    { t: 'Consul', say: 'Consul', ipa: '/ˈkɒnsəl/', cn: '康索', zh: 'HashiCorp 的服务发现与配置' },
    { t: 'Apollo', say: 'Apollo', ipa: '/əˈpɒloʊ/', cn: '阿波罗', zh: '携程开源的配置中心' },
    { t: 'Gremlin', say: 'Gremlin', ipa: '/ˈɡremlɪn/', cn: '格瑞姆林', zh: '混沌工程故障注入工具' },
    { t: 'Chaos', say: 'Chaos', ipa: '/ˈkeɪɒs/', cn: '凯奥斯', zh: '混沌工程：故意制造故障验证韧性' },

    /* ---- SRE / 可观测 ---- */
    { t: 'SRE', say: 'S R E', ipa: '逐字母 S-R-E', cn: '埃斯-阿-伊', zh: '站点可靠性工程，用软件工程做运维' },
    { t: 'SLA', say: 'S L A', ipa: '逐字母 S-L-A', cn: '埃斯-埃欧-诶', zh: '服务等级协议（对外的承诺，含赔偿）' },
    { t: 'SLO', say: 'S L O', ipa: '逐字母 S-L-O', cn: '埃斯-埃欧-欧', zh: '服务等级目标（内部考核线）' },
    { t: 'SLI', say: 'S L I', ipa: '逐字母 S-L-I', cn: '埃斯-埃欧-爱', zh: '服务等级指标（实际测量值）' },
    { t: 'MTTR', say: 'M T T R', ipa: '逐字母 M-T-T-R', cn: '埃姆-替-替-阿', zh: '平均修复时间' },
    { t: 'MTBF', say: 'M T B F', ipa: '逐字母 M-T-B-F', cn: '埃姆-替-比-埃夫', zh: '平均故障间隔' },
    { t: 'DevOps', say: 'DevOps', ipa: '/ˈdevɒps/', cn: '戴夫-奥普斯', zh: '开发与运维一体化的协作文化' },
    { t: 'GitOps', say: 'Git Ops', ipa: '/ɡɪt ɒps/', cn: '给特-奥普斯', zh: '以 Git 为唯一事实源的发布范式' },
    { t: 'CI/CD', say: 'C I C D', ipa: '逐字母 C-I-C-D', cn: '西-爱-西-迪', zh: '持续集成 / 持续交付（部署）' },
    { t: 'Canary', say: 'Canary', ipa: '/kəˈneəri/', cn: '卡纳里', zh: '金丝雀发布：先放 1% 流量试新版本' },

    /* ---- 网络 / 系统 ---- */
    { t: 'TCP', say: 'T C P', ipa: '逐字母 T-C-P', cn: '替-西-辟', zh: '可靠的面向连接传输协议（三次握手）' },
    { t: 'UDP', say: 'U D P', ipa: '逐字母 U-D-P', cn: '优-迪-辟', zh: '无连接的轻量传输协议，快但可能丢包' },
    { t: 'HTTP', say: 'H T T P', ipa: '逐字母 H-T-T-P', cn: '诶尺-替-替-辟', zh: '超文本传输协议，万维网的基石' },
    { t: 'HTTPS', say: 'H T T P S', ipa: '逐字母 H-T-T-P-S', cn: '诶尺-替-替-辟-埃斯', zh: 'HTTP + TLS 加密' },
    { t: 'TLS', say: 'T L S', ipa: '逐字母 T-L-S', cn: '替-埃欧-埃斯', zh: '传输层加密协议，SSL 的继任者' },
    { t: 'SSL', say: 'S S L', ipa: '逐字母 S-S-L', cn: '埃斯-埃斯-埃欧', zh: '上一代加密协议（现泛指 TLS 证书体系）' },
    { t: 'QUIC', say: 'quick', ipa: '/kwɪk/', cn: '奎克（同英文 quick）', zh: '基于 UDP 的新一代传输协议，HTTP/3 的底座' },
    { t: 'DNS', say: 'D N S', ipa: '逐字母 D-N-S', cn: '迪-恩-埃斯', zh: '域名系统：把域名翻译成 IP' },
    { t: 'CDN', say: 'C D N', ipa: '逐字母 C-D-N', cn: '西-迪-恩', zh: '内容分发网络，把缓存推到离用户近的节点' },
    { t: 'API', say: 'A P I', ipa: '逐字母 A-P-I', cn: '诶-屁-爱', zh: '应用程序接口' },
    { t: 'REST', say: 'rest', ipa: '/rest/', cn: '雷斯特（同英文 rest）', zh: '以资源为中心的 API 风格' },
    { t: 'gRPC', say: 'G R P C', ipa: '逐字母 G-R-P-C', cn: '吉-阿-屁-西', zh: '基于 HTTP/2 + Protobuf 的高性能 RPC 框架' },
    { t: 'RPC', say: 'R P C', ipa: '逐字母 R-P-C', cn: '阿-屁-西', zh: '远程过程调用' },
    { t: 'WebSocket', say: 'Web Socket', ipa: '/web ˈsɒkɪt/', cn: '韦伯-索基特', zh: '浏览器与服务端的全双工长连接' },
    { t: 'SSE', say: 'S S E', ipa: '逐字母 S-S-E', cn: '埃斯-埃斯-伊', zh: '服务端推送事件，LLM 流式输出常用' },
    { t: 'RTT', say: 'R T T', ipa: '逐字母 R-T-T', cn: '阿-替-替', zh: '往返时延' },
    { t: 'TTL', say: 'T T L', ipa: '逐字母 T-T-L', cn: '替-替-埃欧', zh: '生存时间（缓存/报文的有效期）' },
    { t: 'OSI', say: 'O S I', ipa: '逐字母 O-S-I', cn: '欧-埃斯-爱', zh: '七层网络参考模型' },
    { t: 'Linux', say: 'Linux', ipa: '/ˈlɪnəks/', cn: '利纳克斯', zh: '开源操作系统内核，服务器的绝对主流' },
    { t: 'Unix', say: 'Unix', ipa: '/ˈjuːnɪks/', cn: '尤尼克斯', zh: 'Linux 的精神鼻祖' },
    { t: 'POSIX', say: 'POSIX', ipa: '/ˈpɒzɪks/', cn: '帕齐克斯', zh: '可移植操作系统接口标准' },
    { t: 'IOPS', say: 'I O P S', ipa: '逐字母 I-O-P-S', cn: '爱-欧-屁-埃斯', zh: '每秒读写次数，磁盘性能指标' },
    { t: 'JVM', say: 'J V M', ipa: '逐字母 J-V-M', cn: '杰-维-埃姆', zh: 'Java 虚拟机' },
    { t: 'WASM', say: 'WASM', ipa: '/ˈwæzəm/', cn: '沃泽姆', zh: 'WebAssembly 的缩写，近原生速度的浏览器字节码' },
    { t: 'WebAssembly', say: 'Web Assembly', ipa: '/web əˈsɛmbli/', cn: '韦伯-阿森布利', zh: '浏览器里的高性能字节码格式' },

    /* ---- 数据库 / 存储 ---- */
    { t: 'MySQL', say: 'My S Q L', ipa: '/maɪ es kjuː el/', cn: '买-埃斯-扣-埃欧', zh: '最流行的开源关系型数据库' },
    { t: 'PostgreSQL', say: 'Postgres Q L', ipa: '/ˈpoʊstɡres kjuː el/', cn: '波斯特格雷斯-扣-埃欧', zh: '功能最强的开源关系库，口语叫 Postgres' },
    { t: 'Postgres', say: 'Postgres', ipa: '/ˈpoʊstɡres/', cn: '波斯特格雷斯', zh: 'PostgreSQL 的通用简称' },
    { t: 'SQLite', say: 'S Q L ite', ipa: '/es kjuː el ˈlaɪt/', cn: '埃斯-扣-埃欧-莱特', zh: '嵌入式单文件数据库' },
    { t: 'Redis', say: 'Redis', ipa: '/ˈredɪs/', cn: '雷迪斯', zh: '内存 KV 数据库，缓存/队列/分布式锁常客' },
    { t: 'MongoDB', say: 'Mongo D B', ipa: '/ˈmɒŋɡoʊ diː biː/', cn: '芒戈-迪-比', zh: '文档型 NoSQL 数据库' },
    { t: 'Elasticsearch', say: 'Elastic Search', ipa: '/ɪˈlæstɪk sɜːrtʃ/', cn: '伊拉斯提克-瑟奇', zh: '分布式搜索引擎，简称 ES' },
    { t: 'ClickHouse', say: 'Click House', ipa: '/klɪk haʊs/', cn: '克利克-豪斯', zh: '列式 OLAP 分析数据库，以快著称' },
    { t: 'TiDB', say: 'Ti D B', ipa: '/taɪ diː biː/', cn: '泰-迪-比', zh: 'PingCAP 的分布式 NewSQL 数据库' },
    { t: 'TiKV', say: 'Ti K V', ipa: '/taɪ keɪ viː/', cn: '泰-K-维', zh: 'TiDB 底层的分布式 KV 存储' },
    { t: 'Vitess', say: 'Vitess', ipa: '/vaɪˈtes/', cn: '维泰斯', zh: 'MySQL 分库分表中间件（YouTube 出品）' },
    { t: 'SQL', say: 'S Q L', ipa: '/es kjuː el/', cn: '埃斯-扣-埃欧（也有人读 "sequel"）', zh: '结构化查询语言' },
    { t: 'NoSQL', say: 'No S Q L', ipa: '/noʊ es kjuː el/', cn: '诺-埃斯-扣-埃欧', zh: '非关系型数据库的统称' },
    { t: 'OLTP', say: 'O L T P', ipa: '逐字母 O-L-T-P', cn: '欧-埃欧-替-辟', zh: '在线事务处理（下单、支付这类）' },
    { t: 'OLAP', say: 'O L A P', ipa: '逐字母 O-L-A-P', cn: '欧-埃欧-诶-辟', zh: '在线分析处理（报表、大盘这类）' },
    { t: 'LSM', say: 'L S M', ipa: '逐字母 L-S-M', cn: '埃欧-埃斯-埃姆', zh: '日志结构合并树，写优化存储引擎（RocksDB 等）' },
    { t: 'WAL', say: 'W A L', ipa: '逐字母 W-A-L', cn: '达不溜-诶-埃欧', zh: '预写日志：先记日志再改数据，宕机可恢复' },
    { t: 'MVCC', say: 'M V C C', ipa: '逐字母 M-V-C-C', cn: '埃姆-维-西-西', zh: '多版本并发控制：读写不互相阻塞' },
    { t: 'Raft', say: 'Raft', ipa: '/ræft/', cn: '拉夫特（本义"木筏"）', zh: '以易懂著称的分布式共识算法' },
    { t: 'Paxos', say: 'Paxos', ipa: '/ˈpæksɒs/', cn: '帕克索斯', zh: '共识算法的理论鼻祖（以难懂著称）' },
    { t: 'Zab', say: 'Zab', ipa: '/zæb/', cn: '扎布', zh: 'ZooKeeper 的原子广播协议' },
    { t: 'ZooKeeper', say: 'Zoo Keeper', ipa: '/ˈzuːkiːpər/', cn: '祖-奇珀', zh: '分布式协调服务，常缩写 ZK' },
    { t: 'ACID', say: 'ACID', ipa: '/ˈæsɪd/', cn: '阿西德（同英文"酸"）', zh: '事务四性：原子/一致/隔离/持久' },
    { t: 'BASE', say: 'base', ipa: '/beɪs/', cn: '贝斯（同英文 base）', zh: '基本可用/软状态/最终一致，与 ACID 对偶' },
    { t: 'CAP', say: 'C A P', ipa: '逐字母 C-A-P', cn: '西-诶-辟', zh: '一致性/可用性/分区容忍不可兼得' },
    { t: 'TCC', say: 'T C C', ipa: '逐字母 T-C-C', cn: '替-西-西', zh: 'Try-Confirm-Cancel 柔性事务模式' },
    { t: 'Saga', say: 'Saga', ipa: '/ˈsɑːɡə/', cn: '萨嘎（本义"史诗"）', zh: '长事务拆成多步本地事务 + 补偿' },
    { t: '2PC', say: 'two P C', ipa: '/tuː piː siː/', cn: '兔-屁-西', zh: '两阶段提交（强一致但会阻塞）' },
    { t: '3PC', say: 'three P C', ipa: '/θriː piː siː/', cn: '斯瑞-屁-西', zh: '三阶段提交（2PC 的改进版）' },
    { t: 'QPS', say: 'Q P S', ipa: '逐字母 Q-P-S', cn: '扣-屁-埃斯', zh: '每秒查询数' },
    { t: 'TPS', say: 'T P S', ipa: '逐字母 T-P-S', cn: '替-屁-埃斯', zh: '每秒事务数' },

    /* ---- 消息 / 大数据 ---- */
    { t: 'Kafka', say: 'Kafka', ipa: '/ˈkæfkə/', cn: '卡夫卡（即作家卡夫卡）', zh: '高吞吐分布式消息队列/日志流' },
    { t: 'Pulsar', say: 'Pulsar', ipa: '/ˈpʌlsɑːr/', cn: '帕尔萨（本义"脉冲星"）', zh: '存算分离的下一代消息队列' },
    { t: 'RocketMQ', say: 'Rocket M Q', ipa: '/ˈrɒkɪt em kjuː/', cn: '洛基特-埃姆-扣', zh: '阿里开源的消息队列，电商场景打磨' },
    { t: 'Flink', say: 'Flink', ipa: '/flɪŋk/', cn: '弗林克', zh: '流式计算引擎，实时数仓主力' },
    { t: 'Spark', say: 'Spark', ipa: '/spɑːrk/', cn: '斯帕克（本义"火花"）', zh: '批处理大数据计算引擎' },
    { t: 'Hadoop', say: 'Hadoop', ipa: '/həˈduːp/', cn: '哈杜普', zh: '大数据生态开山鼻祖（HDFS+MapReduce）' },
    { t: 'Hive', say: 'Hive', ipa: '/haɪv/', cn: '海夫（本义"蜂巢"）', zh: '用 SQL 查 HDFS 的数据仓库工具' },
    { t: 'Paimon', say: 'Paimon', ipa: '/ˈpeɪmən/', cn: '佩蒙', zh: '流式数据湖格式（原 Flink Table Store）' },
    { t: 'Iceberg', say: 'Iceberg', ipa: '/ˈaɪsbɜːrɡ/', cn: '艾斯伯格（本义"冰山"）', zh: '数据湖表格式三剑客之一' },
    { t: 'Hudi', say: 'Hudi', ipa: '/ˈhuːdi/', cn: '胡迪', zh: '数据湖表格式三剑客之一，擅 Upsert' },
    { t: 'Parquet', say: 'Parquet', ipa: '/pɑːrˈkeɪ/', cn: '帕尔凯', zh: '列式存储文件格式' },
    { t: 'Avro', say: 'Avro', ipa: '/ˈævroʊ/', cn: '阿夫罗', zh: '行式序列化格式，Kafka 生态常用' },
    { t: 'Presto', say: 'Presto', ipa: '/ˈprestoʊ/', cn: '普雷斯托', zh: '交互式联邦查询引擎，Trino 的前身' },
    { t: 'Trino', say: 'Trino', ipa: '/ˈtriːnoʊ/', cn: '吹诺', zh: 'Presto 的开源正统续作' },
    { t: 'Debezium', say: 'Debezium', ipa: '/dɪˈbiːziəm/', cn: '德比齐厄姆', zh: 'CDC 利器：把数据库变更流式导出' },
    { t: 'Canal', say: 'Canal', ipa: '/kəˈnæl/', cn: '卡纳尔（本义"运河"）', zh: '阿里的 MySQL binlog 订阅工具' },
    { t: 'Airflow', say: 'Airflow', ipa: '/ˈeərfloʊ/', cn: '艾尔-弗洛', zh: 'DAG 任务调度平台' },
    { t: 'Doris', say: 'Doris', ipa: '/ˈdɔːrɪs/', cn: '多丽丝', zh: 'Apache 实时分析型数据库' },
    { t: 'StarRocks', say: 'Star Rocks', ipa: '/stɑːr rɒks/', cn: '斯达-洛克斯', zh: '国产高性能 OLAP 数据库' },
    { t: 'Kudu', say: 'Kudu', ipa: '/ˈkuːduː/', cn: '库杜（本义"捻角羚"）', zh: '介于 HDFS 与 HBase 之间的存储' },
    { t: 'CDC', say: 'C D C', ipa: '逐字母 C-D-C', cn: '西-迪-西', zh: '变更数据捕获' },
    { t: 'ETL', say: 'E T L', ipa: '逐字母 E-T-L', cn: '伊-替-埃欧', zh: '抽取-转换-加载的数据管道' },

    /* ---- AI / LLM ---- */
    { t: 'LLM', say: 'L L M', ipa: '逐字母 L-L-M', cn: '埃欧-埃欧-埃姆', zh: '大语言模型' },
    { t: 'GPT', say: 'G P T', ipa: '逐字母 G-P-T', cn: '吉-屁-替', zh: 'OpenAI 的生成式预训练 Transformer 系列' },
    { t: 'Transformer', say: 'Transformer', ipa: '/trænsˈfɔːrmər/', cn: '川斯-佛默（同"变形金刚"）', zh: '注意力机制架构，LLM 的共同底座' },
    { t: 'Token', say: 'Token', ipa: '/ˈtoʊkən/', cn: '透肯', zh: '模型读写的最小文本单位，计费也按它' },
    { t: 'Embedding', say: 'Embedding', ipa: '/ɪmˈbedɪŋ/', cn: '因-贝丁', zh: '把文本变成向量，语义检索的基础' },
    { t: 'RAG', say: 'RAG', ipa: '/ræɡ/', cn: '拉格', zh: '检索增强生成：先查资料再回答' },
    { t: 'RLHF', say: 'R L H F', ipa: '逐字母 R-L-H-F', cn: '阿-埃欧-诶尺-埃夫', zh: '基于人类反馈的强化学习对齐' },
    { t: 'LoRA', say: 'LoRA', ipa: '/ˈlɔːrə/', cn: '洛拉', zh: '低秩适配：只训练小补丁的省钱微调法' },
    { t: 'QLoRA', say: 'Q LoRA', ipa: '/kjuː ˈlɔːrə/', cn: '扣-洛拉', zh: '量化版 LoRA，单卡可微调大模型' },
    { t: 'SFT', say: 'S F T', ipa: '逐字母 S-F-T', cn: '埃斯-埃夫-替', zh: '监督微调' },
    { t: 'MoE', say: 'M o E', ipa: '/em oʊ iː/', cn: '埃姆-欧-伊', zh: '混合专家：每次只激活部分参数的大模型架构' },
    { t: 'MCP', say: 'M C P', ipa: '逐字母 M-C-P', cn: '埃姆-西-辟', zh: '模型上下文协议，AI 连接工具/数据的通用插座' },
    { t: 'A2A', say: 'A to A', ipa: '/eɪ tuː eɪ/', cn: '诶-兔-诶', zh: 'Agent-to-Agent 智能体互联协议' },
    { t: 'FDE', say: 'F D E', ipa: '逐字母 F-D-E', cn: '埃夫-迪-伊', zh: '前置部署工程师，Palantir 带火的 AI 交付模式' },
    { t: 'GPU', say: 'G P U', ipa: '逐字母 G-P-U', cn: '吉-屁-优', zh: '图形处理器，AI 训练/推理的主力算力' },
    { t: 'CUDA', say: 'CUDA', ipa: '/ˈkuːdə/', cn: '库达', zh: 'NVIDIA 的 GPU 编程平台' },
    { t: 'TensorRT', say: 'Tensor R T', ipa: '/ˈtensər ɑːr tiː/', cn: '坦瑟-阿-替', zh: 'NVIDIA 的推理加速库' },
    { t: 'vLLM', say: 'V L L M', ipa: '逐字母 V-L-L-M', cn: '维-埃欧-埃欧-埃姆', zh: '高吞吐 LLM 推理引擎，PagedAttention 发明者' },
    { t: 'KV Cache', say: 'K V Cache', ipa: '/keɪ viː kæʃ/', cn: '剋-维-凯什', zh: '注意力键值缓存，推理显存大头' },
    { t: 'TTFT', say: 'T T F T', ipa: '逐字母 T-T-F-T', cn: '替-替-埃夫-替', zh: '首 Token 时延，流式体验关键指标' },
    { t: 'TPOT', say: 'T P O T', ipa: '逐字母 T-P-O-T', cn: '替-屁-欧-替', zh: '每个输出 Token 的时延' },
    { t: 'ONNX', say: 'ONNX', ipa: '/ˈɒnɪks/', cn: '奥尼克斯', zh: '跨框架模型交换格式' },
    { t: 'GGUF', say: 'G G U F', ipa: '逐字母 G-G-U-F', cn: '吉-吉-优-埃夫', zh: 'llama.cpp 的量化模型格式' },
    { t: 'AWQ', say: 'A W Q', ipa: '逐字母 A-W-Q', cn: '诶-达不溜-扣', zh: '激活感知权重量化方法' },
    { t: 'HBM', say: 'H B M', ipa: '逐字母 H-B-M', cn: '诶尺-比-埃姆', zh: '高带宽显存，AI 卡的命脉' },
    { t: 'NVLink', say: 'N V Link', ipa: '/en viː lɪŋk/', cn: '恩-维-林克', zh: 'NVIDIA 的 GPU 间高速互联' },
    { t: 'RoCE', say: 'RoCE', ipa: '/ˈroʊki/', cn: '洛奇（谐音 rocky）', zh: 'RDMA over Converged Ethernet，算力集群组网' },
    { t: 'RDMA', say: 'R D M A', ipa: '逐字母 R-D-M-A', cn: '阿-迪-埃姆-诶', zh: '远程直接内存访问，绕过内核零拷贝' },
    { t: 'CoT', say: 'C O T', ipa: '逐字母 C-O-T', cn: '西-欧-替', zh: '思维链提示：让模型一步步推理' },
    { t: 'ReAct', say: 'ReAct', ipa: '/riˈækt/', cn: '里-阿克特', zh: '推理+行动交替的 Agent 范式' },
    { t: 'Agent', say: 'Agent', ipa: '/ˈeɪdʒənt/', cn: '埃真特', zh: '智能体：能规划、用工具、自主执行的 AI' },
    { t: 'Prompt', say: 'Prompt', ipa: '/prɒmpt/', cn: '普隆普特', zh: '提示词' },
    { t: 'Inference', say: 'Inference', ipa: '/ˈɪnfərəns/', cn: '因弗伦斯', zh: '推理：用训练好的模型生成答案' },
    { t: 'Fine-tuning', say: 'Fine tuning', ipa: '/faɪn ˈtjuːnɪŋ/', cn: '凡-图宁', zh: '微调：在预训练模型上继续训练' },
    { t: 'Hallucination', say: 'Hallucination', ipa: '/həˌluːsɪˈneɪʃən/', cn: '哈路西-内申', zh: '幻觉：模型一本正经地胡说八道' },
    { t: 'Milvus', say: 'Milvus', ipa: '/ˈmɪlvəs/', cn: '米尔维斯', zh: '开源向量数据库' },
    { t: 'Faiss', say: 'Faiss', ipa: '/feɪs/', cn: '菲斯（同英文 face）', zh: 'Meta 的向量检索库' },
    { t: 'Qdrant', say: 'Qdrant', ipa: '/ˈkwɑːdrənt/', cn: '夸德兰特', zh: 'Rust 写的向量数据库' },
    { t: 'Chroma', say: 'Chroma', ipa: '/ˈkroʊmə/', cn: '克罗玛', zh: '轻量嵌入式向量数据库' },
    { t: 'LangChain', say: 'Lang Chain', ipa: '/læŋ tʃeɪn/', cn: '朗-臣', zh: '最知名的 LLM 应用编排框架' },
    { t: 'LlamaIndex', say: 'Llama Index', ipa: '/ˈlɑːmə ˈɪndeks/', cn: '拉玛-因戴克斯', zh: '专注 RAG 数据接入的框架' },
    { t: 'Ollama', say: 'Ollama', ipa: '/əˈlɑːmə/', cn: '奥拉玛', zh: '本地跑开源大模型的最简工具' },
    { t: 'Hugging Face', say: 'Hugging Face', ipa: '/ˈhʌɡɪŋ feɪs/', cn: '哈金-菲斯', zh: 'AI 界的 GitHub，模型与数据集集散地' },
    { t: 'OpenAI', say: 'Open A I', ipa: '/ˈoʊpən eɪ aɪ/', cn: '欧盆-诶-爱', zh: 'ChatGPT 背后的公司' },
    { t: 'Anthropic', say: 'Anthropic', ipa: '/ænˈθrɒpɪk/', cn: '安斯-罗匹克', zh: 'Claude 背后的公司' },
    { t: 'Claude', say: 'Claude', ipa: '/klɔːd/', cn: '克劳德', zh: 'Anthropic 的大模型' },
    { t: 'Gemini', say: 'Gemini', ipa: '/ˈdʒemɪnaɪ/', cn: '杰米奈（本义"双子座"）', zh: 'Google 的大模型' },
    { t: 'Llama', say: 'Llama', ipa: '/ˈlɑːmə/', cn: '拉玛（本义"羊驼"）', zh: 'Meta 的开源大模型系列' },
    { t: 'Qwen', say: 'Qwen', ipa: '/kwen/', cn: '可温', zh: '阿里通义千问开源模型' },
    { t: 'DeepSeek', say: 'Deep Seek', ipa: '/diːp siːk/', cn: '迪普-西克', zh: '深度求索的开源大模型' },
    { t: 'Mistral', say: 'Mistral', ipa: '/ˈmɪstrəl/', cn: '米斯特拉尔', zh: '法国明星开源模型公司' },
    { t: 'GLM', say: 'G L M', ipa: '逐字母 G-L-M', cn: '吉-埃欧-埃姆', zh: '智谱的通用语言模型系列' },
    { t: 'TTS', say: 'T T S', ipa: '逐字母 T-T-S', cn: '替-替-埃斯', zh: '语音合成（文字转语音）' },
    { t: 'ASR', say: 'A S R', ipa: '逐字母 A-S-R', cn: '诶-埃斯-阿', zh: '语音识别（语音转文字）' },
    { t: 'AIGC', say: 'A I G C', ipa: '逐字母 A-I-G-C', cn: '诶-爱-吉-西', zh: 'AI 生成内容' },
    { t: 'AGI', say: 'A G I', ipa: '逐字母 A-G-I', cn: '诶-吉-爱', zh: '通用人工智能' },

    /* ---- 架构 / 安全 / 其他 ---- */
    { t: 'nginx', say: 'engine x', ipa: '/ˌendʒɪnˈeks/', cn: '恩静-克斯（"engine-X"）', zh: '反向代理/负载均衡/Web 服务器三栖老将' },
    { t: 'SOA', say: 'S O A', ipa: '逐字母 S-O-A', cn: '埃斯-欧-诶', zh: '面向服务架构，微服务的前辈' },
    { t: 'DDD', say: 'D D D', ipa: '逐字母 D-D-D', cn: '迪-迪-迪', zh: '领域驱动设计' },
    { t: 'CQRS', say: 'C Q R S', ipa: '逐字母 C-Q-R-S', cn: '西-扣-阿-埃斯', zh: '命令查询职责分离' },
    { t: 'BFF', say: 'B F F', ipa: '逐字母 B-F-F', cn: '比-埃夫-埃夫', zh: '为前端定制后端聚合层（不是"永远的朋友"）' },
    { t: 'JWT', say: 'J W T', ipa: '逐字母 J-W-T', cn: '杰-达不溜-替（也有人读 "jot"）', zh: 'JSON Web Token，无状态登录凭证' },
    { t: 'OAuth', say: 'O auth', ipa: '/ˈoʊɔːθ/', cn: '欧-奥斯', zh: '开放授权协议（微信扫码登录背后的标准）' },
    { t: 'OIDC', say: 'O I D C', ipa: '逐字母 O-I-D-C', cn: '欧-爱-迪-西', zh: 'OAuth 2.0 之上的身份层' },
    { t: 'CORS', say: 'CORS', ipa: '/kɔːrs/', cn: '考斯', zh: '跨域资源共享' },
    { t: 'XSS', say: 'X S S', ipa: '逐字母 X-S-S', cn: '埃克斯-埃斯-埃斯', zh: '跨站脚本攻击' },
    { t: 'CSRF', say: 'C S R F', ipa: '逐字母 C-S-R-F', cn: '西-埃斯-阿-埃夫', zh: '跨站请求伪造' },
    { t: 'RBAC', say: 'R B A C', ipa: '逐字母 R-B-A-C', cn: '阿-比-诶-西', zh: '基于角色的访问控制' },
    { t: 'SSO', say: 'S S O', ipa: '逐字母 S-S-O', cn: '埃斯-埃斯-欧', zh: '单点登录' },
    { t: 'LDAP', say: 'L dap', ipa: '/ˈeldæp/', cn: '埃欧-达普', zh: '目录访问协议，企业账号体系常客' },
    { t: 'Sidecar', say: 'Sidecar', ipa: '/ˈsaɪdkɑːr/', cn: '赛德-卡（本义"边三轮"）', zh: '主容器旁的辅助容器，服务网格的基本形态' },
    { t: 'Service Mesh', say: 'Service Mesh', ipa: '/ˈsɜːrvɪs meʃ/', cn: '瑟维斯-麦什', zh: '服务网格：把流量治理下沉到基础设施' },
    { t: 'Serverless', say: 'Serverless', ipa: '/ˈsɜːrvərləs/', cn: '瑟沃勒斯', zh: '无服务器计算：不养机器，按调用付费' },
    { t: 'FaaS', say: 'FaaS', ipa: '/fæs/', cn: '法斯（谐音 fass）', zh: '函数即服务' },
    { t: 'PaaS', say: 'PaaS', ipa: '/pæs/', cn: '帕斯（同英文 pass）', zh: '平台即服务' },
    { t: 'IaaS', say: 'I a a S', ipa: '/ˈaɪæs/', cn: '爱-阿斯', zh: '基础设施即服务' },
    { t: 'SaaS', say: 'SaaS', ipa: '/sæs/', cn: '萨斯（谐音 sass）', zh: '软件即服务' },
    { t: 'Terraform', say: 'Terraform', ipa: '/ˈterəfɔːm/', cn: '特拉-佛姆', zh: '基础设施即代码（IaC）的头牌工具' },
    { t: 'Ansible', say: 'Ansible', ipa: '/ˈænsɪbəl/', cn: '安西伯', zh: '无 Agent 的自动化运维工具' },
    { t: 'YAML', say: 'YAML', ipa: '/ˈjæməl/', cn: '亚摩', zh: 'K8s 配置文件格式（"不是标记语言"）' },
    { t: 'JSON', say: 'Jason', ipa: '/ˈdʒeɪsən/', cn: '杰森', zh: 'JavaScript 对象表示法，数据交换标准' },
    { t: 'Protobuf', say: 'Proto buf', ipa: '/ˈproʊtoʊbʌf/', cn: '普罗托-巴夫', zh: 'Google 的二进制序列化协议' },
    { t: 'DDIA', say: 'D D I A', ipa: '逐字母 D-D-I-A', cn: '迪-迪-爱-诶', zh: '《设计数据密集型应用》，本教程的重要理论底座' },
    { t: 'KAE', say: 'K A E', ipa: '逐字母 K-A-E', cn: '剋-诶-伊', zh: '金山办公的 AI 工程平台（本教程案例来源之一）' },
    { t: 'Deno', say: 'Deno', ipa: '/ˈdiːnoʊ/', cn: '迪诺', zh: 'Node.js 作者的新一代 JS 运行时' },
    { t: 'Vite', say: 'Vite', ipa: '/viːt/', cn: '维特（法语"快"）', zh: '秒级启动的前端构建工具' },
    { t: 'Node.js', say: 'Node jay es', ipa: '/noʊd dʒeɪ es/', cn: '诺德-杰-埃斯', zh: '服务端 JavaScript 运行时' }
  ];

  var contentEl = document.querySelector('.content');
  if (!contentEl || !TERMS.length) return;

  /* ---- 样式 ---- */
  var css = ''
    + '.aap-term{border-bottom:1px dotted #b45309;cursor:help;color:inherit;}'
    + '.aap-term:hover{background:rgba(234,179,8,.14);}'
    + '.aap-termtip{position:absolute;z-index:92;width:280px;background:#fffdf9;border:1px solid #e5e1d8;border-radius:10px;box-shadow:0 10px 34px rgba(60,50,30,.18);padding:12px 14px;font-size:13px;color:#3f3a32;line-height:1.7;}'
    + '.aap-termtip .tn{font-size:15px;font-weight:700;color:#292524;display:flex;align-items:center;gap:8px;}'
    + '.aap-termtip .speak{margin-left:auto;border:1px solid #e5e1d8;background:#fff;border-radius:6px;padding:2px 9px;font-size:12px;cursor:pointer;color:#b45309;}'
    + '.aap-termtip .speak:hover{border-color:#b45309;}'
    + '.aap-termtip .ti{font-size:12px;color:#8a8578;margin-top:2px;}'
    + '.aap-termtip .tc{font-size:12.5px;color:#b45309;margin-top:2px;}'
    + '.aap-termtip .tz{font-size:12.5px;margin-top:6px;padding-top:6px;border-top:1px dashed #efece4;}';
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  /* ---- 匹配（按词长降序，最长优先） ---- */
  var byKey = {};
  TERMS.forEach(function (d) { byKey[d.t.toLowerCase()] = d; });
  var sorted = TERMS.slice().sort(function (a, b) { return b.t.length - a.t.length; });
  var escaped = sorted.map(function (d) { return d.t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
  var re;
  try {
    re = new RegExp('(?<![A-Za-z0-9_])(' + escaped.join('|') + ')(?![A-Za-z0-9_])', 'gi');
  } catch (e) { return; /* 老浏览器不支持 lookbehind，静默降级 */ }

  var SKIP = { PRE: 1, CODE: 1, SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1 };
  var seen = {};
  var budget = 60; /* 每页最多标注 60 个，避免满屏虚线 */

  function shouldSkip(node) {
    var p = node.parentNode;
    while (p && p !== contentEl) {
      if (p.nodeType === 1) {
        if (SKIP[p.tagName]) return true;
        if (p.classList && (p.classList.contains('aap-term') || p.classList.contains('demo-embed')
          || p.classList.contains('prevnext') || p.classList.contains('aap-comments'))) return true;
      }
      p = p.parentNode;
    }
    return false;
  }

  function annotate() {
    var walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue.trim() || shouldSkip(n)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (var k = 0; k < nodes.length && budget > 0; k++) {
      var n = nodes[k];
      re.lastIndex = 0;
      var m, pieces = [], last = 0, hit = false;
      while ((m = re.exec(n.nodeValue)) !== null) {
        var key = m[0].toLowerCase();
        if (seen[key]) continue;
        /* 只取本页首次出现；同一文本节点内继续向后找 */
        if (m.index > last) pieces.push(document.createTextNode(n.nodeValue.slice(last, m.index)));
        var span = document.createElement('span');
        span.className = 'aap-term';
        span.setAttribute('data-t', key);
        span.textContent = m[0];
        pieces.push(span);
        seen[key] = true;
        budget--;
        last = m.index + m[0].length;
        hit = true;
        if (budget <= 0) break;
      }
      if (hit) {
        if (last < n.nodeValue.length) pieces.push(document.createTextNode(n.nodeValue.slice(last)));
        var frag = document.createDocumentFragment();
        pieces.forEach(function (p) { frag.appendChild(p); });
        n.parentNode.replaceChild(frag, n);
      }
    }
  }

  /* ---- 点击术语 → 读音卡片 ---- */
  var tip = null;
  function closeTip() { if (tip && tip.parentNode) tip.parentNode.removeChild(tip); tip = null; }
  document.addEventListener('mousedown', function (e) {
    if (tip && !e.target.closest('.aap-termtip') && !e.target.closest('.aap-term')) closeTip();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeTip(); });

  function speak(text) {
    try {
      if (!('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = 0.85;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  contentEl.addEventListener('click', function (e) {
    var span = e.target.closest('.aap-term');
    if (!span) return;
    var d = byKey[span.getAttribute('data-t')];
    if (!d) return;
    closeTip();
    tip = document.createElement('div');
    tip.className = 'aap-termtip';
    tip.innerHTML = ''
      + '<div class="tn">' + d.t + '<button class="speak" title="朗读">🔊 读一下</button></div>'
      + '<div class="ti">' + (d.ipa || '') + '</div>'
      + '<div class="tc">读法：' + d.cn + '</div>'
      + '<div class="tz">' + d.zh + '</div>';
    tip.querySelector('.speak').addEventListener('click', function (ev) {
      ev.stopPropagation();
      speak(d.say);
    });
    document.body.appendChild(tip);
    var r = span.getBoundingClientRect();
    var top = r.bottom + window.scrollY + 8;
    var left = r.left + window.scrollX + r.width / 2 - 140;
    left = Math.max(8, Math.min(left, window.scrollX + document.documentElement.clientWidth - 288));
    tip.style.top = top + 'px';
    tip.style.left = left + 'px';
  });

  annotate();
})();
