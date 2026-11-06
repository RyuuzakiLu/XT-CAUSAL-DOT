/* ================================================================
   星邮匣 · 纯规则层

   ▍这是什么
   不碰存储、不碰网络的判定函数：免打扰、过期、重要程度、投递初始化、seq 水位比较。
   放在这里是为了让"同一件事只有一个判定"——界面、Android、飞书适配器都调同一份。

   ▍为什么单独成文件而不是写在 service 里
   service 里每次写都会拉上存储与日志；把判定放进去，测试就得开一个真域。
   纯函数层可以单独把边界问题测穿（跨午夜窗口、时区、过期、同一毫秒多条）。
   —— 像路口红绿灯：灯本身很简单，但它是所有方向共用的那一盏。

   ▍修改铁律
   1. 【不】用服务器本地时区解释免打扰窗口；窗口带自己的 timezone 字段。
   2. 【不】在"过期"里顺手把事件删了；过期只影响"是否主动弹出/列表是否显示"。
   3. 判定必须能被同一输入重复得到同一结果（不读 Date.now()，时间由调用方传入）。
   ================================================================ */
import type {
  DeliveryChannel, DndWindow, PostboxEvent, PostboxKind, PostboxPreferences, PostboxSeverity,
} from './types.ts'

/** 事件类别的默认重要程度。 */
export function defaultSeverityOf(kind: PostboxKind): PostboxSeverity {
  switch (kind) {
    case 'work-failed':
      return 'urgent'
    case 'work-blocked':
    case 'work-waiting-approval':
      return 'important'
    case 'work-completed':
    case 'reminder':
    case 'info':
      return 'normal'
    default:
      return 'normal'
  }
}

/** 该类别是否需要用户介入（决定是否"值得打断"）。 */
export function needsAttention(kind: PostboxKind): boolean {
  return kind === 'work-failed' || kind === 'work-blocked' || kind === 'work-waiting-approval'
}

/**
 * 判断某一时刻是否落在免打扰窗口内。
 * 为什么不用 Date#getHours：窗口自带 IANA 时区，服务器可能跑在别的时区上。
 * @param dnd - 免打扰窗口
 * @param at - 毫秒时间戳
 * @returns 在窗口内为 true（窗口关闭时恒 false）
 */
export function inDndWindow(dnd: DndWindow, at: number): boolean {
  if (!dnd.enabled) return false
  /* 临时停到某一刻与每天的窗口分开，过期自动恢复，不靠前端常驻计时。 */
  if (dnd.until !== undefined) return at < dnd.until
  const minutes = minuteOfDay(dnd.timezone, at)
  if (minutes === undefined) return false
  if (dnd.startMinute === dnd.endMinute) return false
  // 跨午夜（如 22:00→07:00）时窗口是两段，不能只做一次大小比较。
  if (dnd.startMinute < dnd.endMinute) {
    return minutes >= dnd.startMinute && minutes < dnd.endMinute
  }
  return minutes >= dnd.startMinute || minutes < dnd.endMinute
}

/**
 * 取某时区下"当天第几分钟"。
 * 时区名非法时返回 undefined（调用方按"不在窗口内"处理，不抛——一条坏偏好
 * 不该让整条通知链崩掉）。
 * @param timezone - IANA 时区名
 * @param at - 毫秒时间戳
 * @returns 0..1439，或 undefined
 */
export function minuteOfDay(timezone: string, at: number): number | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(at))
    const hour = Number(parts.find(part => part.type === 'hour')?.value)
    const minute = Number(parts.find(part => part.type === 'minute')?.value)
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return undefined
    // Intl 可能给出 24 表示午夜，归一成 0。
    return (hour % 24) * 60 + minute
  } catch {
    return undefined
  }
}

/** 事件是否已过期（只影响主动弹出与默认列表，不影响是否可查）。 */
export function isExpired(event: PostboxEvent, at: number): boolean {
  if (event.expiresAt !== undefined && at >= event.expiresAt) return true
  if (event.dueAt !== undefined && at >= event.dueAt && event.kind === 'reminder') {
    // 提醒过了时间不再"提前提醒"，但事件本身留着让用户看到"错过了"。
    return true
  }
  return false
}

/**
 * 某渠道此刻应当投递还是抑制。
 * 抑制不是失败：免打扰/渠道关闭都记 suppressed，便于事后解释"为什么没弹"。
 * @param event - 事件
 * @param channel - 渠道
 * @param preferences - 当前偏好
 * @param at - 毫秒时间戳
 * @returns 抑制原因；可投递时返回 undefined
 */
export function suppressionOf(
  event: PostboxEvent,
  channel: DeliveryChannel,
  preferences: PostboxPreferences,
  at: number,
): string | undefined {
  if (event.archived) return 'archived'
  if (channel === 'native' && !preferences.channels.native) return 'channel-disabled'
  if (channel === 'feishu' && (!preferences.channels.feishu || !preferences.feishu.enabled)) {
    return 'channel-disabled'
  }
  if (channel === 'wechat') return 'channel-unavailable'
  const category = event.kind === 'work-completed' ? 'completed' : event.kind === 'work-failed' ? 'failed' : event.kind === 'work-blocked' || event.kind === 'work-waiting-approval' ? 'attention' : undefined
  if (category && preferences.events?.[category] === false) return 'event-disabled'
  /* ⚠️ 保留旧版紧急穿透，用户明确临时全静音时才关闭；信件不会被删除。 */
  if ((event.severity !== 'urgent' || preferences.dnd.allowUrgent === false) && inDndWindow(preferences.dnd, at)) return 'do-not-disturb'
  if (isExpired(event, at)) return 'expired'
  return undefined
}

/**
 * 计算"下一次可投递时间"的最小间隔是否已过（防刷屏）。
 * @param lastAt - 同一渠道上次成功投递时间；可空
 * @param minIntervalMs - 最小间隔
 * @param at - 当前时间
 * @returns 允许投递时为 true
 */
export function respectsMinInterval(lastAt: number | undefined, minIntervalMs: number, at: number): boolean {
  if (lastAt === undefined || minIntervalMs <= 0) return true
  return at - lastAt >= minIntervalMs
}

/**
 * 生成事件 id。
 * 为什么不用随机数：可读、可排序、能一眼看出是邮匣产生；同 input 可复现，便于测试。
 * @param seq - 该事件的序号（全局单调递增，天然唯一）
 * @returns `postbox-<seq>` 形态的稳定 id
 */
export function eventIdOf(seq: number): string {
  return `postbox-${String(seq).padStart(6, '0')}`
}

/** 一条事件是否在默认列表中可见（归档/过期不算失败，只是不默认显示）。 */
export function visibleInList(event: PostboxEvent, at: number, includeArchived: boolean): boolean {
  if (!includeArchived && event.archived) return false
  if (event.expiresAt !== undefined && at >= event.expiresAt) return false
  return true
}
