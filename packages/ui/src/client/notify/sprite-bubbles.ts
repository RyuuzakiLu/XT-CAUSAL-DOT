/* ================================================================
   DOT 精灵气泡队列 · 哪几条气泡正在精灵旁边、哪几条在排队
   ▍这是什么
   精灵气泡渠道的状态。不含 React，计时器可注入，测试里用假时钟。
   ▍规则（用户 2026-10-24 同意的默认）
   ① 要确认 / 要补充 / 紧急提醒：一直留着，直到用户处理（或事情已经不成立被收回）。
   ② 只是告诉你：露出来后几秒自动收起；手指或焦点停在上面时暂停计时。
   ③ 同时来好几条：最多叠放 MAX_VISIBLE 条（竖排，互不覆盖），其余排队，
      要处理的排在前面；前面的收起后队里的补上来。
   ④ 有「要确认」的气泡露在外面时，confirmShown 为 true：精灵换成「请你确认」那张图。
   ⑤ 工作卡已经在屏幕上展示同一件事、同一状态时（见 card-coverage.ts），这条不进队；已在队里的由 sweepCovered 收掉。
   ▍更新记录
   *更新：2026-10-24 · 建立*
   *更新：2026-10-30 · 和工作卡重复的气泡不弹*
================================================================ */
import type { DotNotice, NoticeChannel } from './notices.ts'

export const MAX_VISIBLE = 2
export const INFO_DISMISS_MS = 6000

export interface SpriteBubblesSnapshot {
  readonly visible: readonly DotNotice[]
  /** 排队中、还没露出来的条数。 */
  readonly queued: number
  /** 露在外面的气泡里有没有「要确认」。 */
  readonly confirmShown: boolean
}

export interface SpriteBubbleTimers {
  readonly setTimeout: (fn: () => void, ms: number) => unknown
  readonly clearTimeout: (handle: unknown) => void
}

const defaultTimers: SpriteBubbleTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}

function rank(notice: DotNotice): number { return notice.kind === 'confirm' ? 0 : notice.kind === 'input' ? 1 : notice.sticky ? 2 : 3 }

export class SpriteBubbleQueue {
  private items: DotNotice[] = []
  private snapshot: SpriteBubblesSnapshot = { visible: [], queued: 0, confirmShown: false }
  private readonly listeners = new Set<() => void>()
  private readonly timers = new Map<string, unknown>()
  private readonly held = new Set<string>()

  constructor(private readonly timer: SpriteBubbleTimers = defaultTimers, private readonly dismissMs = INFO_DISMISS_MS, private readonly covered: (notice: DotNotice) => boolean = () => false) {}

  getSnapshot = (): SpriteBubblesSnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }

  /** 作为分发层的「精灵」渠道。 */
  readonly channel: NoticeChannel = { id: 'sprite', deliver: notice => this.push(notice), withdraw: key => this.dismiss(key) }

  push(notice: DotNotice): void {
    if (this.items.some(item => item.key === notice.key)) return
    // 工作卡已经在屏幕上展示了同样的内容：不再在精灵上重复弹。
    if (this.covered(notice)) return
    // 稳定插入：同一等级先来的在前。已经露在外面的不会被新来的挤回队里，免得用户正要点时气泡换了。
    const shown = this.snapshot.visible.length
    let index = this.items.length
    for (let i = shown; i < this.items.length; i += 1) if (rank(this.items[i]!) > rank(notice)) { index = i; break }
    this.items.splice(index, 0, notice)
    this.publish()
  }

  dismiss(key: string): void {
    if (!this.items.some(item => item.key === key)) return
    this.items = this.items.filter(item => item.key !== key)
    this.clearTimer(key)
    this.held.delete(key)
    this.publish()
  }

  /** 收掉已经被屏幕上的工作卡展示了的气泡（卡后出现、或滚进视口时）。只收起，不记回执。 */
  sweepCovered(): void {
    const drop = this.items.filter(item => this.covered(item))
    if (!drop.length) return
    for (const item of drop) { this.clearTimer(item.key); this.held.delete(item.key) }
    this.items = this.items.filter(item => !drop.includes(item))
    this.publish()
  }

  /** 手指 / 焦点停在气泡上：暂停自动收起；离开后重新计时。 */
  hold(key: string, holding: boolean): void {
    if (holding) { this.held.add(key); this.clearTimer(key); return }
    this.held.delete(key)
    const notice = this.snapshot.visible.find(item => item.key === key)
    if (notice) this.arm(notice)
  }

  clear(): void {
    for (const key of [...this.timers.keys()]) this.clearTimer(key)
    this.items = []; this.held.clear(); this.publish()
  }

  private arm(notice: DotNotice): void {
    if (notice.sticky || this.timers.has(notice.key) || this.held.has(notice.key)) return
    this.timers.set(notice.key, this.timer.setTimeout(() => { this.timers.delete(notice.key); this.dismiss(notice.key) }, this.dismissMs))
  }

  private clearTimer(key: string): void {
    const handle = this.timers.get(key)
    if (handle === undefined) return
    this.timer.clearTimeout(handle); this.timers.delete(key)
  }

  private publish(): void {
    const visible = this.items.slice(0, MAX_VISIBLE)
    this.snapshot = { visible, queued: Math.max(0, this.items.length - visible.length), confirmShown: visible.some(item => item.kind === 'confirm') }
    for (const notice of visible) this.arm(notice)
    for (const listener of [...this.listeners]) listener()
  }
}
