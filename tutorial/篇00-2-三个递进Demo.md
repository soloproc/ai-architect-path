# 篇00-2：小白前置篇（下）——三个递进 Demo 与实战：聊天机器人 → Function Calling → 最小 RAG

> 导语：本页是「篇00 小白前置篇」的下半部分，也是零基础读者通往篇01 的最后一公里。**这页学什么**：三个递进 Demo——命令行聊天机器人、Function Calling 小 Agent、最小 RAG，外加新手六连坑、六个递进实战任务与 10 项自测清单。**学完能做什么**：你能独立写出并跑通"模型调用你自定义的 Python 函数、拿到函数返回结果、再基于结果继续生成回答"的完整循环——这个循环就是一切 Agent 的最小骨架，也是篇05「Agent Harness 与 Runtime」里所有复杂机制的雏形；第 5.2 节的 `query_orders` 工具更是贯穿项目 DataAgent 的第一块基石，篇03 立项时会直接复用[^course]。开始前请确认已完成上一页（篇00-1）的环境搭建与 Python/SQL 基本功——本页所有 Demo 都依赖那边建好的虚拟环境与 `shop.db`。

---

## 5. 三个递进 Demo（核心章节）

三个 Demo 共用同一个 OpenAI 兼容客户端配置。**以 DeepSeek 为例**（任何 OpenAI 兼容服务——如 Moonshot、通义、本地 vLLM——都只是改 `BASE_URL` 和模型名）。

先在终端设置环境变量（**密钥绝不写进代码**）：

```bash
export DEEPSEEK_API_KEY="sk-你的真实密钥"        # Windows PowerShell: $env:DEEPSEEK_API_KEY="sk-..."
export DEEPSEEK_BASE_URL="https://api.deepseek.com"   # 默认值，可省略
```

公共的客户端初始化（三个 Demo 文件开头都一样）：

```python
import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["DEEPSEEK_API_KEY"],   # 从环境变量读，不硬编码
    base_url=os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
)
MODEL = "deepseek-chat"     # 换成你的服务支持的模型名
```

### 5.1 Demo 1：命令行聊天机器人

**目标**：跑通一次真实的模型调用，理解 messages 数组与多轮对话的本质。

**前置知识**：3.2（dict/list）、3.4（f-string）、环境变量。

**完整代码**（存为 `demo1_chat.py`）：

```python
import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["DEEPSEEK_API_KEY"],
    base_url=os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
)
MODEL = "deepseek-chat"

# messages 是整个对话的"全部记忆"：模型本身不记事，
# 每轮都要把历史完整发过去。
messages = [{"role": "system", "content": "你是一个简洁的中文助手。"}]

while True:
    user_input = input("你: ").strip()
    if user_input in ("exit", "quit"):
        break
    messages.append({"role": "user", "content": user_input})
    resp = client.chat.completions.create(model=MODEL, messages=messages)
    reply = resp.choices[0].message.content
    messages.append({"role": "assistant", "content": reply})  # 关键：回填
    print(f"AI: {reply}\n")
```

**运行方式**：

```bash
python demo1_chat.py
```

**预期输出示例**：

```text
你: 你好，我叫小明
AI: 你好小明！有什么可以帮你的？

你: 我叫什么名字？
AI: 你叫小明。
```

**为什么它能"记住"名字？** 不是模型有记忆，而是你的 `messages` 列表越来越长，每次请求都把全部历史发过去了——这就是篇01 会讲的"上下文即状态"，也是篇06「上下文治理」要管理的对象。

**流式输出（可选进阶）**：把 `create(...)` 改成 `create(..., stream=True)`，返回值变成迭代器，逐块打印：

```python
stream = client.chat.completions.create(model=MODEL, messages=messages, stream=True)
for chunk in stream:
    delta = chunk.choices[0].delta.content or ""
    print(delta, end="", flush=True)
```

**常见报错对照表**：

| 报错 | 含义 | 解法 |
|---|---|---|
| `401 AuthenticationError` | API key 错或没读到 | `echo $DEEPSEEK_API_KEY` 确认环境变量已设置；检查 key 是否复制完整 |
| `APITimeoutError` / 连接超时 | 网络不通或 base_url 错 | 检查 base_url 拼写；排查代理；`create(..., timeout=60)` 放宽超时 |
| `RateLimitError` (429) | 触发限流 | 降频重试；检查账户余额 |
| `BadRequestError: model not found` | 模型名不对 | 对照服务商文档改 `MODEL` |
| `KeyError: 'DEEPSEEK_API_KEY'` | 环境变量根本没设 | 在当前终端窗口重新 `export`，再运行 |

