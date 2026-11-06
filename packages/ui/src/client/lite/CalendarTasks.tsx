import { useState, type ReactElement } from 'react'
import { createCalendarTask, dayKeyOf, setCalendarTaskStatus, type CalTask, type CalTasks } from './calendar.ts'
import css from './calendar-todo.module.css'

type Mutate = (task: CalTask, status: 'done' | 'pending', operationId: string) => Promise<CalTask>
type Create = (title: string, operationId: string) => Promise<CalTask>
export type TaskState = { status: 'loading' } | { status: 'error'; message: string } | ({ status: 'ready' } & CalTasks)
const operation = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`

export function CalendarTasks({ state, setState, retry, now, update = setCalendarTaskStatus, create = createCalendarTask }: {
  state: TaskState; setState(value: TaskState): void; retry(): void; now: number; update?: Mutate; create?: Create
}): ReactElement {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const tasks = state.status === 'ready' ? state.items.filter(task => task.status !== 'canceled') : []
  const change = async (task: CalTask) => {
    if (state.status !== 'ready') return
    setBusy(task.id); setError('')
    try {
      const updated = await update(task, task.status === 'done' ? 'pending' : 'done', operation())
      setState({ ...state, items: state.items.map(item => item.id === task.id ? updated : item) })
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy('') }
  }
  const add = async () => {
    if (state.status !== 'ready' || !title.trim()) return
    setBusy('new'); setError('')
    try { const item = await create(title.trim(), operation()); setState({ ...state, items: [item, ...state.items] }); setTitle(''); setAdding(false) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy('') }
  }
  return <section className={css.tasks} aria-label="待办" data-calendar-tasks="">
    <header className={css.head}><h2>待办 {state.status === 'ready' ? tasks.length : ''}</h2>{state.status === 'ready' && <button type="button" onClick={() => setAdding(!adding)}>{adding ? '取消' : '＋ 新增待办'}</button>}</header>
    {adding && <form className={css.create} onSubmit={e => { e.preventDefault(); void add() }}><input aria-label="待办内容" value={title} onChange={e => setTitle(e.target.value)} placeholder="要做什么？" maxLength={500} /><button disabled={Boolean(busy) || !title.trim()}>添加</button></form>}
    {state.status === 'loading' && <p className={css.note}>正在读取待办…</p>}
    {state.status === 'error' && <p className={css.error} role="alert">读取待办失败：{state.message} <button className={css.retry} onClick={retry}>重试</button></p>}
    {error && <p className={css.error} role="alert">{error}</p>}
    {state.status === 'ready' && tasks.length === 0 && <p className={css.note}>还没有待办。</p>}
    {tasks.length > 0 && <ul className={css.list}>{tasks.map(task => <li key={task.id} className={css.item}>
      <label className={css.checkHit}><input type="checkbox" className={css.check} aria-label={`${task.status === 'done' ? '重新打开' : '完成'}：${task.title}`} checked={task.status === 'done'} disabled={Boolean(busy)} onChange={() => void change(task)} /><svg className={css.tick} viewBox="0 0 20 20" aria-hidden="true"><path d="m4.5 10 3.5 3.5 7.5-8" pathLength="1" /></svg></label>
      <span className={css.body} data-done={task.status === 'done' ? '' : undefined}><span>{task.title}</span>{task.dueAt && <span className={css.due} data-near={task.status !== 'done' && Date.parse(task.dueAt) - now <= 86_400_000 ? '' : undefined}>{dueLabel(task.dueAt, now)}</span>}</span>
    </li>)}</ul>}
    {state.status === 'ready' && state.truncated && <p className={css.note}>待办较多，目前只显示前 500 条。</p>}
  </section>
}
function dueLabel(value: string, now: number): string {
  const day = dayKeyOf(value); if (!day) return ''
  const d = new Date(Date.parse(value) + 8 * 3_600_000)
  const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
  return `${day === dayKeyOf(now) ? '今天' : `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`} ${time} 前`
}
