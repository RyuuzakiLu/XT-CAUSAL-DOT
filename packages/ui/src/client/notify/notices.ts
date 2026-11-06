/* ================================================================
   DOT 通知分发层 · 一条通知从哪来、走哪条路弹出
   ▍这是什么
   工作通知（做完了 / 等你确认 / 等你补充 / 没做成）和星邮匣的重要提醒，先统一成 DotNotice，
   再由 NoticeDispatcher 按路由规则交给「渠道」去弹。两个渠道：精灵气泡（sprite）和
   手机系统通知栏（native，见 createSystemNoticeChannel / createAndroidNoticeChannel）。
   ▍路由（用户 2026-10-24 定「等你定的事」第 2 项选 C）
   不在 DOT（页面在后台）时走系统通知栏，在 DOT 里才从精灵弹；回到 DOT 后精灵不再重复弹，
   同一件事只提醒一次（topic 去重）。系统通知没弹出来（没给权限、壳不支持）时，这条先记下，
   回到 DOT 再从精灵补弹一次（deferred）。
   ▍修改铁律
   1. 【不】在这里拉接口、改业务状态；这一层只做「转换 + 去重 + 分发」。
   2. 同一件事（同一项工作的同一种变化）不管从工作推送还是星邮匣来，只弹一次（topic 去重）。
   3. 通知不写进会话记录。
   ▍更新记录
   *更新：2026-10-24 · 建立：通知统一从精灵弹气泡*
   *更新：2026-10-24 · 按「等你定的事」第 2 项 C：后台走系统通知栏，弹不出时回前台补弹*
================================================================ */
import type { WorkCard } from '../work-cards/work-card.ts'
import type { WorkNotice } from '../work-cards/work-card-store.ts'

/** confirm：要你确认（一直留着）；input：要你补充信息；info：只是告诉你（几秒后自动收起）。 */
export type DotNoticeKind = 'confirm' | 'input' | 'info'
export type DotNoticeTone = 'done' | 'failed' | 'attention' | 'reminder'

export interface DotNotice {
  /** 唯一键：同一键只弹一次。 */
  readonly key: string
  /** 同一件事的主题键：工作推送和星邮匣各来一条时，靠它只弹一次。 */
  readonly topic: string
  readonly kind: DotNoticeKind
  readonly tone: DotNoticeTone
  readonly source: 'work' | 'postbox'
  /** 气泡顶部的小字，例如「请你确认」「做完了」。 */
  readonly eyebrow: string
  readonly title: string
  readonly text: string
  /** 风险说明：要确认的通知有就必须显示。 */
  readonly risk?: string
  readonly workId?: string
  readonly postboxId?: string
  /** 要你补充时服务端给的入口（同源 /_dot/ 专用页才会被直接打开，见 openNoticeEntry）。 */
  readonly entryUrl?: string
  /** 入口按钮上的字（服务端给，如「去登录」）；缺省「去填写」。 */
  readonly entryLabel?: string
  /** true：不自动收起，直到用户处理。 */
  readonly sticky: boolean
  readonly at: number
}

const WORK_PHASE = { 'waiting-approval': 'approval', 'waiting-input': 'input', succeeded: 'done', failed: 'failed' } as const
type WorkPhase = typeof WORK_PHASE[keyof typeof WORK_PHASE]

function workTopic(workId: string, phase: WorkPhase): string { return `work:${workId}:${phase}` }

/**
 * 气泡「去填写」直达保密表单（2026-10-30 · Hark）。
 * 为什么：后台要用户钥匙时，入口原来只写在工作卡上，气泡点了先跳工作页、再点一次链接，
 * 手机上很容易断。这里只认**同源**、且路径在 /_dot/ 下的入口（服务端 blocked.action 下发的专用页），
 * 其余一律返回 false，调用方照旧打开工作页——不做任意外部跳转。
 */
export function openNoticeEntry(url: string | undefined, sameWindow = false): boolean {
  if (typeof url !== 'string' || url === '' || typeof window === 'undefined' || typeof document === 'undefined') return false
  let target: URL
  try { target = new URL(url, window.location.href) } catch { return false }
  if (target.origin !== window.location.origin || !target.pathname.startsWith('/_dot/')) return false
  /* 系统通知栏点进来不算页面内手势，新标签可能被拦；这条路径直接在当前页打开。 */
  if (sameWindow) { window.location.assign(target.href); return true }
  const link = document.createElement('a')
  link.href = target.href
  link.target = '_blank'
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  return true
}


