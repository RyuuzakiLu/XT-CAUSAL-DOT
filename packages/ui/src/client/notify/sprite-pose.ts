/* ================================================================
   DOT 精灵七种样子 · 什么时候切哪一种
   ▍这是什么
   用户 2026-10-24 定「等你定的事」第 10 项选 C：精灵七种样子全接上。
   七种样子来自 assets/astra-dot-seven-states-v2/manifest.json：
   idle 待机、user-typing 倾听、thinking 思考、responding 回答、working 工作中、reminder 提醒、done 完成。
   ▍切换时机（manifest 只写了动画，没写什么时候用；下面是按状态名推的，用户已看过这张表）
   - 提醒 reminder：有「请你确认」气泡挂着。
   - 倾听 user-typing：你在对话输入框里打字，或者正在录语音。
   - 回答 responding：ASTRA 在回话，对话里的字正在往外冒。
   - 思考 thinking：ASTRA 在忙（会话在跑），但还没开始往外出字。
   - 完成 done：亲眼看到一项工作做完，播一遍（约 2 秒）后回到别的样子。
   - 工作中 working：后台有工作在跑。
   - 待机 idle：以上都没有。
   优先级就是上面的顺序：越靠前越要紧。
   ▍「完成」要等前台空下来（2026-10-24 改，可否决）
   「完成」是后台工作触发的，不插到前台聊天状态前面：用户在打字、录语音，ASTRA 在回答、思考，
   或者「请你确认」气泡挂着时，先记下不播；等这些都没有了再播一次。等的时候又做完几项，也只播一次。
   播到一半前台又忙起来，就让给前台，空下来再从头播一次。
   ▍两个小气泡（用户追加）
   - 工作中：精灵右上角写后台在跑的工作数。
   - 待机：精灵右上角写星邮匣未读数，0 不显示。
   ▍修改铁律
   1. 这里只读状态、不改业务数据；不碰精灵的拖动、停靠和位置保存。
   2. 输入框兜底只认「输入栏卡片里」的可编辑元素，别把设置/搜索输入框算成在说话。
   2. 不改精灵资源图；每种样子用的是从原包缩出来的 768×512 图集（sprite-states-art.ts）。
   ▍更新记录
   *更新：2026-10-24 · 建立*
   *更新：2026-10-24 · 输入框选择器补 DSH 改版兜底（仍排除搜索/设置输入框）*
================================================================ */

export type SpritePose = 'idle' | 'user-typing' | 'thinking' | 'responding' | 'working' | 'reminder' | 'done'

export const SPRITE_POSES: readonly SpritePose[] = ['idle', 'user-typing', 'thinking', 'responding', 'working', 'reminder', 'done']

export const SPRITE_POSE_LABEL: Record<SpritePose, string> = {
  idle: '待机', 'user-typing': '倾听', thinking: '思考', responding: '回答', working: '工作中', reminder: '提醒', done: '完成',
}

export interface SpritePoseInputs {
  /** 有「请你确认」气泡挂着。 */
  readonly confirm: boolean
  /** 刚看到一项工作做完，正在播完成动画。 */
  readonly celebrating: boolean
  /** 你在对话输入框里打字。 */
  readonly typing: boolean
  /** 正在录语音。 */
  readonly listening: boolean
  /** ASTRA 会话在跑。 */
  readonly busy: boolean
  /** 对话里的字正在往外冒。 */
  readonly streaming: boolean
  /** 后台在跑的工作数。 */
  readonly running: number
}

export function resolveSpritePose(input: SpritePoseInputs): SpritePose {
  if (input.confirm) return 'reminder'
  if (input.listening || input.typing) return 'user-typing'
  if (input.busy && input.streaming) return 'responding'
  if (input.busy) return 'thinking'
  if (input.celebrating) return 'done'
  if (input.running > 0) return 'working'
  return 'idle'
}

/** 右上角小气泡：工作中写在跑的工作数，待机写未读数；其他样子、或数字为 0 时不显示。 */
export function spriteBadge(pose: SpritePose, running: number, unread: number): { readonly kind: 'working' | 'unread'; readonly count: number; readonly text: string } | null {
  const show = (kind: 'working' | 'unread', count: number) => count > 0 ? { kind, count, text: count > 99 ? '99+' : String(count) } : null
  if (pose === 'working') return show('working', running)
  if (pose === 'idle') return show('unread', unread)
  return null
}

export interface SpritePoseTimers {
  set(callback: () => void, ms: number): unknown
  clear(handle: unknown): void
}

const defaultTimers: SpritePoseTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** done 图集 22 帧、90ms 一帧，约 1980ms；多留一点让最后一帧停住。 */
export const DONE_PLAY_MS = 2100
/** 最后一次按键后这么久没再打字，就不算在打字了。 */
export const TYPING_IDLE_MS = 1600
/** 对话区最后一次冒字后这么久没动静，就从「回答」回到「思考」。 */
export const STREAM_IDLE_MS = 1500

