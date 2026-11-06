# @xtcausal/dot-memory · 记忆适配（独立 XTMEM）

> 此公开源码副本不包含开发测试。下文测试记录仅为原开发说明，当前构建与配置要求以根目录 README.md 为准。

> 一句话：**记忆是真的记在独立 XTMEM 库里、真的从那里被召回、真的进了模型提示词**——不是 KV 假引擎，也不碰生产库。

## 职责

- 把**包内 vendored** 的 XTMEM 引擎（`vendor/xtmem`，MIT）接成 Host 服务 `dotMemory`。
- 提供四个模型工具与八个 Remote 方法，端口形状见下。
- 在 `system-prompt/assemble` 里注入"本轮相关记忆"（≤N 条，带 `[m:<id>]` 引用标记）。

## 提供 / 消费

| 项 | 值 |
|---|---|
| Cordis 服务键 | `dotMemory`（业务）；`dotMemoryRemote`（Remote owner，**两者必须不同**） |
| Remote namespace | `dotMemory` |
| Cordis 硬依赖 | `tools`、`systemPrompt`、`typert` |
| 持久数据 | 独立 XTMEM SQLite 库（`dbPath` 配置，**必填**）+ WAL（`workspaceDir/.hermes/memory/wal`） |
| 模型工具 | `dot_memory_search` / `dot_memory_store` / `dot_memory_correct` / `dot_memory_forget` |
| 提示词段落 | `dot-memory:context`（本轮相关记忆）、`dot-memory:usage`（使用规则） |

## 身份 / 域 / 库路径：硬边界

**请求对象里没有** `namespace` / `cross` / `dbPath` / `actor`。这三个值只来自插件配置：

```yaml
- name: '@xtcausal/dot-memory'
  config:
    dbPath: 'F:/dot/memory/dot.db'      # 必填，无默认（防空库回落到生产库）
    workspaceDir: 'F:/dot/memory'        # 必填
    actor: 'astra'                       # 必填（引擎的 actor）
    namespace: 'astra'                   # 必填（引擎的 namespace）
    python: 'python'                     # 解释器；推荐配成 DOT_PYTHON 或 py / python3
    engineRoot: ''                        # 留空 = 用包内 vendor
    cliPath: ''                           # 留空 = 用包内 vendor
    timeoutMs: 120000
    contextTop: 5                         # 每轮注入条数；0 = 关闭注入（工具仍可用）
    contextMaxChars: 400
    injectUsageRules: true
```

测试里有一条断言专门守着"工具参数不得出现这些字段"，防止有人顺手加回去。

## 安装 Python 依赖（新机器必做一次）

引擎是 vendored 的 Python 程序（`vendor/xtmem/`），Node 侧装不出它的依赖。
新机器上**必须先装一次**，否则第一次调用会 `ImportError`：

```sh
# Windows（`py` 是 Python 启动器，会选已安装的默认版本）
py -m pip install -r node_modules/@xtcausal/dot-memory/requirements.txt

# macOS / Linux
python3 -m pip install -r node_modules/@xtcausal/dot-memory/requirements.txt

# 在仓库内开发时直接用包路径
py -m pip install -r packages/memory/requirements.txt
```

依赖清单见 [`requirements.txt`](requirements.txt)：fastapi / uvicorn / httpx（HTTP 端点）、
psutil（进程观测）、jieba / jionlp / numpy（中文分词与召回）、PyYAML（配置解析）。
**向量检索是可选增强**：引擎在没有向量后端时会退化为关键词与结构匹配，不影响
存/取/纠正/删除；需要时自行装对应的 embedding 依赖，本包不代管。

解释器路径**不要写死**：配 `python: !!js process.env.DOT_PYTHON ?? (process.platform === 'win32' ? 'py' : 'python3')`，
或在本机启动脚本里设 `DOT_PYTHON`。写死绝对路径会让发布包只能在一台机器上跑。