function shapeWork(phase: WorkPhase, base: { key: string; workId: string; title: string; text: string; at: number; source: 'work' | 'postbox'; risk?: string; postboxId?: string; entryUrl?: string; entryLabel?: string }): DotNotice {
  const title = base.title.trim() || '一项工作'
  const common = { key: base.key, topic: workTopic(base.workId, phase), source: base.source, title, text: base.text, workId: base.workId, at: base.at, ...(base.postboxId ? { postboxId: base.postboxId } : {}) }
  switch (phase) {
    case 'approval': return { ...common, kind: 'confirm', tone: 'attention', eyebrow: '请你确认', sticky: true, ...(base.risk ? { risk: base.risk } : {}) }
    case 'input': return { ...common, kind: 'input', tone: 'attention', eyebrow: '要你补充', sticky: true, ...(base.entryUrl ? { entryUrl: base.entryUrl } : {}), ...(base.entryLabel ? { entryLabel: base.entryLabel } : {}) }
    case 'done': return { ...common, kind: 'info', tone: 'done', eyebrow: '做完了', sticky: false }
    case 'failed': return { ...common, kind: 'info', tone: 'failed', eyebrow: '没做成', sticky: false }
  }
}

/** 工作全局状态里「亲眼看到的状态变化」→ 通知。只认四种变化，其余返回 null。 */
export function noticeFromWork(notice: WorkNotice, card: WorkCard | undefined): DotNotice | null {
  const phase = (WORK_PHASE as Record<string, WorkPhase | undefined>)[notice.status]
  if (!phase) return null
  const attention = card?.attention
  const text = phase === 'approval' || phase === 'input'
    ? (attention?.message || (phase === 'approval' ? '这一步需要你点头才能继续。' : '需要你补充信息才能继续。'))
    : phase === 'failed' ? (card?.error || notice.text) : notice.text
  return shapeWork(phase, { key: `work:${notice.key}`, workId: notice.workId, title: notice.title || card?.title || '', text, at: notice.at, source: 'work', ...(phase === 'approval' && attention?.risk ? { risk: attention.risk } : {}), ...(phase === 'input' && typeof attention?.action?.url === 'string' ? { entryUrl: attention.action.url } : {}), ...(phase === 'input' && typeof attention?.action?.label === 'string' && attention.action.label.length > 0 && attention.action.label.length <= 8 ? { entryLabel: attention.action.label } : {}) })
}

/** 星邮匣事件的最小形状（和 @xtcausal/dot-postbox 的 PostboxEventView 对齐，只取用得到的字段）。 */
export interface PostboxNoticeEvent {
  readonly id: string
  readonly kind: string
  readonly severity: string
  readonly title: string
  readonly body?: string | undefined
  readonly workId?: string | undefined
  readonly createdAt?: number
}

const POSTBOX_WORK_PHASE: Record<string, WorkPhase> = { 'work-completed': 'done', 'work-failed': 'failed', 'work-blocked': 'input', 'work-waiting-approval': 'approval' }

/**
 * 星邮匣事件 → 通知。
 * - 工作类事件（work-*）一律算工作通知，和工作推送共用 topic，只弹一次。
 * - 提醒 / 消息类只有「重要」「紧急」才走精灵气泡；普通的返回 null，沿用原来的顶部提示条。
 */
export function noticeFromPostbox(event: PostboxNoticeEvent, card: WorkCard | undefined, now: number): DotNotice | null {
  const phase = POSTBOX_WORK_PHASE[event.kind]
  if (phase && event.workId) {
    const attention = card?.attention
    const text = (phase === 'approval' || phase === 'input') && attention?.message ? attention.message : (event.body || event.title)
    return shapeWork(phase, { key: `postbox:${event.id}`, workId: event.workId, title: card?.title || event.title, text, at: now, source: 'postbox', postboxId: event.id, ...(phase === 'approval' && attention?.risk ? { risk: attention.risk } : {}), ...(phase === 'input' && typeof attention?.action?.url === 'string' ? { entryUrl: attention.action.url } : {}), ...(phase === 'input' && typeof attention?.action?.label === 'string' && attention.action.label.length > 0 && attention.action.label.length <= 8 ? { entryLabel: attention.action.label } : {}) })
  }
  if (event.severity !== 'important' && event.severity !== 'urgent') return null
  return {
    key: `postbox:${event.id}`, topic: `postbox:${event.id}`, kind: 'info', tone: 'reminder', source: 'postbox',
    eyebrow: event.severity === 'urgent' ? '紧急提醒' : '重要提醒', title: event.title, text: event.body ?? '',
    postboxId: event.id, ...(event.workId ? { workId: event.workId } : {}),
    // 紧急提醒要用户点「知道了」才收；重要提醒和其他「只是告诉你」一样自动收起。
    sticky: event.severity === 'urgent', at: now,
  }
}