export interface SpriteSignalsSnapshot {
  readonly typing: boolean
  readonly listening: boolean
  readonly streaming: boolean
  readonly celebrating: boolean
  /** 有工作做完了、但前台在忙，「完成」还在等着播。 */
  readonly donePending: boolean
}

/** 精灵样子用到的、不在业务数据里的瞬时信号。DotLive 持有一份。 */
export class SpriteSignals {
  private snapshot: SpriteSignalsSnapshot = { typing: false, listening: false, streaming: false, celebrating: false, donePending: false }
  /** 外面传进来的前台占用：ASTRA 会话在跑，或「请你确认」气泡挂着。 */
  private held = false
  private readonly listeners = new Set<() => void>()
  private readonly handles = new Map<keyof SpriteSignalsSnapshot, unknown>()

  constructor(private readonly timers: SpritePoseTimers = defaultTimers) {}

  getSnapshot = (): SpriteSignalsSnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }

  private set(key: keyof SpriteSignalsSnapshot, value: boolean): void {
    if (this.snapshot[key] === value) return
    this.snapshot = { ...this.snapshot, [key]: value }
    if (key !== 'celebrating' && key !== 'donePending') this.settleDone()
    for (const listener of [...this.listeners]) listener()
  }

  /** 前台在忙：打字、录语音、出字，或者外面说会话在跑 / 有确认气泡。 */
  private foregroundBusy(): boolean {
    const s = this.snapshot
    return this.held || s.typing || s.listening || s.streaming
  }

  /** 「完成」排队规则：前台空着就播等着的那一次；正在播时前台忙起来，就让出去、空下来重播。 */
  private settleDone(): void {
    const busy = this.foregroundBusy()
    if (busy && this.snapshot.celebrating) {
      const handle = this.handles.get('celebrating')
      if (handle !== undefined) { this.timers.clear(handle); this.handles.delete('celebrating') }
      this.snapshot = { ...this.snapshot, celebrating: false, donePending: true }
    } else if (!busy && this.snapshot.donePending && !this.snapshot.celebrating) {
      this.snapshot = { ...this.snapshot, donePending: false, celebrating: true }
      this.handles.set('celebrating', this.timers.set(() => { this.handles.delete('celebrating'); this.set('celebrating', false) }, DONE_PLAY_MS))
    }
  }

  /** DotShell 每次渲染后告诉这里：ASTRA 会话在不在跑、有没有「请你确认」气泡。 */
  setHeld(held: boolean): void {
    if (this.held === held) return
    this.held = held
    const before = this.snapshot
    this.settleDone()
    if (before !== this.snapshot) for (const listener of [...this.listeners]) listener()
  }

  /** 置为 true，ms 后自动回到 false；再次调用会重新计时。 */
  private pulse(key: keyof SpriteSignalsSnapshot, ms: number): void {
    const before = this.handles.get(key)
    if (before !== undefined) this.timers.clear(before)
    this.set(key, true)
    this.handles.set(key, this.timers.set(() => { this.handles.delete(key); this.set(key, false) }, ms))
  }

  private stop(key: keyof SpriteSignalsSnapshot): void {
    const before = this.handles.get(key)
    if (before !== undefined) { this.timers.clear(before); this.handles.delete(key) }
    this.set(key, false)
  }

  typed(): void { this.pulse('typing', TYPING_IDLE_MS) }
  stopTyping(): void { this.stop('typing') }
  setListening(on: boolean): void { this.set('listening', on) }
  streamed(): void { this.pulse('streaming', STREAM_IDLE_MS) }
  stopStreaming(): void { this.stop('streaming') }
  /** 看到一项工作做完。正在播或已经在等，就不再加一次（多项完成只播一次）。 */
  celebrate(): void {
    if (this.snapshot.celebrating || this.snapshot.donePending) return
    this.snapshot = { ...this.snapshot, donePending: true }
    this.settleDone()
    for (const listener of [...this.listeners]) listener()
  }

  /** 截图和测试用：直接摆成某个样子需要的信号。 */
  force(next: Partial<SpriteSignalsSnapshot>): void {
    for (const key of Object.keys(next) as (keyof SpriteSignalsSnapshot)[]) { this.stop(key); this.set(key, Boolean(next[key])) }
  }

  dispose(): void { for (const handle of this.handles.values()) this.timers.clear(handle); this.handles.clear() }
}

/** 录语音的组件开始 / 结束时广播；DotShell 里的监听器据此切「倾听」。 */
export const SPRITE_LISTENING_EVENT = 'dot:sprite-listening'
export function announceListening(on: boolean): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(SPRITE_LISTENING_EVENT, { detail: { listening: on } }))
}

