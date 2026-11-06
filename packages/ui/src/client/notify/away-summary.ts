/* ================================================================
   你不在时 · 打开 DOT 时补一句离线期间的后台结果
   ▍这是什么
   工作全局状态第一次拿到全量时，故意不弹气泡（刷新就刷屏）。代价是：页面关着的时候
   做完 / 没做成 / 等你处理的工作，回来以后一个提醒都没有。这里在第一次全量时，数一下
   「上次在 DOT 里之后」变化过的工作，合成一条气泡：「你不在时完成了 3 件……」。
   ▍规则（2026-10-31 用户定）
   1. 只提示一次：一次页面加载最多一条，气泡 key 带上「上次在」的时间，提示过就把这个时间推到现在。
   2. 「上次在」只在页面可见时往前走（每 30 秒、切到后台、关页时各记一次）。
   3. 每台设备各记各的（localStorage），和星邮匣「看过了」一样。
   4. 第一次用（没有记录）只记下现在，不提示。
   *更新：2026-10-31 · 建立*
================================================================ */
import type { WorkCard } from '../work-cards/work-card.ts'
import type { DotNotice } from './notices.ts'

export const AWAY_SEEN_KEY = 'dot.away.lastSeen.v1'

export interface AwaySeenStore {
  get(): number | null
  set(at: number): void
}

export const localAwaySeen: AwaySeenStore = {
  get() {
    try {
      const raw = globalThis.localStorage?.getItem(AWAY_SEEN_KEY)
      const value = raw == null ? NaN : Number(raw)
      return Number.isFinite(value) && value > 0 ? value : null
    } catch { return null }
  },
  set(at) {
    try { globalThis.localStorage?.setItem(AWAY_SEEN_KEY, String(Math.round(at))) } catch { /* 存不下就算了 */ }
  },
}

export interface AwayCounts {
  readonly done: number
  readonly failed: number
  readonly attention: number
  readonly interrupted: number
  /** 按更新时间新→旧。 */
  readonly workIds: readonly string[]
}

function timeOf(card: WorkCard): number {
  const at = Date.parse(card.updatedAt || '')
  return Number.isFinite(at) ? at : 0
}

/** 数「上次在之后」变成做完 / 没做成 / 等你处理 / 被打断的工作。 */
export function countAway(cards: readonly WorkCard[], since: number): AwayCounts {
  let done = 0, failed = 0, attention = 0, interrupted = 0
  const picked: WorkCard[] = []
  for (const card of cards) {
    if (card.partial || timeOf(card) <= since) continue
    if (card.status === 'succeeded') done++
    else if (card.status === 'failed') failed++
    else if (card.status === 'waiting-input' || card.status === 'waiting-approval') attention++
    else if (card.status === 'interrupted') interrupted++
    else continue
    picked.push(card)
  }
  picked.sort((a, b) => timeOf(b) - timeOf(a))
  return { done, failed, attention, interrupted, workIds: picked.map(card => card.id) }
}

/** 计数 → 一条气泡。什么都没有时返回 null。 */
export function awayNotice(counts: AwayCounts, since: number, now: number): DotNotice | null {
  if (counts.workIds.length === 0) return null
  const parts: string[] = []
  if (counts.done) parts.push(`完成了 ${counts.done} 件`)
  if (counts.failed) parts.push(`${counts.failed} 件没做成`)
  if (counts.attention) parts.push(`${counts.attention} 件等你处理`)
  if (counts.interrupted) parts.push(`${counts.interrupted} 件被打断了`)
  const needsYou = counts.attention + counts.interrupted + counts.failed > 0
  const title = `你不在时${parts.join('，')}`
  return {
    key: `away:${Math.round(since)}`,
    topic: `away:${Math.round(since)}`,
    kind: 'info',
    tone: needsYou ? 'attention' : 'done',
    source: 'work',
    eyebrow: '你不在时',
    title,
    text: counts.workIds.length === 1 ? '点这里去看那件工作。' : '点这里去工作空间看，最新的一件会先对准。',
    workId: counts.workIds[0]!,
    sticky: needsYou,
    at: now,
  }
}

export interface AwayTrackerOptions {
  readonly store?: AwaySeenStore
  readonly clock?: () => number
  /** 页面是否可见；不可见时「上次在」不往前走。 */
  readonly visible?: () => boolean
  readonly intervalMs?: number
}

/** 记「上次在 DOT 里」的时间，并在第一次全量时给出那条汇总。 */
export class AwayTracker {
  private readonly store: AwaySeenStore
  private readonly clock: () => number
  private readonly visible: () => boolean
  private checked = false
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly stopListeners: () => void

  constructor(options: AwayTrackerOptions = {}) {
    this.store = options.store ?? localAwaySeen
    this.clock = options.clock ?? Date.now
    this.visible = options.visible ?? (() => typeof document === 'undefined' || document.visibilityState !== 'hidden')
    if (typeof document !== 'undefined' && typeof window !== 'undefined') {
      /* 切到后台或关页前记一笔；回到前台也记。只在已经对过一次之后记，免得把离线期间盖掉。 */
      const onVisibility = () => { if (this.checked) this.store.set(this.clock()) }
      document.addEventListener('visibilitychange', onVisibility)
      window.addEventListener('pagehide', onVisibility)
      this.stopListeners = () => { document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('pagehide', onVisibility) }
      this.timer = setInterval(() => this.touch(), options.intervalMs ?? 30_000)
    } else this.stopListeners = () => {}
  }

  /** 页面可见且已经对过一次时，把「上次在」推到现在。 */
  touch(): void { if (this.checked && this.visible()) this.store.set(this.clock()) }

  /**
   * 第一次全量到了：返回那条汇总（可能为 null），之后再调一律返回 null。
   * @param cards - 第一次全量里的工作卡
   * @returns 汇总气泡或 null
   */
  hydrated(cards: readonly WorkCard[]): DotNotice | null {
    if (this.checked) return null
    this.checked = true
    const now = this.clock()
    const since = this.store.get()
    this.store.set(now)
    if (since === null) return null
    return awayNotice(countAway(cards, since), since, now)
  }

  dispose(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    this.stopListeners()
  }
}
