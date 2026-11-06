/**
 * 对话进度状态行（2026-10-27）。
 *
 * 对话里只显示最终回答（见 answer-only.ts），但 ASTRA 做到哪一步要让人看得见：
 * - 对话空间顶栏“对话空间”下面那行小字（平时是 Conversation），回合进行中换成“正在翻记忆”这样的状态；
 * - 对话里 DSH 自带的那一行运行提示（[data-chat-running]，原文是“深度求索中，用时 N秒”）改成同一句状态 + 用时。
 *
 * 做法参考 dsh-status-rotator：盯住当前对话会话的 eventSource，从 turn/start、tool/call、tool/result、
 * turn/end 事件和 assistant/live-chunk 里的 reasoning-delta / tool-call-delta / text-delta 判断阶段，
 * 再改写运行行的文字。不动 DSH 的数据，只改显示；工具名一律翻成口语，不露英文。
 */

const TOOL_PHRASES: Record<string, string> = {
  dot_memory_search: '正在翻记忆',
  dot_memory_store: '正在记到记忆里',
  dot_memory_correct: '正在更正记忆',
  dot_memory_forget: '正在删掉一条记忆',
  dot_capabilities: '正在看自己能做什么',
  web_search: '正在网上搜',
  web_fetch: '正在看网页',
  working_directory: '正在查工作目录',
  present: '正在准备给你看的内容',
  todo_write: '正在列步骤',
  ask_user_question: '在等你回答',
  zhixu_create_task: '正在记待办',
  zhixu_update_task: '正在更新待办',
  zhixu_list_tasks: '正在看待办',
  zhixu_get_record: '正在查待办详情',
  zhixu_create_event: '正在加日程',
  zhixu_update_event: '正在改日程',
  zhixu_list_events: '正在看日程',
  zhixu_today_agenda: '正在看今天的安排',
}

export function toolPhrase(name: string | undefined): string {
  if (!name) return '正在动手处理'
  const known = TOOL_PHRASES[name]
  if (known) return known
  if (/memory/i.test(name)) return '正在翻记忆'
  if (/search/i.test(name)) return '正在搜索'
  if (/fetch|browse|web/i.test(name)) return '正在看网页'
  if (/zhixu|task|todo/i.test(name)) return '正在处理待办'
  if (/event|calendar|agenda/i.test(name)) return '正在处理日程'
  if (/read|list|get|find|grep|glob/i.test(name)) return '正在查资料'
  if (/write|edit|create|update|patch/i.test(name)) return '正在整理内容'
  if (/bash|shell|exec|run/i.test(name)) return '正在跑一下'
  return '正在动手处理'
}

type Phase = { kind: 'idle' } | { kind: 'think'; since: number } | { kind: 'tool'; name?: string | undefined; at?: number | undefined } | { kind: 'digest'; after?: string | undefined } | { kind: 'answer' }

/* 写入类工具（记待办、记记忆……）做完后没有“查到的内容”可整理 */
const WRITE_TOOL = /create|update|store|correct|forget|write|edit|patch/i
/* 工具步骤至少亮这么久，否则瞬间做完的工具用户根本看不到 */
const TOOL_MIN_MS = 1500

function phaseText(phase: Phase, now: number): string | null {
  switch (phase.kind) {
    case 'idle': return null
    case 'think': return now - phase.since > 20_000 ? '还在想，马上好' : '正在想'
    case 'tool': return toolPhrase(phase.name)
    case 'digest': return phase.after && WRITE_TOOL.test(phase.after) ? '正在组织回答' : '正在整理查到的内容'
    case 'answer': return '正在组织回答'
  }
}

/* ── 共享状态：当前这句话（null = 没在忙） ── */
let current: string | null = null
const listeners = new Set<() => void>()
export const turnStatus = {
  get: () => current,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
}
function publish(next: string | null) {
  if (next === current) return
  current = next
  for (const listener of listeners) listener()
}

interface Observable<T> { getSnapshot(): T; subscribe(listener: () => void): () => void }
interface Deps {
  sessions: {
    binding(id: any): { eventSource?: Observable<any> } | null | undefined
    retainInfo(id: any): Observable<{ retainedBy: Record<string, number | undefined> }>
  }
  uiSession: { sessionStatus: Observable<any>; pendingInteractions?: Observable<any> }
}