/** 算「在跟 ASTRA 说话」的输入框：DSH 对话输入框和 DOT 自己的快捷输入框。搜索框、设置里的输入框不算。
    DSH 自己的编辑器是 contenteditable + data-composer-input（lib/client.js 实查），前两条就够；
    后两条是给旧版/改版 DSH 的兜底，只在「输入栏卡片里面」认，避免把搜索框、设置输入框算成在说话。 */
export const TALK_INPUT_SELECTOR = '[data-composer-input], [data-dot-talk-input], [data-composer-card] [contenteditable="true"], [data-composer-card] [role="textbox"]'
/** 对话区：这里面的字在变，就算 ASTRA 在往外出字（输入框里的变化除外）。 */
export const CONVERSATION_SELECTOR = 'section[aria-label="对话空间"]'
/** 对话区里 ASTRA 自己的那几格：DSH 聊天流里不是用户消息的节点（回答、过程、工具卡片）。 */
const ASSISTANT_FLOW_SELECTOR = '[data-chat-flow-kind]:not([data-chat-flow-kind="user"])'
/** 「正在想」那行闪光字，每秒换一次字，不是在冒字。 */
const RUNNING_SELECTOR = '[data-chat-running]'
/** 界面上隐藏的过程行（思考、工具调用、回答前的过程文字、折叠栏），见 answer-only.ts。 */
const HIDDEN_PROCESS_SELECTOR = '[data-chat-flow-kind="turn-process"], [data-chat-flow-kind="tool-call"], [data-chat-group-part="reasoning"], [data-turn-process-member]:not([data-turn-process-answer])'
/** 新插进来一格 ASTRA 的内容才算；回合一开始先插进来的空「过程」框（里面只有闪光字）不算，否则一发消息就先闪一下「回答」。 */
const NEW_ASSISTANT_SELECTOR = "[data-chat-flow-kind]:not([data-chat-flow-kind=\"user\"]):not([data-chat-flow-kind=\"turn-process\"])"
const addsAssistantFlow = (added: Node): boolean => added instanceof Element && (added.matches(NEW_ASSISTANT_SELECTOR) || added.querySelector(NEW_ASSISTANT_SELECTOR) !== null)

/**
 * 在页面上挂三个监听：打字、录语音、对话区冒字。只读 DOM，不改 DSH。
 * busy() 读 ASTRA 会话是否在跑；不在跑时不算冒字。
 */
export function watchSpriteSignals(signals: SpriteSignals, busy: () => boolean, root: Document = document): () => void {
  const win = root.defaultView
  const talkTarget = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest(TALK_INPUT_SELECTOR))
  const onInput = (event: Event) => { if (talkTarget(event.target)) signals.typed() }
  const onLeave = (event: Event) => { if (talkTarget(event.target)) signals.stopTyping() }
  const onSubmit = () => signals.stopTyping()
  const onListening = (event: Event) => signals.setListening(Boolean((event as CustomEvent<{ listening?: boolean }>).detail?.listening))
  root.addEventListener('input', onInput, true)
  root.addEventListener('focusout', onLeave, true)
  root.addEventListener('submit', onSubmit, true)
  win?.addEventListener(SPRITE_LISTENING_EVENT, onListening)
  let observer: MutationObserver | null = null
  const Observer = win?.MutationObserver
  if (Observer && root.body) {
    observer = new Observer(records => {
      if (!busy()) return
      for (const record of records) {
        const node = record.target instanceof Element ? record.target : record.target.parentElement
        if (!node || !node.closest(CONVERSATION_SELECTOR) || node.closest('[data-composer-card]')) continue
        /* 2026-10-27：只有 ASTRA 自己的回复（聊天流里非用户的节点）在变，才算在冒字。
           标题栏、用量条、你刚发出去的消息、以及每秒刷新一次的「正在想」闪光字都不算；
           以前把闪光字也算进去，精灵会在「思考 / 回答」之间每秒来回闪。 */
        if (node.closest(RUNNING_SELECTOR)) continue
        /* 2026-10-27：思考、工具调用这些过程行已在界面上隐藏，它们在变时精灵保持“思考”，只有最终回答出字才算“回答”。 */
        if (node.closest(HIDDEN_PROCESS_SELECTOR)) continue
        if (!node.closest(ASSISTANT_FLOW_SELECTOR) && !(record.type === 'childList' && [...record.addedNodes].some(addsAssistantFlow))) continue
        signals.streamed()
        return
      }
    })
    observer.observe(root.body, { subtree: true, childList: true, characterData: true })
  }
  return () => {
    root.removeEventListener('input', onInput, true)
    root.removeEventListener('focusout', onLeave, true)
    root.removeEventListener('submit', onSubmit, true)
    win?.removeEventListener(SPRITE_LISTENING_EVENT, onListening)
    observer?.disconnect()
  }
}
