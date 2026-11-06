/* ================================================================
   星邮匣 · 业务类型与记录 schema

   ▍这是什么
   事件的"人看/机器判定"字段、投递记录、免打扰偏好、操作台账，以及它们落库时的
   zod schema。类型给 TypeScript，schema 给 `ctx.storageDomain` 在打开域时校验。

   ▍为什么要两套（类型 + schema）
   domain 在 open 时会把每条存量记录过一遍 schema；只写类型等于把校验交给未来调用方，
   一条手改坏的文件就能让整个域打不开。schema 是那道门。
   —— 像小区门禁：门牌（类型）告诉你去哪户，门禁（schema）保证进门的人不是伪造的。

   ▍修改铁律
   1. 【不】删已有字段、不改字段语义；历史记录读不出来时整个域 open 会失败。
      要淘汰就保留字段并标 deprecated，等迁移脚本清完再删。
   2. 【不】把事件正文塞进投递记录或偏好（重复真相会打架）。
   3. 渠道取值域只增不减；新增渠道必须同时有 status 里的可用性说明，不许"能选不能用"。
   ================================================================ */
import { z } from 'zod'

/** 事件类别：决定默认重要程度与界面提示形态。 */
export type PostboxKind =
  | 'work-completed'
  | 'work-failed'
  | 'work-blocked'
  | 'work-waiting-approval'
  | 'reminder'
  | 'info'

/** 全部事件类别；用于校验与列表筛选。 */
export const POSTBOX_KINDS: readonly PostboxKind[] = [
  'work-completed', 'work-failed', 'work-blocked', 'work-waiting-approval', 'reminder', 'info',
]

/** 重要程度：界面据此决定是否打断。 */
export type PostboxSeverity = 'normal' | 'important' | 'urgent'

/** 全部重要程度取值。 */
export const POSTBOX_SEVERITIES: readonly PostboxSeverity[] = ['normal', 'important', 'urgent']

/**
 * 投递渠道。
 *
 * `native` = **设备/宿主呈现渠道**（不特指 Android）：Android 系统通知、Web Notification、
 *   前台浮卡提示都算，谁真正把这条呈现给用户就回写谁。⚠️ 回执语义是"呈现层已接受"，
 *   不是"用户已读"——已读走独立的 read 方法，两条事实不许合并。
 * `feishu` = 外部适配（可配可不配）。
 * `wechat` = 明确不可用（不造假接口）。
 */
export type DeliveryChannel = 'native' | 'feishu' | 'wechat'

/** 全部渠道取值。 */
export const DELIVERY_CHANNELS: readonly DeliveryChannel[] = ['native', 'feishu', 'wechat']

/** 一次投递的状态。 */
export type DeliveryStatus =
  /** 已排队；尚未尝试。 */
  | 'pending'
  /** 已交给渠道但未拿到确认（例如已入系统通知队列）。 */
  | 'sent'
  /** 渠道确认送达（Android 弹出成功后回写 / 飞书接口返回 ok）。 */
  | 'delivered'
  /** 明确失败，带原因。 */
  | 'failed'
  /** 免打扰或被偏好关闭，主动抑制；不是失败。 */
  | 'suppressed'

/** 一条投递记录。 */
export interface DeliveryRecord {
  readonly eventId: string
  readonly channel: DeliveryChannel
  readonly status: DeliveryStatus
  /** 尝试次数；只在真正调用渠道时 +1，抑制不算尝试。 */
  readonly attempts: number
  readonly updatedAt: number
  /** 失败原因/抑制原因；只在 failed/suppressed 时出现。 */
  readonly detail?: string | undefined
  /** 渠道侧稳定消息标识（有则记，不伪造）。 */
  readonly externalId?: string | undefined
}

