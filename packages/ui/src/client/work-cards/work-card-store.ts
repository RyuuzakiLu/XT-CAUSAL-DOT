/* ================================================================
   DOT 工作卡 · 全局状态（按任务编号存，两个空间共用一份）
   ▍这是什么
   工作空间的大卡、对话里的小卡、对话里的通知都从这里读。一处变，两边同时变。
   ▍数据怎么进来
   ① 推送优先：后端 work.follow 第一帧是全量 snapshot，之后每次变化推一帧 changed（带完整快照）。
   ② 推送断了 / 没开成：退回定时 work.list（默认 5 秒一次）；推送帧一回来就停止轮询。
   ③ 对话里的工具结果 meta：只当种子（partial），全量快照到了就被替换。
   ▍修改铁律
   1. 【不】依赖 React；组件用 useSyncExternalStore 订阅（见 hooks 注入）。
   2. 【不】在首次全量里发通知：只有“亲眼看到状态从 A 变成 B”才发，刷新页面不会刷屏。
   3. 修订号旧的帧一律丢弃（推送与轮询并发时防回退）。
   ▍更新记录
   *更新：2026-10-24 · 建立：工作空间 × 对话空间联动*
================================================================ */
import type { WorkSnapshot } from '@xtcausal/dot-contracts'
import { describeWorkCard, isTerminal, preferCard, workCardFromSnapshot, type WorkCard, type WorkCardStatus } from './work-card.ts'

export type WorkFeedSource = 'idle' | 'push' | 'poll' | 'offline'

/** 对话里推的一条通知：工作做完、需要你确认/补充、失败。 */
export interface WorkNotice {
  readonly key: string
  readonly workId: string
  readonly kind: 'done' | 'attention' | 'failed'
  readonly status: WorkCardStatus
  readonly title: string
  readonly text: string
  readonly at: number
}

export interface WorkCardsSnapshot {
  readonly cards: Readonly<Record<string, WorkCard>>
  /** 按更新时间新→旧。 */
  readonly order: readonly string[]
  readonly source: WorkFeedSource
  readonly notices: readonly WorkNotice[]
  readonly syncedAt: number | null
  readonly error: string | null
}

export type WorkFollowFrame =
  | { readonly type: 'snapshot'; readonly works: readonly WorkSnapshot[]; readonly revision?: number }
  | { readonly type: 'changed'; readonly work: WorkSnapshot; readonly revision?: number }

const MAX_NOTICES = 4

function noticeFor(previous: WorkCard | undefined, next: WorkCard, now: number): WorkNotice | null {
  if (!previous || previous.status === next.status || previous.partial) return null
  const kind: WorkNotice['kind'] | null = next.status === 'succeeded' ? 'done'
    : next.status === 'waiting-input' || next.status === 'waiting-approval' ? 'attention'
      : next.status === 'failed' ? 'failed' : null
  if (!kind) return null
  return { key: `${next.id}:${next.status}:${next.revision}`, workId: next.id, kind, status: next.status, title: next.title, text: describeWorkCard(next, now), at: now }
}

export class WorkCardStore {
  private snapshot: WorkCardsSnapshot = { cards: {}, order: [], source: 'idle', notices: [], syncedAt: null, error: null }
  private readonly listeners = new Set<() => void>()
  private readonly dismissed = new Set<string>()
  private filled = false

  constructor(private readonly clock: () => number = Date.now) {}

  getSnapshot = (): WorkCardsSnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  get(id: string): WorkCard | undefined { return this.snapshot.cards[id] }
  /** 是否已经拿到过一次全量。 */
  get hydrated(): boolean { return this.filled }