/** 通知此刻所处的环境：页面在不在前台。以后安卓壳可以再加「锁屏」「勿扰」。 */
export interface NoticeEnvironment { readonly visible: boolean }

/** 一个能把通知弹出去的渠道。 */
export interface NoticeChannel {
  readonly id: string
  /** 返回 false（或兑现为 false）表示没弹出来，分发器会把这条留到回前台再补。 */
  deliver(notice: DotNotice): void | boolean | Promise<boolean>
  /** 通知已经不成立（例如工作已不在等确认）：收回。 */
  withdraw(key: string): void
}

/** 路由：给一条通知和当前环境，返回要走哪些渠道。 */
export type NoticeRoute = (notice: DotNotice, environment: NoticeEnvironment) => readonly string[]

/** 旧规则：不管前台后台都从精灵弹。现在只留给测试和截图用。 */
export const spriteEverywhere: NoticeRoute = () => ['sprite']

/** 现在的规则（用户 2026-10-24 定第 2 项 C）：前台走精灵，后台走手机系统通知栏。 */
export const foregroundSpriteBackgroundNative: NoticeRoute = (_notice, environment) => environment.visible ? ['sprite'] : ['native']

export interface NoticeDispatcherOptions {
  readonly route?: NoticeRoute
  readonly environment?: () => NoticeEnvironment
  readonly clock?: () => number
  /** 同一 topic 在这段时间内只弹一次；默认 10 分钟。 */
  readonly topicWindowMs?: number
}

export class NoticeDispatcher {
  private readonly channels = new Map<string, NoticeChannel>()
  private readonly seenKeys = new Set<string>()
  private readonly topics = new Map<string, { at: number; key: string; channels: readonly string[] }>()
  private route: NoticeRoute
  private readonly environment: () => NoticeEnvironment
  private readonly clock: () => number
  private readonly topicWindowMs: number
  private readonly deferred = new Map<string, DotNotice>()

  constructor(channels: readonly NoticeChannel[], options: NoticeDispatcherOptions = {}) {
    for (const channel of channels) this.channels.set(channel.id, channel)
    this.route = options.route ?? foregroundSpriteBackgroundNative
    this.environment = options.environment ?? (() => ({ visible: typeof document === 'undefined' || document.visibilityState !== 'hidden' }))
    this.clock = options.clock ?? Date.now
    this.topicWindowMs = options.topicWindowMs ?? 10 * 60_000
  }

  /** 接系统通知栏：addChannel(createSystemNoticeChannel(...)) 或 addChannel(createAndroidNoticeChannel(...))。 */
  addChannel(channel: NoticeChannel): () => void {
    this.channels.set(channel.id, channel)
    return () => { if (this.channels.get(channel.id) === channel) this.channels.delete(channel.id) }
  }

  setRoute(route: NoticeRoute): void { this.route = route }

  /** 分发一条通知；被去重挡下或没有可用渠道时返回 false。 */
  dispatch(notice: DotNotice): boolean {
    if (this.seenKeys.has(notice.key)) return false
    const now = this.clock()
    const previous = this.topics.get(notice.topic)
    this.seenKeys.add(notice.key)
    if (previous && now - previous.at < this.topicWindowMs) return false
    let targets = this.route(notice, this.environment()).filter(id => this.channels.has(id))
    /* 路由要的渠道一个都没有（例如没接系统通知）时退回精灵，不让通知丢掉。 */
    if (!targets.length && this.channels.has('sprite')) targets = ['sprite']
    if (!targets.length) return false
    this.deferred.delete(notice.key)
    this.topics.set(notice.topic, { at: now, key: notice.key, channels: targets })
    const results = targets.map(id => this.channels.get(id)!.deliver(notice))
    const failed = (values: readonly (void | boolean)[]) => values.every(value => value === false)
    if (results.some(result => result instanceof Promise)) {
      void Promise.all(results.map(result => Promise.resolve(result).catch(() => false as const))).then(values => { if (failed(values)) this.defer(notice) })
    } else if (failed(results as readonly (void | boolean)[])) this.defer(notice)
    return true
  }

