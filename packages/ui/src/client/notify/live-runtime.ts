/* ================================================================
   DOT 联动运行时 · 工作全局状态 + 通知分发 + 精灵气泡 + 确认桥接
   ▍这是什么
   index.ts 启动时建一份，DotShell（气泡层、精灵换图）、对话工具卡、工作空间、remote-adapter
   （推送和星邮匣）都读写这一份：
   ① 工作推送 / 轮询 → WorkCardStore；store 里“亲眼看到的状态变化” → NoticeDispatcher → 精灵气泡或系统通知栏；
   ② 星邮匣的工作事件、重要 / 紧急提醒 → 同一个分发器（同一件事只弹一次）；
   ③ 要确认的气泡 → ApprovalBridge 回答原生会话上挂着的审批请求；找不到请求时按钮改成「去处理」；
   ④ 工作离开“等你确认 / 补充”时，收回对应气泡；
   ⑤ 精灵七种样子要用的瞬时信号（SpriteSignals）：看到工作做完 → 播「完成」。
   ▍修改铁律
   1. 路由规则是 foregroundSpriteBackgroundNative（用户 2026-10-24 定第 2 项 C）：在 DOT 里从精灵弹，
      不在 DOT 时走手机系统通知栏，同一件事只提醒一次；系统通知弹不出时回前台从精灵补弹。
   2. 星邮匣的投递回执（用户定第 3 项 C）：从精灵弹的，用户点了气泡才记；没点、自己收起的不记，
      下次打开 DOT 还会再弹。走系统通知栏的，真弹出来就记。都不标已读。
   3. 这里不碰精灵的拖动、停靠和位置保存。
   ▍更新记录
   *更新：2026-10-24 · 建立*
   *更新：2026-10-24 · 按「等你定的事」第 2、3、10 项：后台走系统通知栏、点了气泡才记回执、精灵七种样子*
================================================================ */
import { WorkCardStore, WorkFeed, type WorkFeedOptions, type WorkFeedPort } from '../work-cards/work-card-store.ts'
import { NoticeDispatcher, createSystemNoticeChannel, liveWorkTopic, noticeFromPostbox, noticeFromWork, openNoticeEntry, type DotNotice, type NoticeDispatcherOptions, type PostboxNoticeEvent, type SystemNoticePayload } from './notices.ts'
import { SpriteSignals, type SpritePoseTimers } from './sprite-pose.ts'
import { SpriteBubbleQueue, type SpriteBubbleTimers } from './sprite-bubbles.ts'
import { noticeCoveredByCard } from './card-coverage.ts'
import { ApprovalBridge } from './approvals.ts'
import { AwayTracker } from './away-summary.ts'
import type { SpriteBubbleActions } from './SpriteBubbles.tsx'

export interface DotLiveOptions {
  readonly clock?: () => number
  readonly timers?: SpriteBubbleTimers
  readonly dismissMs?: number
  /** 这条气泡的内容是否已由屏幕上的工作卡展示（展示了就不在精灵上重复弹）。默认查 DOM，见 card-coverage.ts。 */
  readonly covered?: (notice: DotNotice) => boolean
  readonly dispatcher?: Omit<NoticeDispatcherOptions, 'clock'>
  readonly feed?: WorkFeedOptions
  /** 手机系统通知栏（platform.showNotification）。不给时视为弹不出，回前台从精灵补弹。 */
  readonly system?: (payload: SystemNoticePayload, onClick: () => void) => boolean | Promise<boolean>
  readonly poseTimers?: SpritePoseTimers
  /** 「你不在时完成了几件」的记账。不给时按 localStorage 记；false 关掉（测试用）。见 away-summary.ts。 */
  readonly away?: AwayTracker | false
}

/** 星邮匣投递回执：via 'sprite' 是用户点了精灵气泡，'native' 是系统通知栏真弹出来了。 */
export type PostboxReceipt = (postboxId: string, via: 'sprite' | 'native') => void

export interface DotLiveNavigation {
  openWork(workId: string): void
  openPostbox(postboxId?: string): void
}

export class DotLive {
  readonly store: WorkCardStore
  readonly bubbles: SpriteBubbleQueue
  readonly dispatcher: NoticeDispatcher
  readonly approvals = new ApprovalBridge()
  readonly signals: SpriteSignals
  private feedInstance: WorkFeed | null = null
  private readonly handled = new Set<string>()
  private readonly liveTopics = new Map<string, string>()
  private readonly clock: () => number
  private readonly stopStore: () => void
  private navigation: DotLiveNavigation = { openWork: () => {}, openPostbox: () => {} }
  private receipt: PostboxReceipt = () => {}
  /* 简洁版（2026-10-31）：「你不在时…」另存一份，简洁版把它做成一直留着、用户点掉才收的横条。
     为什么：气泡全是做完时 6 秒自动收起，还会被「卡片已在屏上」判定压掉，盘点时三次都没看到。
     只加不改：经典版的气泡照旧走 dispatcher。 */
  private awayNotice: DotNotice | null = null
  private readonly awayListeners = new Set<() => void>()
  readonly awaySummary = {
    get: (): DotNotice | null => this.awayNotice,
    subscribe: (listener: () => void): (() => void) => { this.awayListeners.add(listener); return () => { this.awayListeners.delete(listener) } },
    dismiss: (): void => { this.awayNotice = null; for (const listener of this.awayListeners) listener() },
  }
  private readonly receipted = new Set<string>()
  private readonly stopVisibility: () => void
  private readonly away: AwayTracker | null