## Remote 接口（`./types` 子路径导出，供 Typert 生成）

| 方法 | 入参 | 返回 |
|---|---|---|
| `search` | `{query, top?, project?}` | `{ok, query, count, hits: MemoryHit[], mode, verdict?}` |
| `store` | `{text, operationId, project?, importance?, tags?}` | `{ok, id?, action: created\|idempotent\|skipped\|rejected, namespace, reason?}` |
| `correct` | `{id, text, operationId, reason?}` | `{ok, id, supersededId, action:'corrected'}` |
| `forget` | `{id, operationId, confirmed?}` | 未确认：`{ok, confirmed:false, removed:0, pending, preview[]}`；确认：`{ok, confirmed:true, removed, tombstoneRegistered}` |
| `get` | `{id}` | `{ok, hit?}` |
| `list` | `{query?, limit?, project?}` | `{ok, count, hits}` |
| `status` | `{}` | `{available, engine:'xtmem', actor, namespace, dbIsolated:true, reason?, engineVersion?}` |
| `watch`（stream） | 无 | 第一帧 `{type:'ready'}`，之后 `{type:'changed', action, ids}[]` |

失败码：`memory/engine-unavailable` / `memory/engine-failed` / `memory/engine-timeout` / `memory/rejected`（+ `gateway/*`）。

## 有效域（effectiveNamespace）：读写纠正删除查询必须同一个域

XTMEM 有硬规则：**本端只能写自己 actor 名下那个域**，唯一例外是 `knowledge` + `visibility=shared`。

于是只有两种做法都不会出错，其余都会出事：

| 做法 | 后果 |
|---|---|
| 只按 `namespace` 写 | `actor≠namespace` 时引擎拒写，**整条记忆链静默失效**（活 Host 实测撞到） |
| 写收敛到 `actor`、读用 `namespace` | **存得进、搜不到**——比拒写更坏，因为它不报错 |

所以本适配器只认**一个有效域**，贯穿 `search / store / get / list / correct / forget / status`：

```
namespace === actor          → 用配置值（推荐装配：actor=namespace='dot-personal'）
namespace === 'knowledge'    → 用它（引擎唯一允许跨身份写的共享知识域）
其他组合                     → 取 actor
```

`status()` 回报的是这个**有效域**而不是配置原值；界面显示域 ≡ 实际读写域，不会出现"配置说 A、实际 B"。

**推荐配置**：`actor` 与 `namespace` 配成同一个名字，零收敛、零歧义。
`tests/engine-integration.test.mjs` 有一条端到端守着：`store → search 必须命中同一 id → status.namespace 一致
→ correct 后新条可搜、旧条退役 → forget 后搜不到`。

## 纠正与删除：只用引擎真能力

引擎（公开源码核实）**没有 update 接口**。所以：

- **纠正** = 引擎 `ContextBuilder.store()` 落新条 + 引擎 `VectorStore.mark_superseded()` 把旧条退役，
  `superseded_by` 写**真指针**（`mem-xxxxxxxx`）。历史与可追溯性由引擎自己的 D1-1 契约保证。
  实现见 `scripts/xtmem_correct.py`（一次性子进程，stdin/stdout JSON）。
- **删除** = 引擎 `forget --confirm`：写遗忘存根 → purg WAL → 归档。未确认只预览，零副作用。
- 纠正时若新内容与库里既有条目重复，引擎不建新条 ⇒ 我们如实报 `memory/rejected`，不伪造 id。

## 上下文注入：为什么"按轮冻结 + 按会话分键"

system prompt 在请求最前，前缀缓存逐字节比对。同一轮内若记忆段内容变化，整轮上下文缓存全废
（实测参考：注入文本变 = 命中率掉到 0.4 量级）。所以：