**还没配好环境？先在浏览器里跑一遍。** 下面这个在线 Python 环境内置了 Demo 1 的**纯模拟版**——用 mock 数据完整演示"发请求 → 拿响应 → 回填 messages"的流程，不需要任何 API key。第一次点"启动 Python 环境"会从 CDN 下载约 10MB+ 的 Pyodide 运行时（仅首次，之后浏览器缓存秒开）；加载完成后代码可随意编辑再运行。建议改一改问题列表（比如多问几轮）、或者在最后 `print(messages)` 看看对话历史长什么样——亲眼确认"记忆"就是越滚越长的 messages 数组：

```demo python-runner
```

**Demo 导学单**

1. 先什么都不改，点"运行"完整跑一遍，观察输出区里 messages 数组如何一轮轮变长——确认"记忆"是数组在变长，不是模型在记事。
2. 找到代码里的问题列表，加一句你自己的问题（比如"我们刚才聊了几轮？"），重新运行，看模拟模型如何基于历史回答。
3. 在代码末尾加一行 `print(messages)`，数一数最终数组里有几个元素、各有几种 role，对照第 3.2 节"一叠登记表"的类比。
4. 把 `system` 消息的内容改成"你是一个只回答三个字的助手"，重新运行，体会 system role 对后续每一轮的持续约束——这是篇01"Prompt 是唯一编程接口"的第一次体感。

### 5.2 Demo 2：Function Calling 小 Agent（本篇的最高潮）

**目标**：手写"模型请求工具 → 你的代码执行 → 把结果回填给模型 → 模型再生成"的完整循环。**这就是一切 Agent 框架（LangChain、AutoGen 等）内部在做的事，也是篇05「Agent Harness 与 Runtime」里 Harness 执行循环的最小雏形**——篇05 会在这个循环上加 Task Contract、重试、事件流、分布式执行，但骨架就是下面这 50 行。

**前置知识**：第 3 节全部 + 第 4 节 SQL（先运行过 `init_db.py` 生成 `shop.db`）。

**Function Calling 循环图**：

```mermaid
flowchart LR
    A["用户提问"] --> B["把 messages + 工具定义<br/>发给模型"]
    B --> C{"模型决定:<br/>直接答 or 调工具?"}
    C -- "调工具" --> D["解析工具名与参数 JSON"]
    D --> E["执行本地 Python 函数<br/>calculator / query_orders"]
    E --> F["把函数结果作为 tool 消息<br/>回填 messages"]
    F --> B
    C -- "直接答" --> G["输出最终回答"]
```

**完整代码**（存为 `demo2_tools.py`，两段：工具定义 + 主循环）：

```python
import json, os, sqlite3
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["DEEPSEEK_API_KEY"],
    base_url=os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
)
MODEL = "deepseek-chat"

# ---- 工具 1：计算器（精确计算永远交给代码，不让模型口算）----
def calculator(expr: str) -> str:
    allowed = set("0123456789+-*/.() ")
    if not set(expr) <= allowed:
        return "错误：表达式含非法字符"
    return str(eval(expr))   # 教学简化；生产环境请用 ast 白名单解析

# ---- 工具 2：查订单（查第 4 节建的 SQLite 库）----
def query_orders(status: str = "已完成") -> str:
    conn = sqlite3.connect("shop.db")
    cur = conn.cursor()
    cur.execute("""
        SELECT o.id, p.name, o.quantity, o.amount, o.created_at
        FROM orders o JOIN products p ON o.product_id = p.id
        WHERE o.status = ?""", (status,))
    rows = cur.fetchall()
    conn.close()
    return json.dumps(rows, ensure_ascii=False) if rows else "无匹配订单"

TOOLS = {"calculator": calculator, "query_orders": query_orders}

# 工具 Schema：模型靠这段描述决定"何时调、传什么参"
TOOL_SCHEMAS = [
    {"type": "function", "function": {
        "name": "calculator",
        "description": "计算数学表达式，如 '399*2+89'",
        "parameters": {"type": "object", "properties": {
            "expr": {"type": "string", "description": "数学表达式"}},
            "required": ["expr"]}}},
    {"type": "function", "function": {
        "name": "query_orders",
        "description": "按状态查询订单，返回订单号、商品名、数量、金额、日期",
        "parameters": {"type": "object", "properties": {
            "status": {"type": "string", "enum": ["已完成", "已退款"],
                       "description": "订单状态"}}}}},
]
```