  private publish(patch: Partial<WorkCardsSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of [...this.listeners]) listener()
  }

  private orderOf(cards: Readonly<Record<string, WorkCard>>): string[] {
    return Object.values(cards).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '') || a.id.localeCompare(b.id)).map(card => card.id)
  }

  private merge(incoming: readonly WorkCard[], replace: boolean): void {
    const now = this.clock()
    const before = this.snapshot.cards
    const cards: Record<string, WorkCard> = replace ? {} : { ...before }
    if (replace) for (const [id, card] of Object.entries(before)) if (card.partial) cards[id] = card
    const notices = [...this.snapshot.notices]
    let changed = replace
    for (const card of incoming) {
      const previous = before[card.id]
      const chosen = preferCard(replace ? (previous?.partial ? previous : undefined) : previous, card)
      // 全量替换时，老全量的修订号也要参与比较，防止慢一拍的轮询把推送带来的新状态打回去。
      const kept = replace && previous && !previous.partial ? preferCard(previous, chosen) : chosen
      if (kept !== previous) changed = true
      cards[card.id] = kept
      if (this.filled) {
        const notice = noticeFor(previous, kept, now)
        if (notice && !this.dismissed.has(notice.key) && !notices.some(item => item.key === notice.key)) notices.unshift(notice)
      }
    }
    if (!changed && notices.length === this.snapshot.notices.length) return
    this.publish({ cards, order: this.orderOf(cards), notices: notices.slice(0, MAX_NOTICES), syncedAt: now })
  }

  /** 全量（推送 snapshot 帧或轮询结果）。 */
  replaceAll(works: readonly WorkSnapshot[]): void {
    this.merge(works.map(workCardFromSnapshot), true)
    this.filled = true
    if (this.snapshot.syncedAt === null) this.publish({ syncedAt: this.clock() })
  }

  /** 增量（推送 changed 帧）。 */
  upsert(work: WorkSnapshot): void { this.merge([workCardFromSnapshot(work)], false) }

  /** 对话里工具结果带来的精简行：只在全量还没有这项工作时当种子。 */
  seed(cards: readonly WorkCard[]): void {
    const missing = cards.filter(card => !this.snapshot.cards[card.id])
    if (missing.length) this.merge(missing, false)
  }

  frame(frame: WorkFollowFrame): void {
    if (frame.type === 'snapshot') this.replaceAll(frame.works)
    else this.upsert(frame.work)
  }

  setSource(source: WorkFeedSource, error: string | null = null): void {
    if (this.snapshot.source === source && this.snapshot.error === error) return
    this.publish({ source, error })
  }

  dismissNotice(key: string): void {
    this.dismissed.add(key)
    if (this.snapshot.notices.some(item => item.key === key)) this.publish({ notices: this.snapshot.notices.filter(item => item.key !== key) })
  }

  /** 还在跑的工作（非终态）。 */
  active(): WorkCard[] { return this.snapshot.order.map(id => this.snapshot.cards[id]!).filter(card => !isTerminal(card.status)) }
}

export interface WorkFeedPort {
  /** 全量查询（轮询用）。 */
  list(): Promise<readonly WorkSnapshot[]>
}

export interface WorkFeedOptions {
  /** 推送不可用时的轮询间隔；默认 5000ms。 */
  readonly pollMs?: number
  readonly setInterval?: (fn: () => void, ms: number) => unknown
  readonly clearInterval?: (handle: unknown) => void
}

/** 推送优先、轮询兜底的馈送器。push() 由推送循环调，pushLost() 在推送断开时调。 */
export class WorkFeed {
  private pollHandle: unknown = null
  private stopped = false
  private polling = false
  private readonly pollMs: number
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void

  constructor(private readonly store: WorkCardStore, private readonly port: WorkFeedPort, options: WorkFeedOptions = {}) {
    this.pollMs = options.pollMs ?? 5000
    this.setTimer = options.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms))
    this.clearTimer = options.clearInterval ?? (handle => globalThis.clearInterval(handle as ReturnType<typeof setInterval>))
  }

  /** 收到一帧推送：写入全局状态，推送恢复就停轮询。 */
  push(frame: WorkFollowFrame): void {
    if (this.stopped) return
    this.stopPolling()
    this.store.frame(frame)
    this.store.setSource('push')
  }

  /** 推送断了或没开成：退回定时查询。 */
  pushLost(error?: unknown): void {
    if (this.stopped) return
    this.store.setSource('poll', error === undefined ? null : String(error))
    if (this.pollHandle !== null) return
    void this.pollOnce()
    this.pollHandle = this.setTimer(() => { void this.pollOnce() }, this.pollMs)
  }

  async pollOnce(): Promise<void> {
    if (this.stopped || this.polling) return
    this.polling = true
    try {
      const works = await this.port.list()
      if (!this.stopped && this.pollHandle !== null) { this.store.replaceAll(works); this.store.setSource('poll') }
      else if (!this.stopped) this.store.replaceAll(works)
    } catch (error) {
      if (!this.stopped) this.store.setSource('offline', String(error))
    } finally { this.polling = false }
  }

  get isPolling(): boolean { return this.pollHandle !== null }

  private stopPolling(): void {
    if (this.pollHandle === null) return
    this.clearTimer(this.pollHandle)
    this.pollHandle = null
  }

  stop(): void { this.stopped = true; this.stopPolling() }
}