- **一轮只算一次**，同轮所有 step 复用同一段文本，换轮才重算；
- 缓存按 `sessionId` 分键（主会话与子代理线程可能同时装配，共用一个变量会串味）；
- 会话身份取自官方 `AssembleContext.agent`（`@deepseek-ai/dsh-agent` 的类型合并，`assembleContextFor()` 一定带），**不写 cast**；
- 注入失败只降级（不打这段），绝不阻断对话。

## watch 流：为什么第一帧是 `ready`

官方流协议**没有开流确认帧**，`item` 是唯一信号。订阅后若暂无变化，客户端收不到任何字节，
只能靠超时判断"流是不是没起来"（实测：8s 零字节，看起来像故障）。

所以两个 watch 流都**先推一帧 `ready`**（postbox 带当前 `seq`，客户端据此拉首次快照）。

⚠️ 另一条顺序铁律：**先 `subscribe`、再 `yield ready`**。async generator 在两次 `next()`
之间是挂起的；先发 ready 再订阅，调用方拿到 ready 之后、再调 `next()` 之前发生的业务变化
会被**永久丢掉**（postbox 侧实测把测试卡死 120s）。`tests/watch-frame.test.mjs` 守着这条。

## 构建

```bash
pnpm -F @xtcausal/dot-memory build   # = tsc -p tsconfig.json && tsdown
```

⚠️ 必须先 `tsc` 再 `tsdown`：`@Remote(...)` 是 TC39 标准装饰器，rolldown 直接吃 `.ts` 会保留语法，
产物一 import 就 `SyntaxError`（构建却是"成功"）。`tsconfig` 里 `composite`/`incremental` 关掉，
否则增量编译只产出改动文件，tsdown 报 `UNRESOLVED_ENTRY`。

## 自测（真跑，非 mock）

```bash
# 1. 真引擎（隔离库，~68s）：存/召回/幂等/纠正/删/降级
node --experimental-transform-types --test packages/memory/tests/engine-integration.test.mjs

# 2. 真提示词消费（替身引擎，~0.3s）：注入时机/冻结/分键/失败降级
node --experimental-transform-types --test packages/memory/tests/context.test.mjs

# 3. 插件真装配（~0.3s）：工具注册/卸载清理/缺配置失败/无提权参数/Remote 标记
node --test packages/memory/tests/plugin.test.mjs

# 4. 端到端（真引擎 → 真 assemble，~30s）：库里写的句子真的出现在最终提示词里
node --test packages/memory/tests/e2e-consumption.test.mjs
```

## 自动记忆：默认关闭，只有显式工具/接口才落库（F09）

**当前口径**：不会自动把对话、附件正文、临时素材写进记忆库。

- 只有三种入口能产生记忆：模型调 `dot_memory_store`、界面调 `Remote store`、`correct` 产生的新版本。
- 附件/上传文件**不默认入库**：它们属于会话资产，要不要记住由用户显式发起。
- 因此不存在"临时素材悄悄常驻"，也没有后台蒸馏管线在跑。

如果以后要加"自动记忆"，必须同时给：显式开关、可查看的自动写入清单、以及"自动条目"与"人工条目"的区分，
不能靠一个隐藏开关把整段对话灌进库里。

## 已知限制

- **无向量服务时是 FTS/BM25 降级**：引擎自动回退，`mode` 如实回报（`raw-fallback` 等），不假装语义命中。
- **每次调用新起 Python 子进程**（~0.6s jieba 词典加载）。这是刻意的隔离选择，不是缺陷；
  若将来要常驻，需要引擎提供多调用契约，不能靠"复用进程"硬撑。
- `search` 的命中**不含时间字段**（引擎 recall 返回体本来就没有）；要时间走 `get`/`list`。
- 引擎版本以 vendored 副本为准（`xtmem 1.1.0.dev0`）；升级走"重新复制 + 跑集成测试"。
- 相关记忆注入依赖 `session/event` 的 `turn/start` 与 `user/message`；拿不到轮号时不注入（正确降级）。