主循环（接在上面的代码后面，同一个文件）：

```python
def run(question: str):
    messages = [
        {"role": "system", "content": "你是零售数据助手，需要数据时调用工具，回答要引用工具返回的真实数字。"},
        {"role": "user", "content": question},
    ]
    for step in range(6):                       # 最多 6 轮，防死循环
        resp = client.chat.completions.create(
            model=MODEL, messages=messages, tools=TOOL_SCHEMAS)
        msg = resp.choices[0].message
        if not msg.tool_calls:                  # 模型不再要工具 → 最终答案
            print(f"[step {step}] 最终回答: {msg.content}")
            return msg.content
        messages.append(msg)                    # 回填模型的工具请求
        for call in msg.tool_calls:
            name = call.function.name
            args = json.loads(call.function.arguments or "{}")
            print(f"[step {step}] 模型请求工具: {name}({args})")
            try:
                result = TOOLS[name](**args)    # 真正执行你的 Python 函数
            except Exception as e:
                result = f"工具执行失败: {e}"
            print(f"[step {step}] 工具返回: {result[:80]}")
            messages.append({                   # 回填工具结果
                "role": "tool",
                "tool_call_id": call.id,
                "content": str(result),
            })
    print("达到最大步数，强制停止")

if __name__ == "__main__":
    run("已完成的订单一共卖了多少钱？把每个品类的金额也算一下，再算总和。")
```

**运行方式**：

```bash
python init_db.py     # 如果还没生成 shop.db
python demo2_tools.py
```

**预期输出示例**（每步日志清晰可见）：

```text
[step 0] 模型请求工具: query_orders({'status': '已完成'})
[step 0] 工具返回: [[1, "机械键盘", 2, 798.0, "2025-01-05"], [2, "保温杯", 5, 445.0, ...
[step 1] 模型请求工具: calculator({'expr': '798.0+445.0+399.0+267.0'})
[step 1] 工具返回: 1909.0
[step 2] 最终回答: 已完成订单共 4 笔，总销售额 1909.0 元。其中数码品类（机械键盘）1197.0 元，家居品类（保温杯）712.0 元……
```

**要点拆解**：

1. **模型只输出"想调什么工具"的 JSON，真正执行的是你的代码**。工具是"训练出来的格式"（篇01 1.2 节），所以必须校验参数、捕获异常——上面的 `try/except` 就是 Harness 可靠执行的最小版。
2. **`messages.append(msg)` 与 `role="tool"` 回填缺一不可**。少了任何一步，模型就不知道工具返回了什么。
3. **`for step in range(6)` 是最原始的"预算控制"**。篇05 会把这类控制升级为 Deadline、最大步数、Token 预算等正式机制。
4. 你已经无意中造出了 DataAgent 的第一个工具 `query_orders`——后面篇03 立项时它会长大成完整的查数能力。

**常见报错对照表**：

| 报错 | 含义 | 解法 |
|---|---|---|
| `JSONDecodeError` | 模型返回的 arguments 不是合法 JSON | `try/except json.JSONDecodeError` 兜底，把错误回填让模型重试 |
| `KeyError: '工具名'` | 模型幻觉出不存在的工具名 | `TOOLS.get(name)` 判空，未知名称返回错误信息给模型 |
| `sqlite3.OperationalError: no such table` | 没跑 `init_db.py` | 先运行 `python init_db.py` 并确认 `shop.db` 在当前目录 |
| context 超长 / `context_length_exceeded` | 循环太多轮、历史太长 | 减少最大步数；精简工具返回（如只返回前 20 行） |
| 模型死活不调工具 | Schema 描述不清 | 把 `description` 写得更具体，在 system prompt 里明确要求用工具 |

### 5.3 Demo 3：最小 RAG

**目标**：理解"检索增强生成"——先从本地文档里查出相关内容、拼进 Prompt，再让模型基于查到的内容回答。**为什么需要它？** 模型的知识有截止日期、且会"自信地错"（幻觉）；把检索到的真实文档塞进上下文，模型的回答就有了依据。篇06 会把这里的"分块 + 检索"升级为完整的上下文装配管线。