/** 一条星邮匣事件（持久记录）。 */
export interface PostboxEvent {
  readonly id: string
  /** 单调递增序号：客户端按它拉增量，比时间戳可靠。 */
  readonly seq: number
  readonly kind: PostboxKind
  readonly severity: PostboxSeverity
  readonly title: string
  readonly body?: string | undefined
  /** 关联工作；提醒类可无。 */
  readonly workId?: string | undefined
  /** 关联 DSH 会话（字符串引用，不复制会话内容）。 */
  readonly sessionId?: string | undefined
  readonly createdAt: number
  readonly updatedAt: number
  readonly read: boolean
  readonly archived: boolean
  /** 到期时间（提醒）；过期后不再主动弹出，但记录仍在。 */
  readonly dueAt?: number | undefined
  /** 事件有效期；过期后列表可隐藏但仍可查。 */
  readonly expiresAt?: number | undefined
  /** 产生来源的稳定码（`work` / `schedule` / `user` …），不比较中文。 */
  readonly origin: string
  /** 创建时的去重键；同键只产生一条事件。 */
  readonly dedupeKey: string
}

/** 免打扰时间窗；跨越午夜时 startMinute > endMinute 合法。 */
export interface DndWindow {
  readonly enabled: boolean
  /** 一天内起始分钟（0..1439），含。 */
  readonly startMinute: number
  /** 一天内结束分钟（0..1439），不含。 */
  readonly endMinute: number
  /** IANA 时区名；窗口按此时区解释，不是服务器本地时区。 */
  readonly timezone: string
  /** 临时免打扰用绝对结束时间，不把“一小时”误存成每天循环。 */
  readonly until?: number | undefined
  /** 老版本默认让紧急件穿透；明确临时免打扰可关闭穿透。 */
  readonly allowUrgent?: boolean | undefined
}

/** 渠道偏好。 */
export interface PostboxPreferences {
  readonly dnd: DndWindow
  /** 只控制主动打扰，信件本身仍入星邮匣；旧偏好缺省时全部开启。 */
  readonly events?: { readonly completed: boolean; readonly attention: boolean; readonly failed: boolean } | undefined
  readonly channels: {
    /** 设备/宿主呈现渠道（Android 通知 / Web Notification / 前台浮卡）。 */
    readonly native: boolean
    /** 飞书外部适配。 */
    readonly feishu: boolean
  }
  readonly feishu: {
    /** 是否真正启用（与 channels.feishu 同时为真才算）。 */
    readonly enabled: boolean
    /** 目标（群或用户标识），由配置给定，不由模型传。 */
    readonly target?: string | undefined
  }
  readonly native: {
    /** 两次系统通知的最小间隔，避免刷屏；0 = 不限。 */
    readonly minIntervalMs: number
    /**
     * 通知最大新鲜度（毫秒）：超过这个岁数的事件不再主动弹。
     *
     * 为什么要有：用户可能整晚关掉通知（或权限被系统撤销），第二天打开时
     * 不该被十几条陈年旧信淹没。旧件仍在 list 里可查，只是不再"打断"。
     * 0 = 不限（明确想要全量补发的场景）。
     */
    readonly maxAgeMs: number
  }
}

/** 偏好 + 水位一起放在域全局槽：两者总是一起读、一起写。 */
export interface PostboxGlobal {
  /** 已分配的最大事件序号。 */
  readonly seq: number
  readonly preferences: PostboxPreferences
}

/** 操作台账记录：同一 operationId 重放返回首次结果，不重复写。 */
export interface OperationRecord {
  readonly operationId: string
  /** 稳定动作码，例如 `publish` / `read` / `archive` / `delivery-receipt`。 */
  readonly action: string
  /** 首次执行结果的 JSON 载荷（不含密钥）。 */
  readonly result: string
  readonly at: number
}

/** 默认偏好：免打扰关、渠道关（未配置不得假装已开）。 */
export const DEFAULT_PREFERENCES: PostboxPreferences = {
  dnd: { enabled: false, startMinute: 22 * 60, endMinute: 7 * 60, timezone: 'Asia/Shanghai' },
  channels: { native: true, feishu: false },
  feishu: { enabled: false },
  native: { minIntervalMs: 0, maxAgeMs: 24 * 60 * 60 * 1000 },
}