  constructor(private readonly options: DotLiveOptions = {}) {
    this.clock = options.clock ?? Date.now
    this.store = new WorkCardStore(this.clock)
    this.bubbles = new SpriteBubbleQueue(options.timers, options.dismissMs, options.covered ?? (notice => noticeCoveredByCard(notice)))
    this.signals = new SpriteSignals(options.poseTimers)
    const system = createSystemNoticeChannel(options.system ?? (() => false), {
      onShown: notice => { if (notice.postboxId) this.markReceipt(notice.postboxId, 'native') },
      onOpen: notice => this.open(notice),
    })
    this.dispatcher = new NoticeDispatcher([this.bubbles.channel, system], { ...options.dispatcher, clock: this.clock })
    this.away = options.away === false ? null : options.away ?? new AwayTracker({ clock: this.clock })
    this.stopStore = this.store.subscribe(() => this.sync())
    /* 回到 DOT：后台没弹出来的通知从精灵补一次；已经走过系统通知栏的不再重复。 */
    if (typeof document !== 'undefined') {
      const onVisible = () => { if (document.visibilityState !== 'hidden') this.dispatcher.flushDeferred() }
      document.addEventListener('visibilitychange', onVisible)
      this.stopVisibility = () => document.removeEventListener('visibilitychange', onVisible)
    } else this.stopVisibility = () => {}
  }

  /** remote-adapter 连上星邮匣后接上回执写入。 */
  setPostboxReceipt(receipt: PostboxReceipt): void { this.receipt = receipt }

  private markReceipt(postboxId: string, via: 'sprite' | 'native'): void {
    if (this.receipted.has(postboxId)) return
    this.receipted.add(postboxId)
    this.receipt(postboxId, via)
  }

  private open(notice: DotNotice): void {
    if (notice.kind === 'input' && openNoticeEntry(notice.entryUrl, true)) return
    if (notice.workId && notice.tone !== 'reminder') this.navigation.openWork(notice.workId)
    else this.navigation.openPostbox(notice.postboxId)
  }

  /** 跳转动作由 index.ts 在视图仓库就绪后接上。 */
  setNavigation(navigation: DotLiveNavigation): void { this.navigation = navigation }

  /** 业务 Remote 连上后建馈送器：推送优先，断了 5 秒一次查询兜底。 */
  connect(port: WorkFeedPort): WorkFeed {
    this.feedInstance?.stop()
    this.feedInstance = new WorkFeed(this.store, port, this.options.feed)
    return this.feedInstance
  }

  get feed(): WorkFeed | null { return this.feedInstance }

  disconnect(): void { this.feedInstance?.stop(); this.feedInstance = null }

  /** 星邮匣待投递事件。返回 true 表示这条归精灵气泡管（含被去重挡下的同一件事）；false 表示沿用原来的顶部提示。 */
  postbox(event: PostboxNoticeEvent): boolean {
    const notice = noticeFromPostbox(event, event.workId ? this.store.get(event.workId) : undefined, this.clock())
    if (!notice) return false
    this.dispatcher.dispatch(notice)
    return true
  }

  /** 直接分发一条通知（测试和截图用）。 */
  notify(notice: DotNotice): boolean { return this.dispatcher.dispatch(notice) }

  private sync(): void {
    const snapshot = this.store.getSnapshot()
    /* 第一次拿到全量：离线期间做完 / 没做成 / 等你处理的，合成一条「你不在时…」。只这一次。 */
    if (this.away && this.store.hydrated) {
      const away = this.away.hydrated(Object.values(snapshot.cards))
      if (away) {
        this.awayNotice = away
        for (const listener of this.awayListeners) listener()
        this.dispatcher.dispatch(away)
      }
    }
    for (const notice of [...snapshot.notices].reverse()) {
      if (this.handled.has(notice.key)) continue
      this.handled.add(notice.key)
      if (notice.status === 'succeeded') this.signals.celebrate()
      const shaped = noticeFromWork(notice, this.store.get(notice.workId))
      if (shaped) this.dispatcher.dispatch(shaped)
    }
    for (const card of Object.values(snapshot.cards)) {
      const live = liveWorkTopic(card)
      const before = this.liveTopics.get(card.id)
      if (before && before !== live) { this.dispatcher.withdrawTopic(before); this.dispatcher.forgetTopic(before) }
      if (live) this.liveTopics.set(card.id, live)
      else this.liveTopics.delete(card.id)
    }
  }

  private sessionOf(notice: DotNotice): string | undefined {
    return notice.workId ? this.store.get(notice.workId)?.sessionId : undefined
  }

  /** 给 SpriteBubbles 的动作。 */
  readonly actions: SpriteBubbleActions = {
    openWork: workId => this.navigation.openWork(workId),
    openPostbox: postboxId => this.navigation.openPostbox(postboxId),
    canDecide: notice => this.approvals.canDecide(this.sessionOf(notice)),
    decide: (notice, decision) => this.approvals.decide(this.sessionOf(notice), decision),
    subscribeDecidable: listener => this.approvals.subscribe(listener),
    decidableVersion: () => this.approvals.getVersion(),
    acknowledge: notice => { if (notice.postboxId) this.markReceipt(notice.postboxId, 'sprite') },
  }

  dispose(): void { this.away?.dispose(); this.stopStore(); this.stopVisibility(); this.disconnect(); this.bubbles.clear(); this.signals.dispose() }
}
