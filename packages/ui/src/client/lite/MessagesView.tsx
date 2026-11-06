import { useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import type { LetterRow } from '../model.ts'
import type { LoggedNotice } from './notice-log.ts'
import { deliveryFailed } from '../postbox-letters.ts'
import { useTabMarker } from './use-tab-marker.ts'
import css from './messages.module.css'

type Category = 'attention' | 'proactive' | 'work' | 'system'
type Filter = 'all' | 'archived' | Category
export type MessageEntry = { key: string; title: string; text: string; at: number; read: boolean; category: Category; tone: 'attention' | 'failed' | 'done' | 'proactive' | 'system'; workId?: string; letter?: LetterRow; notice?: LoggedNotice }

/** 仅按事件真实字段分类；旧本机记录不属于可验证账号，不参与消息流。 */
export function messageEntries(letters: readonly LetterRow[], notices: readonly LoggedNotice[], archived = false): MessageEntry[] {
  const list: MessageEntry[] = []
  /* 待办同步信属于日程与待办；独立到点提醒仍留在消息流。 */
  const activeLetters = letters.filter(letter => letter.archived === archived && !letter.id.startsWith('zhixu-task:'))
  for (const letter of activeLetters) {
    const attention = letter.kind === 'work-blocked' || letter.kind === 'work-waiting-approval'
    const proactive = letter.proactive || letter.kind === 'reminder'
    const work = Boolean(letter.workId) || (letter.kind ?? '').startsWith('work-')
    const failed = letter.kind === 'work-failed' || deliveryFailed(letter.delivery)
    const at = letter.at ?? Date.parse(letter.createdAt)
    list.push({ key: `letter:${letter.id}`, title: letter.title, text: letter.body, at: Number.isFinite(at) ? at : 0, read: letter.read, category: attention ? 'attention' : proactive ? 'proactive' : work ? 'work' : 'system', tone: attention ? 'attention' : proactive ? 'proactive' : failed ? 'failed' : work ? 'done' : 'system', ...(letter.workId ? { workId: letter.workId } : {}), letter })
  }
  for (const notice of archived ? [] : notices) {
    if (notice.postboxId && letters.some(letter => letter.id === notice.postboxId)) continue
    const attention = notice.tone === 'attention' || notice.kind !== 'info'
    const proactive = notice.tone === 'reminder'
    list.push({ key: `notice:${notice.key}`, title: notice.title, text: notice.text ?? '', at: notice.at, read: notice.read, category: attention ? 'attention' : proactive ? 'proactive' : notice.workId ? 'work' : 'system', tone: attention ? 'attention' : proactive ? 'proactive' : notice.tone === 'failed' ? 'failed' : notice.workId ? 'done' : 'system', ...(notice.workId ? { workId: notice.workId } : {}), notice })
  }
  return list.sort((a, b) => b.at - a.at)
}
/** 实际工作已向前推进，且状态更新时间晚于这条等待消息时，才能自动标读。 */
export function handledAttentionIds(letters: readonly LetterRow[], works: readonly { id: string; status: string; updatedAt: string }[]): string[] {
  return letters.filter(letter => !letter.read && !letter.archived && letter.workId && (letter.kind === 'work-blocked' || letter.kind === 'work-waiting-approval') && letter.at && works.some(work => work.id === letter.workId && ['running', 'queued', 'succeeded', 'completed'].includes(work.status) && Date.parse(work.updatedAt) >= letter.at!)).map(letter => letter.id)
}
const BJ = 'Asia/Shanghai'
const dayOf = (at: number) => at ? new Intl.DateTimeFormat('en-CA', { timeZone: BJ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at) : ''
function dayLabel(at: number, now: number): string {
  if (!at) return '更早'
  const day = dayOf(at)
  const label = new Intl.DateTimeFormat('zh-CN', { timeZone: BJ, month: 'long', day: 'numeric' }).format(at)
  return `${day === dayOf(now) ? '今天 · ' : day === dayOf(now - 86400000) ? '昨天 · ' : ''}${label}`
}
const timeOf = (at: number) => at ? new Intl.DateTimeFormat('zh-CN', { timeZone: BJ, hour: '2-digit', minute: '2-digit', hour12: false }).format(at) : ''
const categoryLabel: Record<Category, string> = { attention: '要你处理', proactive: '主动', work: '工作', system: '系统' }
const glyph = { attention: '!', proactive: '✧', failed: '×', done: '✓', system: 'i' }

function LetterBody({ open, children }: { open: boolean; children: ReactNode }): ReactElement {
  const [keep, setKeep] = useState(open)
  const fold = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (fold.current) fold.current.inert = !open
    if (open) { setKeep(true); return }
    if (!keep) return
    const timer = window.setTimeout(() => setKeep(false), 260)
    return () => window.clearTimeout(timer)
  }, [open, keep])
  return <div ref={fold} className={css.letterFold} aria-hidden={!open}><div className={css.clip}>{(open || keep) && children}</div></div>
}