/** 盯住主对话会话，算出当前阶段，写进 turnStatus。 */
export function watchTurnStatus({ sessions, uiSession }: Deps): () => void {
  let phase: Phase = { kind: 'idle' }
  let watchedId: string | null = null
  let running = false
  let detach: (() => void) | null = null
  let disposed = false

  const recompute = () => {
    let text = running ? phaseText(phase.kind === 'idle' ? { kind: 'think', since: Date.now() } : phase, Date.now()) : null
    if (running && watchedId && uiSession.pendingInteractions) {
      const pending = uiSession.pendingInteractions.getSnapshot()
      const list = Array.isArray(pending) ? pending : (pending?.items ?? pending?.interactions ?? pending?.[watchedId] ?? [])
      const mine = Array.isArray(list) ? list.filter((x: any) => !x?.sessionId || x.sessionId === watchedId) : []
      if (mine.length) text = '在等你确认'
    }
    publish(text)
  }
  let holdTimer: ReturnType<typeof setTimeout> | null = null
  const setPhase = (next: Phase) => {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null }
    if (next.kind === 'tool' && next.at === undefined) next = { ...next, at: phase.kind === 'tool' && phase.name === next.name && phase.at ? phase.at : Date.now() }
    phase = next; recompute()
  }
  /* 工具做完：如果工具状态还没亮够 TOOL_MIN_MS，就等一下再切到“整理”。中间有任何新事件都以新事件为准。 */
  const finishTool = (name?: string) => {
    const toolName = name ?? (phase.kind === 'tool' ? phase.name : undefined)
    const shownFor = phase.kind === 'tool' && phase.at ? Date.now() - phase.at : TOOL_MIN_MS
    if (shownFor >= TOOL_MIN_MS) { setPhase({ kind: 'digest', after: toolName }); return }
    if (holdTimer) clearTimeout(holdTimer)
    holdTimer = setTimeout(() => { holdTimer = null; if (!disposed && running) setPhase({ kind: 'digest', after: toolName }) }, TOOL_MIN_MS - shownFor)
  }

  const handleEntry = (entry: any) => {
    if (entry?.type === 'transient') {
      const chunk = entry.event?.data?.chunk
      if (!chunk) return
      if (chunk.type === 'tool-call-delta') { if (chunk.name || phase.kind !== 'tool') setPhase({ kind: 'tool', name: chunk.name ?? (phase.kind === 'tool' ? phase.name : undefined) }) }
      else if (chunk.type === 'reasoning-delta') { if (phase.kind !== 'think' && phase.kind !== 'tool') setPhase({ kind: 'think', since: Date.now() }) }
      else if (chunk.type === 'text-delta') { if (phase.kind !== 'answer' && phase.kind !== 'tool') setPhase({ kind: 'answer' }) }
      return
    }
    const type = entry?.event?.type
    if (type === 'turn/start') setPhase({ kind: 'think', since: Date.now() })
    else if (type === 'tool/call') setPhase({ kind: 'tool', name: entry.event.data?.name })
    else if (type === 'tool/result') finishTool(entry.event.data?.name ?? entry.event.data?.toolName)
    else if (type === 'turn/end') setPhase({ kind: 'idle' })
  }

  /* 主对话视图已经持有这个会话，这里只借它的 binding 看事件窗口（同 progress-cards.ts），不另外占用会话。 */
  let watchedSource: Observable<any> | null = null
  const attach = (id: string): (() => void) | null => {
    let binding: any = null
    try { binding = sessions.binding(id) } catch {}
    const source = binding?.eventSource as Observable<any> | undefined
    if (!source || typeof source.subscribe !== 'function') return null
    watchedSource = source
    let lastRevision = source.getSnapshot()?.revision
    const stop = source.subscribe(() => {
      const snap = source.getSnapshot()
      if (!snap || snap.revision === lastRevision) return
      lastRevision = snap.revision
      const change = snap.change
      if (change?.kind === 'append') for (const entry of change.entries ?? []) handleEntry(entry)
    })
    return () => { stop(); if (watchedSource === source) watchedSource = null }
  }

  const syncStatus = () => {
    if (disposed) return
    const status = uiSession.sessionStatus.getSnapshot()
    let mainId: string | null = null, mainRunning = false
    for (const [id, s] of [...(status ?? [])] as [string, any][]) {
      let mainView = 0
      try { mainView = sessions.retainInfo(id).getSnapshot().retainedBy.mainView ?? 0 } catch {}
      if (!(mainView > 0)) continue
      if (!mainId || s?.running) { mainId = id; mainRunning = !!s?.running }
      if (mainRunning) break
    }
    if (mainId !== watchedId || (mainId && !detach)) {
      if (mainId !== watchedId) phase = { kind: 'idle' }
      detach?.(); detach = null; watchedId = mainId
      if (mainId) detach = attach(mainId)
    }
    if (mainRunning && !running) phase = { kind: 'think', since: Date.now() }
    if (!mainRunning) phase = { kind: 'idle' }
    running = mainRunning
    recompute()
  }

  const offStatus = uiSession.sessionStatus.subscribe(syncStatus)
  const offPending = uiSession.pendingInteractions?.subscribe(recompute)
  const timer = setInterval(() => { if (running) recompute() }, 2000)
  syncStatus()
  return () => { disposed = true; offStatus(); offPending?.(); clearInterval(timer); detach?.(); publish(null) }
}