  /** 这条没弹出来：放开去重，留到 flushDeferred（回到前台）再分发一次。 */
  private defer(notice: DotNotice): void {
    if (this.topics.get(notice.topic)?.key === notice.key) this.topics.delete(notice.topic)
    this.seenKeys.delete(notice.key)
    this.deferred.set(notice.key, notice)
  }

  /** 回到前台时调用：把后台没弹出来的通知重新分发（此时会走精灵）。 */
  flushDeferred(): number {
    const pending = [...this.deferred.values()]
    this.deferred.clear()
    return pending.filter(notice => this.dispatch(notice)).length
  }

  /** 还在等回前台补弹的通知数（测试用）。 */
  get deferredCount(): number { return this.deferred.size }

  /** 收回某个主题的通知（例如工作已经不在等确认）。 */
  withdrawTopic(topic: string): void {
    const entry = this.topics.get(topic)
    if (!entry) return
    for (const id of entry.channels) this.channels.get(id)?.withdraw(entry.key)
  }

  /** 某个主题重新允许弹（例如工作离开了等确认，下次再进来要再弹）。 */
  forgetTopic(topic: string): void {
    this.topics.delete(topic)
    /* 已经不成立的事，回前台也不用补弹了。 */
    for (const [key, notice] of this.deferred) if (notice.topic === topic) this.deferred.delete(key)
  }
}

/** 工作当前状态对应的「还成立」的主题；不在等待中就没有。 */
export function liveWorkTopic(card: WorkCard | undefined): string | null {
  if (!card) return null
  if (card.status === 'waiting-approval') return workTopic(card.id, 'approval')
  if (card.status === 'waiting-input') return workTopic(card.id, 'input')
  return null
}

export function workTopicOf(workId: string, kind: 'approval' | 'input'): string { return workTopic(workId, kind) }

/** 交给系统通知栏的一条通知（platform.showNotification 的入参形状）。 */
export interface SystemNoticePayload { readonly id: string; readonly title: string; readonly body: string; readonly workId?: string }

/**
 * 手机系统通知栏渠道：在安卓壳里走 window.dotAndroid.notify，网页里走 Notification。
 * show 返回 false 表示没弹出来（没权限 / 不支持），分发器会留到回前台从精灵补弹。
 * onShown：真的弹出来了（星邮匣据此记投递回执）；onOpen：用户点了系统通知。
 */
export function createSystemNoticeChannel(
  show: (payload: SystemNoticePayload, onClick: () => void) => boolean | Promise<boolean>,
  hooks: { onShown?(notice: DotNotice): void; onOpen?(notice: DotNotice): void } = {},
): NoticeChannel {
  return {
    id: 'native',
    deliver: async notice => {
      const body = [notice.text, notice.risk ? `风险：${notice.risk}` : ''].filter(Boolean).join('\n')
      const shown = await show({ id: notice.key, title: `${notice.eyebrow} · ${notice.title}`, body, ...(notice.workId ? { workId: notice.workId } : {}) }, () => hooks.onOpen?.(notice))
      if (shown) hooks.onShown?.(notice)
      return shown
    },
    withdraw: () => {},
  }
}

/** 安卓壳桥的最小形状（platform.ts 里 window.dotAndroid 已有 notify）。 */
export interface AndroidNoticeBridge { notify(payload: string): void }

/**
 * 直接把通知交给原生壳的渠道（壳支持动作按钮时用）。现在注册的是 createSystemNoticeChannel。
 * payload 是 JSON：{ id, kind, title, body, risk?, workId?, postboxId?, actions }，
 * actions 里 confirm 类给 ['confirm','reject']，input 给 ['fill']，info 给 ['open']。
 * 原生点按后回调网页（例如 dot://notice?id=…&action=confirm），由壳调 onAction 交回来。
 */
export function createAndroidNoticeChannel(bridge: AndroidNoticeBridge): NoticeChannel {
  return {
    id: 'native',
    deliver: notice => bridge.notify(JSON.stringify({
      id: notice.key, kind: notice.kind, title: `${notice.eyebrow} · ${notice.title}`, body: notice.text,
      ...(notice.risk ? { risk: notice.risk } : {}), ...(notice.workId ? { workId: notice.workId } : {}), ...(notice.postboxId ? { postboxId: notice.postboxId } : {}),
      actions: notice.kind === 'confirm' ? ['confirm', 'reject'] : notice.kind === 'input' ? ['fill'] : ['open'],
    })),
    withdraw: () => {},
  }
}