**前置知识**：3.1–3.5 + Demo 1。不依赖外部 Embedding API，用纯 Python 的 TF-IDF 降级方案（零额外服务，直接能跑）。

**先准备 3 个本地文档**（在 `docs/` 目录下各存一个 `.md` 文件，内容随意，例如）：

```bash
mkdir -p docs
echo "退货政策：支持 7 天无理由退货，定制商品除外。退款在 3 个工作日内原路退回。" > docs/退货政策.md
echo "发货说明：工作日 16 点前的订单当天发货，默认顺丰，新疆西藏发邮政。" > docs/发货说明.md
echo "会员权益：银卡会员 95 折，金卡会员 9 折且免运费，积分可抵现。" > docs/会员权益.md
```

**完整代码**（存为 `demo3_rag.py`，分两段：检索器 + 问答）：

```python
import math, os, re
from collections import Counter
from pathlib import Path

def tokenize(text: str) -> list:
    # 极简分词：英文按词、中文按单字（教学用，够用）
    return re.findall(r"[a-zA-Z]+|[一-鿿]", text.lower())

def chunk_text(text: str, size: int = 80) -> list:
    # 按固定长度滑窗分块，步长一半保留上下文重叠
    return [text[i:i + size] for i in range(0, len(text), size // 2)]

class TfidfRetriever:
    def __init__(self, docs_dir: str):
        self.chunks = []          # [(来源文件, 块文本), ...]
        for p in Path(docs_dir).glob("*.md"):
            for c in chunk_text(p.read_text(encoding="utf-8")):
                self.chunks.append((p.name, c))
        self.df = Counter()       # 每个词出现在多少个块中
        self.vecs = []
        for _, c in self.chunks:
            tf = Counter(tokenize(c))
            self.vecs.append(tf)
            for w in tf:
                self.df[w] += 1

    def _score(self, q_tf: Counter, tf: Counter) -> float:
        n = len(self.chunks)
        score = 0.0
        for w, qv in q_tf.items():
            if w in tf:
                idf = math.log(1 + n / (1 + self.df[w]))
                score += qv * tf[w] * idf
        return score

    def search(self, query: str, top_k: int = 3) -> list:
        q_tf = Counter(tokenize(query))
        scored = [(self._score(q_tf, tf), src, c)
                  for (src, c), tf in zip(self.chunks, self.vecs)]
        scored.sort(reverse=True)
        return [(src, c) for s, src, c in scored[:top_k] if s > 0]
```

问答部分（接在同一文件后面）：

```python
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["DEEPSEEK_API_KEY"],
    base_url=os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
)

def ask(question: str):
    hits = TfidfRetriever("docs").search(question, top_k=3)
    if not hits:
        return "知识库中没有相关内容，我无法回答。"
    context = "\n\n".join(f"【来源:{src}】{c}" for src, c in hits)
    print(f"检索到 {len(hits)} 个相关块：{[s for s, _ in hits]}")
    messages = [
        {"role": "system", "content":
         "你只能依据给定资料回答；资料里没有就明确说不知道，并标注来源。"},
        {"role": "user", "content": f"资料：\n{context}\n\n问题：{question}"},
    ]
    resp = client.chat.completions.create(model="deepseek-chat", messages=messages)
    return resp.choices[0].message.content

if __name__ == "__main__":
    print(ask("金卡会员买东西多少钱运费？退货几天内可以退？"))
```

**运行方式**：

```bash
python demo3_rag.py
```

**预期输出示例**：

```text
检索到 3 个相关块：['会员权益.md', '退货政策.md', '会员权益.md']
根据资料【来源:会员权益.md】，金卡会员享受免运费权益。退货方面【来源:退货政策.md】支持 7 天无理由退货（定制商品除外）……
```

**为什么 RAG 能缓解幻觉？** 三个机制：第一，回答依据从"模型的参数记忆"换成"上下文中白纸黑字的资料"，模型更倾向复述资料；第二，system prompt 明确约束"资料里没有就说不知道"，抑制了 RLHF 带来的讨好式编造（篇01 1.2 节）；第三，标注来源让答案可核查——这正是贯穿项目 DataAgent"每个数字都要有证据链"的最小实践。如果未来有 Embedding API 可用，把 `_score` 换成向量余弦相似度即可，检索语义会更准（比如"退钱"也能命中"退款"）。

**常见报错对照表**：