export function MessagesView({ letters, notices, loading, selectedNoticeId, now = Date.now(), onOpen, onRead, onReadAll, onArchive, onRetry, hideReadAll = false }: {
  letters: readonly LetterRow[]; notices: readonly LoggedNotice[]; loading: boolean; selectedNoticeId?: string | null; now?: number
  onOpen(entry: MessageEntry): void; onRead(entry: MessageEntry): void; onReadAll(entries: readonly MessageEntry[]): Promise<string | void>
  onArchive(letter: LetterRow): Promise<void>; onRetry(letter: LetterRow): Promise<void>; hideReadAll?: boolean
}): ReactElement {
  const [filter, setFilter] = useState<Filter>('all')
  const tabs = useTabMarker(filter)
  const list = useRef<HTMLDivElement>(null)
  const previous = useRef(filter)
  useLayoutEffect(() => {
    if (previous.current === filter) return
    previous.current = filter
    const node = list.current
    if (!node?.animate || node.closest('[data-reduced-motion="true"]') || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const motion = node.animate([{ opacity: .45 }, { opacity: 1 }], { duration: 270, easing: 'ease-out' })
    return () => motion.cancel()
  }, [filter])
  const [opened, setOpened] = useState('')
  useEffect(() => {
    if (!opened) return
    const dismiss = (e: KeyboardEvent) => {
      const node = list.current
      if (e.key !== 'Escape' || !node?.getClientRects().length || node.closest('[inert]')) return
      if (document.querySelector('[role="dialog"]:not([inert])')) return
      const trigger = node.querySelector<HTMLButtonElement>('button[aria-expanded="true"]')
      if (!trigger) return
      e.preventDefault()
      e.stopImmediatePropagation()
      setOpened('')
      trigger.focus({ preventScroll: true })
    }
    window.addEventListener('keydown', dismiss, true)
    return () => window.removeEventListener('keydown', dismiss, true)
  }, [opened])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const selectedHandled = useRef('')
  useEffect(() => {
    if (!selectedNoticeId) { selectedHandled.current = ''; return }
    if (selectedHandled.current !== selectedNoticeId && letters.some(letter => letter.id === selectedNoticeId)) { selectedHandled.current = selectedNoticeId; setOpened(`letter:${selectedNoticeId}`) }
  }, [selectedNoticeId, letters])
  const entries = messageEntries(letters, notices)
  const unread = entries.filter(entry => !entry.read)
  const count = entries.filter(entry => entry.category === 'attention' && !entry.read).length
  const filtered = filter === 'archived' ? messageEntries(letters, [], true) : entries.filter(entry => filter === 'all' || entry.category === filter)
  const groups = new Map<string, MessageEntry[]>()
  for (const entry of filtered) { const key = dayOf(entry.at); const rows = groups.get(key) ?? []; rows.push(entry); groups.set(key, rows) }
  const action = async (run: () => Promise<unknown>) => { setBusy(true); setError(''); try { const result = await run(); if (typeof result === 'string') setError(result) } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败，请重试') } finally { setBusy(false) } }
  const toggle = (entry: MessageEntry) => {
    if (!entry.read && !entry.letter?.todo) onRead(entry)
    if (entry.workId) { onOpen(entry); return }
    if (entry.notice?.kind === 'input') onOpen(entry)
    setOpened(current => current === entry.key ? '' : entry.key)
  }
  return <>
    <div className={css.tools}><div ref={tabs} className={css.filters} role="tablist" aria-label="消息分类">
      <span className={css.marker} aria-hidden="true" />
      {([['all', '全部'], ['attention', `要你处理${count ? ` ${count}` : ''}`], ['proactive', '主动'], ['work', '工作'], ['system', '系统'], ['archived', '已归档']] as const).map(([key, label]) => <button type="button" key={key} role="tab" aria-selected={filter === key} onClick={() => setFilter(key)}>{label}</button>)}
    </div>{!hideReadAll && <button type="button" className={css.readAll} disabled={busy || unread.length === 0} onClick={() => void action(() => onReadAll(unread))}>全部已读</button>}</div>
    <div ref={list} className={css.scroll}>
      {error && <p className={css.error} role="alert">{error}</p>}
      {!filtered.length && <p className={css.empty}>{loading ? '正在读取消息…' : '这里还没有消息。'}</p>}
      {[...groups.entries()].map(([key, rows]) => <section className={css.group} key={key}><h2>{dayLabel(rows[0]!.at, now)}</h2><div className={css.box}>
        {rows.map(entry => <article key={entry.key} className={css.item} data-tone={entry.tone} data-unread={!entry.read}>
          <button type="button" className={css.row} onClick={() => toggle(entry)} aria-expanded={!entry.workId ? opened === entry.key : undefined}>
            <span className={css.dot} aria-hidden="true" /><span className={css.icon} aria-hidden="true">{glyph[entry.tone]}</span><span className={css.content}><span className={css.head}><b>{entry.title}</b><time>{timeOf(entry.at)}</time></span>{entry.text && <span className={css.preview}>{entry.text}</span>}<span className={css.bottom}><em>{categoryLabel[entry.category]}</em>{entry.workId && <span>{entry.category === 'attention' ? '去处理' : '看任务'} ›</span>}</span></span>
          </button>
          {entry.workId && entry.letter && <button type="button" className={css.expand} aria-expanded={opened === entry.key} onClick={() => { if (opened !== entry.key && !entry.read && !entry.letter?.todo) onRead(entry); setOpened(current => current === entry.key ? '' : entry.key) }}>{opened === entry.key ? '收起信件' : '查看信件'}</button>}
          <LetterBody open={opened === entry.key}><div className={css.detail}><p>{entry.text}</p>{entry.letter?.todo?.progress && <p>{entry.letter.todo.progress}</p>}{entry.letter?.todo?.updates.map(update => <p key={update.id}><time>{update.at}</time> {update.title} {update.body}</p>)}<div className={css.actions}>
            {!entry.read && <button type="button" onClick={() => onRead(entry)}>标为已读</button>}
            {entry.letter && deliveryFailed(entry.letter.delivery) && <button type="button" disabled={busy} onClick={() => void action(() => onRetry(entry.letter!))}>重新投递</button>}
            {entry.letter && !entry.letter.archived && (!entry.letter.todo || entry.letter.todo.closed) && <button type="button" disabled={busy} onClick={() => void action(() => onArchive(entry.letter!))}>归档</button>}
          </div></div></LetterBody>
        </article>)}
      </div></section>)}
      <p className={css.foot}>进行中的工作在后台工作里看</p>
    </div>
  </>
}