/** 默认全局水位。 */
export const DEFAULT_GLOBAL: PostboxGlobal = { seq: 0, preferences: DEFAULT_PREFERENCES }

/* ---------- zod 记录 schema（落库校验的唯一门） ---------- */
const severitySchema = z.enum(['normal', 'important', 'urgent'])
const kindSchema = z.enum([
  'work-completed', 'work-failed', 'work-blocked', 'work-waiting-approval', 'reminder', 'info',
])
const channelSchema = z.enum(['native', 'feishu', 'wechat'])
const statusSchema = z.enum(['pending', 'sent', 'delivered', 'failed', 'suppressed'])

/** 事件记录 schema。 */
export const eventSchema = z.object({
  id: z.string().min(1),
  seq: z.number().int().nonnegative(),
  kind: kindSchema,
  severity: severitySchema,
  title: z.string().min(1),
  body: z.string().optional(),
  workId: z.string().optional(),
  sessionId: z.string().optional(),
  createdAt: z.number().nonnegative(),
  updatedAt: z.number().nonnegative(),
  read: z.boolean(),
  archived: z.boolean(),
  dueAt: z.number().nonnegative().optional(),
  expiresAt: z.number().nonnegative().optional(),
  origin: z.string().min(1),
  dedupeKey: z.string().min(1),
})

/** 投递记录 schema。 */
export const deliverySchema = z.object({
  eventId: z.string().min(1),
  channel: channelSchema,
  status: statusSchema,
  attempts: z.number().int().nonnegative(),
  updatedAt: z.number().nonnegative(),
  detail: z.string().optional(),
  externalId: z.string().optional(),
})

/** 操作台账 schema。 */
export const operationSchema = z.object({
  operationId: z.string().min(1),
  action: z.string().min(1),
  result: z.string(),
  at: z.number().nonnegative(),
})

/** 全局槽 schema（跨域共用一个水位与偏好）。 */
export const globalSchema = z.object({
  seq: z.number().int().nonnegative(),
  preferences: z.object({
    dnd: z.object({
      enabled: z.boolean(),
      startMinute: z.number().int().min(0).max(1439),
      endMinute: z.number().int().min(0).max(1439),
      timezone: z.string().min(1),
      until: z.number().finite().nonnegative().optional(),
      allowUrgent: z.boolean().optional(),
    }),
    events: z.object({ completed: z.boolean(), attention: z.boolean(), failed: z.boolean() }).optional(),
    channels: z.object({ native: z.boolean(), feishu: z.boolean() }),
    feishu: z.object({ enabled: z.boolean(), target: z.string().optional() }),
    native: z.object({
      minIntervalMs: z.number().int().nonnegative(),
      // ⚠️【勿删 default】旧版本写入的全局槽没有这个字段；不加 default 会让**整个域打不开**
      //    （domain open 会用 schema 校验存量记录，缺字段 = invalid-record）。
      //    默认 24h：关掉通知一整晚后不该被陈年旧信淹没。
      maxAgeMs: z.number().int().nonnegative().default(24 * 60 * 60 * 1000),
    }),
  }),
})

/** 投递记录在表里的键（同一事件同一渠道只允许一条）。 */
export function deliveryKey(eventId: string, channel: DeliveryChannel): string {
  return `${eventId}::${channel}`
}

/**
 * 面向前端/Android 的事件视图：域里的事件本体 + 它的投递条。
 *
 * 为什么另立一个形状而不是往持久事件里塞 deliveries：
 * 投递记录在另一张表、且会随每次回执变化；把它内联进事件会导致"改一条投递 =
 * 重写整条事件"，也让历史事件的形状随渠道增减而变。视图是**读时投影**，不是第二份真相。
 */
export interface PostboxEventView extends PostboxEvent {
  /** 该事件各渠道的投递记录（按渠道名排序，已建条的全在这里）。 */
  readonly deliveries: readonly DeliveryRecord[]
}

