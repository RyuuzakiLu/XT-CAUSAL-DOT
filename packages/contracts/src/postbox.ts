/* ================================================================
   DOT 星邮匣事件

   ▍这是什么
   需要让用户知道的一件事：做完了、该提醒了、失败了、等你确认。
   事件是"通知的业务事实"，投递记录是"我们尝试送达了几次、结果如何"。

   ▍为什么把事件和投递分开
   同一件事可能同时走前台浮卡、Android 系统通知、飞书；投递失败不代表事件不存在，
   也不能因为一次投递成功就把事件标成"已读"。事件与投递是两个生命周期。

   ▍修改铁律
   1. 【不】没有实际回执就写 delivered=true。
   2. 【不】用重连次数当投递次数；重连只该重放未读事件，不该重复弹同一条。
   3. 同一 eventId 只能对应一个业务事实，重试不得新建事件。
   ================================================================ */
import type { ArtifactId, PostboxEventId, WorkId } from './ids.ts'

/** 事件类别：决定默认重要程度与提示形态。 */
export type PostboxCategory = 'done' | 'reminder' | 'failure' | 'approval'

/** 事件的重要程度；界面据此决定是否打断。 */
export type PostboxSeverity = 'low' | 'normal' | 'high'

/** 投递渠道；`foreground` 是站内浮卡，其余是设备或外部渠道。 */
export type PostboxChannel = 'foreground' | 'device' | 'feishu' | 'wechat'

/** 一次投递的结果。 */
export type DeliveryState =
  /** 已排队，尚未尝试。 */
  | 'pending'
  /** 已交给渠道，但没有回执。 */
  | 'sent'
  /** 渠道确认送达。 */
  | 'delivered'
  /** 明确失败，带原因。 */
  | 'failed'
  /** 用户免打扰期间被抑制；不是失败。 */
  | 'suppressed'

/** 一条投递记录：渠道 + 结果 + 时间。 */
export interface DeliveryRecord {
  readonly channel: PostboxChannel
  readonly state: DeliveryState
  /** ISO-8601 最后尝试时间。 */
  readonly attemptedAt: string
  /** 失败原因；只在 state 为 failed 时出现。 */
  readonly error?: string
  /** 渠道侧的稳定消息 ID（有则记，便于对账；不伪造）。 */
  readonly externalId?: string
}

/** 星邮匣事件。 */
export interface PostboxEvent {
  readonly id: PostboxEventId
  readonly category: PostboxCategory
  readonly severity: PostboxSeverity
  /** 一句话标题，界面直接显示。 */
  readonly title: string
  /** 正文摘要；完整内容留在工作或成果里，不在这里复制。 */
  readonly body: string
  /** ISO-8601 事件产生时间。 */
  readonly createdAt: string
  /** 关联工作；提醒类事件可能没有工作。 */
  readonly workId?: WorkId
  /** 关联成果；完成类事件通常带一个。 */
  readonly artifactId?: ArtifactId
  /** 未读/已读由事件自身记录，不由投递状态推断。 */
  readonly read: boolean
  /** 归档后仍在记录里，只是默认列表不显示。 */
  readonly archived: boolean
  /** 各渠道的投递尝试；同一渠道可保留最后一次结果。 */
  readonly deliveries: readonly DeliveryRecord[]
}

/**
 * 一条事件是否该在“有新信件”提示里出现。
 * 为什么成函数：书房信件入口、精灵气泡、系统通知都要同一条判定，
 * 否则会出现"信已读但气泡还在"这类自相矛盾的显示。
 * @param event - 事件
 * @returns 未读且未归档时为 true
 */
export function isUnreadLetter(event: PostboxEvent): boolean {
  return !event.read && !event.archived
}

/** 免打扰与渠道偏好（设备侧或用户设置持有）。 */
export interface PostboxPreferences {
  readonly dnd: boolean
  /** 渠道开关；缺省表示该渠道未启用，不表示默认开启。 */
  readonly channels: Readonly<Partial<Record<PostboxChannel, boolean>>>
  /** 只在这些重要程度以上打断；缺省视为 normal。 */
  readonly minSeverity?: PostboxSeverity
}