/* ── 显示：顶栏小字 + 对话里的运行行 ── */
const HEAD_IDLE = 'Conversation'
const DURATION = /(\d+\s*(?:小时|分钟?|秒|h|m|s)(?:\s*\d+\s*(?:分钟?|秒|m|s))*)/

export const TURN_STATUS_CSS = `
[data-dot-turn-status="live"] { font-style: normal !important; letter-spacing: .02em; opacity: .92; }
`

function headSubtitles(root: Document): HTMLElement[] {
  const out: HTMLElement[] = []
  root.querySelectorAll('b').forEach(b => {
    if (b.textContent?.trim() !== '对话空间') return
    const i = b.nextElementSibling
    if (i && i.tagName === 'I') out.push(i as HTMLElement)
  })
  return out
}

function setText(el: Element, text: string) {
  const node = [...el.childNodes].find(n => n.nodeType === 3)
  if (node) { if (node.nodeValue !== text) node.nodeValue = text }
  else el.textContent = text
}

/** dots=false（简洁版）：运行行末尾不加「 ···」，在干活由样式里的呼吸点表示。 */
export function installTurnStatusDisplay(root: Document = document, options: { dots?: boolean } = {}): () => void {
  const dots = options.dots ?? true
  const win = root.defaultView
  if (!win?.MutationObserver || !root.body) return () => {}
  let applying = false
  const lastDuration = new WeakMap<Element, string>()
  const apply = () => {
    if (applying) return
    applying = true
    try {
      const status = turnStatus.get()
      for (const i of headSubtitles(root)) {
        setText(i, status ?? HEAD_IDLE)
        if (status) i.setAttribute('data-dot-turn-status', 'live'); else i.removeAttribute('data-dot-turn-status')
      }
      root.querySelectorAll('[data-chat-running]').forEach(row => {
        if (row.getAttribute('data-chat-running') === 'false') return
        /* 用时只写在 DSH 的发光层属性里（“……，用时 4秒 ···”），每秒更新；从整行的文字和属性里取最新的一个。 */
        const sources = [
          ...[...row.querySelectorAll('[data-shimmer-text]')].map(e => e.getAttribute('data-shimmer-text') ?? ''),
          row.textContent ?? '',
        ]
        let duration: string | undefined
        for (const s of sources) {
          const m = s.match(DURATION)?.[1]?.replace(/\s+/g, '')
          if (m) { duration = m; break }
        }
        if (duration) lastDuration.set(row, duration); else duration = lastDuration.get(row)
        const label = status ?? '正在想'
        const text = `${label}${duration ? ` · ${duration}` : ''}`
        /* 读屏用的状态区只报状态，不报秒数，免得每秒念一次 */
        row.querySelectorAll('[role=status]').forEach(s => { if (s.textContent !== label) setText(s, label) })
        row.querySelectorAll('[data-shimmer]').forEach(shimmer => {
          const span = shimmer.querySelector('span') ?? shimmer
          if ((span.textContent ?? '') !== text) setText(span, text)
        })
        row.querySelectorAll('[data-shimmer-text]').forEach(e => {
          const want = e.hasAttribute('data-shimmer') || !dots ? text : `${text} ···`
          if (e.getAttribute('data-shimmer-text') !== want) e.setAttribute('data-shimmer-text', want)
        })
      })
    } finally { applying = false }
  }
  const observer = new win.MutationObserver(records => {
    if (applying) return
    for (const r of records) {
      const el = r.target instanceof Element ? r.target : r.target.parentElement
      if (el?.closest('[data-chat-running]') || r.addedNodes.length) { apply(); return }
    }
  })
  observer.observe(root.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-shimmer-text'] })
  const off = turnStatus.subscribe(apply)
  apply()
  return () => { observer.disconnect(); off() }
}
