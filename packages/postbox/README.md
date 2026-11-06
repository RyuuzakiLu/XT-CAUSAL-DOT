# @xtcausal/dot-postbox · 星邮匣（Host 事实所有者）

> 此公开源码副本不包含开发测试。下文测试记录仅为原开发说明，当前构建与配置要求以根目录 README.md 为准。

> 一句话：**"要告诉用户的一件事"只有一份记录**；前台浮卡、Android 系统通知、飞书都只是它的投递渠道，不各存一份通知状态。

## 职责

- 事件（`PostboxEvent`）：完成 / 提醒 / 失败·阻塞 / 待确认，带重要程度、时间、`workId` 关联、未读/归档、投递记录。
- 投递（`DeliveryRecord`）：每个 `(事件, 渠道)` 一条，`pending → sent → delivered | failed | suppressed`。
- 偏好：免打扰窗口（带 IANA 时区）、渠道开关、原生通知最小间隔。
- 操作台账：所有写命令带 `operationId`，重放返回首次结果，**不重复写**。

## 提供 / 消费

| 项 | 值 |
|---|---|
| Cordis 服务键 | `dotPostbox`（`ctx.dotPostbox`） |
| Remote namespace | `dotPostbox` |
| Cordis 硬依赖 | `storageDomain`、`typert` |
| 持久数据 | 官方 storage-domain 域 `dot_postbox`（表 `events` / `deliveries` / `ops` + 全局 `seq/preferences`） |
| 模型工具 | 无（星邮匣不直接暴露给模型；由工作插件进程内调用 `publish`） |

## Remote 接口（Client / Android 共用）

调用方式按官方 Gateway：`POST /api/dotPostbox/<method>`，body 是
`{"type":"client-request","rpcId":"<uuid>","method":"dotPostbox/<method>","payload":{"args":{...}}}`，
响应 `{"type":"server-response","rpcId":"...","result":{"ok":true,"value":...}}`；失败为
`result.ok=false` + `error.code ∈ postbox/not-found | postbox/conflict | postbox/unavailable | postbox/invalid-request | gateway/*`。

| 方法 | 入参 | 返回 |
|---|---|---|
| `list` | `{cursor?, limit?, unreadOnly?, kinds?, includeArchived?}` | `{items: PostboxEventView[], nextCursor: string\|null, serverTime}` |
| `pending` | `{since?, limit?}` | `{items: PostboxEventView[], cursor, serverTime, suppressed}` |
| `get` | `{id}` | `PostboxEventView` |
| `read` | `{id, operationId}` | `PostboxEventView` |
| `archive` | `{id, operationId}` | `PostboxEventView` |
| `preferences` | `{}` | `{preferences, rev}` |
| `setPreferences` | `{preferences, rev?, operationId}` | `{preferences, rev}` |
| `deliveryReceipt` | `{id, channel, status, operationId, detail?}` | `DeliveryRecord` |
| `retryDelivery` | `{id, channel, operationId}` | `DeliveryRecord` |
| `status` | `{}` | 渠道可用性 + 水位 + 计数 |
| `watch`（stream） | 无 | 第一帧 `{type:'ready', seq, eventIds:[]}`，之后 `{type:'changed', seq, eventIds}[]` |

`PostboxEventView` = 事件本体 + `deliveries: DeliveryRecord[]`（读时投影，不落库第二份）。

## 谁判定规则（血泪点）

- **免打扰 / 渠道关闭 / 过期 / 最小间隔 / 已读归档全在服务端判定**（`pending` 内）。
- Android 前台 `dataSync` 服务只做三件事：拉 `pending` → 弹系统通知 → 回 `deliveryReceipt`。
  **原生壳不自己再判一遍**，否则会出现"服务端说该弹、壳子说太吵"的互相打架。
- `deliveryReceipt(delivered)` 的语义边界：**只证明呈现层接受了这条通知**；
  不证明用户读过，也不保证锁屏一定展示（省电/勿扰/渠道设置都可能吞掉）。文案不得写成"已送达用户"。
- **`native` 是设备/宿主呈现渠道，不特指 Android**：Android 系统通知、Web Notification、
  前台浮卡提示都归它。谁真正把这条呈现给用户，谁就回写 `deliveryReceipt(native, delivered)`；
  同 `(事件, native)` 只有一条记录 ⇒ 前台已提示过的不会因重连再弹。
  已读（`read`）是另一条独立事实，绝不由 delivered 推导。

## watch 流：为什么第一帧是 `ready`

官方流协议没有开流确认帧（`item` 是唯一信号）。订阅后若暂无变化，客户端收不到任何字节，
无法区分"订阅成功但没变化"与"流没起来"。所以开流先推一帧 `ready`（带当前 `seq`），
客户端据它确认订阅生效并拉首次快照。

⚠️ 顺序铁律：**先 `subscribe`、再 `yield ready`**——async generator 在两次 `next()` 之间挂起，
先发 ready 再订阅会丢掉这期间的变化。`tests/watch-frame.test.mjs` 实测守着。

## 外部渠道

- **飞书**：只有配置了 `feishuWebhookUrl` 才可用，且只在 `retryDelivery` 时真发；
  HTTP 200 但 `code != 0` 记为 `failed`（只看状态码 = 假绿）。
- **微信**：本包不提供实现，`status` 固定 `available:false` 并给原因。不造假接口。

配置里不放密钥：`feishuWebhookUrl` 由装配侧从自己的凭据位置取来后注入，本包不读 secret 文件、不打印地址。

## 启停行为

- 卸载：关闭自持的 domain 句柄；**用户数据（事件/投递/偏好）一律保留**。
- 停用只撤 UI 或通知渠道时，后台事件与历史不受影响。

## 已知限制

- `watch` 流是进程内事件桥，跨进程/多实例不同步（官方 domain 的 `domain/changed` 也是进程内）。
- 事件量按单用户规模设计（线性扫 `events` 做去重键查找）；百万级需要加索引，当前不预造。
- 飞书真实投递尚未亲验（需要授权后的真实 webhook）。当前测试只用替身 transport。

## 自测

```bash
pnpm -F @xtcausal/dot-postbox build
node --experimental-transform-types --test packages/postbox/tests/service.test.mjs
```

测试起的是**真** Cordis + `storage-json` + `storage-domain`，落盘到系统临时目录，跑完即删。