| 报错 | 含义 | 解法 |
|---|---|---|
| `FileNotFoundError: docs` | 文档目录不存在 | 确认在脚本同级目录建了 `docs/` 且里面有 `.md` 文件 |
| 检索结果为空 | 分词不匹配 | 检查查询词与文档用词；中文字面完全不同时 TF-IDF 确实无能为力（上 Embedding 可解） |
| 模型无视资料自由发挥 | system prompt 约束不够 | 加强约束措辞；把 `temperature` 调低到 0~0.3 |
| context 超长 | 文档太大、top_k 太高 | 减小块大小或 top_k；正式方案见篇06 Token 预算 |

---

## 6. 常见误区（新手六连坑）

1. **把 API key 写进代码并提交 git**。后果是密钥泄露被人盗刷。正确做法：环境变量或 `.env` 文件（`.env` 要加进 `.gitignore`），代码里只 `os.environ[...]`。已经提交过的密钥立即去服务商后台作废重发。
2. **以为模型记得上次对话**。模型是无状态的，每次请求都是"第一次见面"。"记得"是因为你把历史 messages 全发过去了。换进程、换机器，记忆就没了——除非你持久化。
3. **以为上下文无限长**。每个模型都有上下文上限（如 64K/128K Token）。长对话不裁剪迟早报 `context_length_exceeded`，而且上下文越长越贵越慢——这是篇06 存在的理由。
4. **让模型口算精确数字**。模型对数字的"计算"是概率续写，多位数加减乘除必错。精确计算永远写成工具（如 Demo 2 的 `calculator`）交给代码执行。
5. **把模型的输出当事实直接落库/展示**。工具参数可能幻觉、JSON 可能不合法、数字可能编造。所有模型输出都要经过校验（Schema、类型、范围）才可用——这是篇09 评测与质量契约的出发点。
6. **一上来就套重型框架**。不手写一遍 Demo 2 的循环，直接用 LangChain 出问题时完全不知道框架替你做了什么。先手写最小循环，再看框架，你会读出完全不同的东西。

---

## 7. 本篇实战：六个递进小任务（每步都有验收标准）

按顺序做，每完成一步就达到了下一步的起点。全部完成后，自测清单（第 8 节）应该能全部打勾。

**任务 1：给 Demo 2 加第三个工具**

- **目标**：独立走完"写函数 → 写 Schema → 注册 → 验证"的工具开发全流程。
- **操作**：新增 `query_products(category)` 按品类查商品表；为它写一段工具 Schema（`description` 写清楚"何时用、传什么"）；加进 `TOOLS` 字典；运行 `run("数码品类有哪些商品？")`。
- **验收标准**：运行日志中出现 `模型请求工具: query_products(...)` 且最终回答列出了商品名；故意传一个数据库里没有的品类，模型能据"无匹配"如实回答而非编造。

**任务 2：错误回填实验**

- **目标**：亲手验证"错误信息也是上下文"，理解 Harness 为什么要把异常兜住喂回模型（篇05 的伏笔）。
- **操作**：把 `query_orders` 里的 SQL 表名故意写错（如 `order`），运行观察模型收到"工具执行失败"后的反应；再把 `try/except` 删掉运行一次，对比程序直接崩溃的差异。
- **验收标准**：能说出两种处理方式的差别——有兜底时对话继续（模型通常会道歉并换路子），无兜底时进程死亡；把报错那一步的 messages 内容看一遍。

**任务 3：Demo 3 分块大小对比实验**

- **目标**：获得"分块大小影响检索质量"的第一手体感，为篇06 的上下文治理打底。
- **操作**：把 `chunk_text` 的 `size` 分别设为 30 / 80 / 200，用同一个问题（如"退货和运费政策"）各跑 3 次，记录每次命中的来源文件与回答质量。
- **验收标准**：写出 5 行结论，必须包含：块太小会怎样（语义被切碎）、块太大会怎样（噪声淹没信号+费 Token）、你选哪个值及理由。

**任务 4：Demo 1 多轮记忆实验**

- **目标**：亲手制造一次"上下文丢失"，理解篇06 为什么存在。
- **操作**：连聊 10 轮后问"我们第一轮聊了什么"；然后在代码里只保留最近 4 轮 messages 再问一次。
- **验收标准**：观察到两次回答的差异，并能用"上下文即状态"一句话解释原因。

**任务 5：SQL 进阶——把新查询包装成工具**