/* ================================================================
   Remote 边界类型（wire 契约）

   ▍为什么这些类型必须住在这里，而不是 remote.ts
   Typert 生成器要求：`@Remote` 方法的参数与返回类型必须能从**非根的子路径**导出
   （本包是 `./types`）。写在 remote.ts 里等于"只从包根可见"，生成器会直接拒绝生成
   `./remote` 产物 —— 表现就是 Client 侧 `ctx.remote.dotPostbox.*` 全空。
   ⚠️【不】把这些接口挪回 remote.ts，也不要在包根再导出一份（两条路径会漂移）。

   ▍命名约定
   `DotPostbox<动作>Request` / `DotPostbox<动作>Value`：一个 Remote 方法一对，方法名一动
   这两个名字就跟着动，避免"接口改名了类型还叫旧名"。
   ================================================================ */

/** list 请求。 */
export interface DotPostboxListRequest {
  readonly cursor?: string | undefined
  readonly limit?: number | undefined
  readonly unreadOnly?: boolean | undefined
  readonly kinds?: readonly PostboxKind[] | undefined
  readonly includeArchived?: boolean | undefined
}

/** list 结果。 */
export interface DotPostboxListValue {
  readonly items: readonly PostboxEventView[]
  readonly nextCursor: string | null
  readonly serverTime: number
}

/** pending 请求（Android 前台服务轮询）。 */
export interface DotPostboxPendingRequest {
  readonly since?: string | undefined
  readonly limit?: number | undefined
}

/** pending 结果。 */
export interface DotPostboxPendingValue {
  readonly items: readonly PostboxEventView[]
  /** 只推进到本页实际扫过的最后一条事件（不是全局水位）。 */
  readonly cursor: string
  readonly serverTime: number
  readonly suppressed: number
}

/** get 请求。 */
export interface DotPostboxGetRequest {
  readonly id: string
}

/** 单条命令请求（已读/归档）。 */
export interface DotPostboxIdCommandRequest {
  readonly id: string
  readonly operationId: string
}

/** 回执请求（Android 弹完通知 / 飞书确认后回写）。 */
export interface DotPostboxReceiptRequest {
  readonly id: string
  readonly channel: DeliveryChannel
  readonly status: 'sent' | 'delivered' | 'failed' | 'suppressed'
  readonly operationId: string
  readonly detail?: string | undefined
}

/** 重试请求。 */
export interface DotPostboxRetryRequest {
  readonly id: string
  readonly channel: DeliveryChannel
  readonly operationId: string
}

/** 偏好写入请求。 */
export interface DotPostboxSetPreferencesRequest {
  readonly preferences: PostboxPreferences
  readonly rev?: number | undefined
  readonly operationId: string
}

/** 偏好读取结果。 */
export interface DotPostboxPreferencesValue {
  /** 旧宿主没有该标记，客户端不能把未生效的扩展字段报成保存成功。 */
  readonly personalReminders?: boolean | undefined
  readonly preferences: PostboxPreferences
  readonly rev: number
}

/** status 结果。 */
export interface DotPostboxStatusValue {
  readonly channels: {
    readonly native: { readonly available: boolean; readonly reason?: string | undefined }
    readonly feishu: { readonly configured: boolean; readonly reason?: string | undefined }
    readonly wechat: { readonly available: false; readonly reason: string }
  }
  readonly preferences: PostboxPreferences
  readonly seq: number
  readonly pendingDeliveries: number
  readonly events: number
}

/**
 * watch 帧。
 *
 * `ready` 是开流第一帧（协议层面没有开流确认帧，不推这一帧客户端就分不清
 * "订阅成功但暂无变化" 与 "流根本没起来"）。`seq` 是当前水位，客户端可据此拉首次快照。
 */
export type DotPostboxWatchFrame =
  | { readonly type: 'ready'; readonly seq: number; readonly eventIds: readonly string[] }
  | { readonly type: 'changed'; readonly seq: number; readonly eventIds: readonly string[] }