- **目标**：打通"SQL → Python 函数 → Agent 工具"的完整链路，这正是 DataAgent 工具开发的日常。
- **操作**：写出查询"每个品类已完成订单的客单价（SUM(amount)/SUM(quantity)）"；先在 `sqlite3` 里直接验证结果正确；再包装成 Demo 2 的新工具。
- **验收标准**：向 Agent 提问"各品类客单价多少"，回答中的数字与你手工计算的一致。

**任务 6：安全练习——消灭 `eval`**

- **目标**：体会"工具也要做输入校验"，这是篇07 工具治理的最小实践。
- **操作**：把 `calculator` 从 `eval` 改成用 `ast.parse` 白名单解析（只允许数字与 `+ - * / ()`）；先让 AI 帮你写一版，再按下面的评审清单逐条检查。
- **验收标准**：`calculator("__import__('os').system('ls')")` 返回拒绝信息而不是真的执行；正常表达式 `399*2+89` 结果正确。

### AI Coding 实操模式：让 AI 当你的"本篇陪练"

本篇你是初学者，AI 的角色是**陪练而非代写**——它帮你解释概念、排查报错，但代码必须你亲手敲（或至少亲手运行）。以下模板与清单在后面各篇会反复用到，这里是第一次登场。

**① 可复制提示词模板**

报错求助（最常用）：

```text
我在学 Python/LLM 入门，运行下面代码时报错。请：(1) 用新手能懂的话解释错误原因；
(2) 指出我概念上的误解（如果有）；(3) 给出修复后的代码并逐行注释；
(4) 给一个让我自查理解的小练习。不要直接给我一大段新功能代码。

【代码】
<粘贴你的代码>

【完整报错】
<粘贴从 Traceback 到最后一行的全部内容>
```

概念追问：

```text
请用"为什么 → 是什么 → 一个生活类比 → 一个最小代码例子"的顺序，
给我解释【概念名，如：虚拟环境】，假设我完全零基础。
最后指出新手对这个概念最常见的 2 个误解。
```

**② AI 初版人工评审清单**

AI 帮你写的代码（如任务 6 的 `ast` 版 calculator），提交前逐条过：

- [ ] 每一行我都能说出它在干什么（说不出的行就是没学会，去追问）
- [ ] 它没有引入教程之外的新第三方库（初学阶段控制变量）
- [ ] 边界输入我亲手测过：空字符串、超长输入、恶意字符串
- [ ] 报错信息我读得懂，而不是被 AI 包成了 `except: pass` 式的静默吞错
- [ ] 密钥、路径等敏感信息没有被硬编码进去

**③ 验收标准**

- 六个任务全部通过各自的验收标准；
- 第 8 节自测清单 10 项全部打勾；
- 你能向另一个人（或对 AI）讲清楚 Function Calling 循环的每一步——讲得出来，才算会了。

---

## 8. 自测清单（进入篇01 的门槛）

全部打勾后，你就可以开始篇01 了：

- [ ] 1. `python3 --version` 输出 3.11+，且能在项目目录激活虚拟环境
- [ ] 2. 激活虚拟环境后 `python -c "import openai, httpx"` 不报错
- [ ] 3. 能用环境变量（而非硬编码）向 OpenAI 兼容接口发一次请求并拿到回复
- [ ] 4. 能解释 messages 数组里 `system/user/assistant/tool` 四种 role 各是什么
- [ ] 5. 能说明白"模型为什么能记住多轮对话"（提示：它其实记不住）
- [ ] 6. 跑通 Demo 2，看过模型请求工具 → 执行 → 回填 → 再生成 的完整日志
- [ ] 7. 能给 Demo 2 独立添加一个新工具并跑通
- [ ] 8. 会用 SQLite 写出带 WHERE/JOIN/GROUP BY 的查询，并用 `?` 参数化
- [ ] 9. 跑通 Demo 3，能向他人解释"检索增强为什么能缓解幻觉"
- [ ] 10. 能说出至少 4 条本篇第 6 节的常见误区及正确做法

---

## 参考与脚注

[^course]: 极客时间专栏《企业级 Agent 工程化》——本教程「篇00–篇10」这条线的重构蓝本，贯穿项目 DataAgent 的里程碑划分与治理机制均源自该课程的方法论体系。

---

➡️ 下一页：篇01 · AI 核心认知。你会发现篇01 开头讲的"工具调用是训练出来的格式""ReAct 是外置的循环"，都是你已经在 Demo 2 里亲手写过的东西——认知篇会给你这些手感背后的"为什么"
