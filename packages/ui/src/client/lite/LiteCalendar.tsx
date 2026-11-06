/* ================================================================
   简洁版 · 日程页正文（2026-11-01 calendar）
   ◍ 月格子（周一开头）：有日程的日子下面最多 3 个小圆点，颜色按日程稳定分配；今天用强调色圈出；
     点一天，下面列出这天的日程（时间、标题、地点、提醒）；没有就写「这天没有安排」。
   ◍ 只读：数据来自 calendar.ts 的 loadMonthEvents（/dot-zhixu/api/events）。这里没有任何写入口；
     要加/改日程，在对话里跟 Xtcausal dot 说。
   ◍ 顶栏由 LiteShell 的 CalendarPage 给，这里只管正文，方便单测。
   ================================================================ */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type TouchEvent } from 'react'
import { WEEKDAYS, dayKeyOf, dayLabel, dotsOf, groupByDay, hueOf, loadMonthEvents, monthGrid, monthKey, monthLabel, monthOf, shiftMonth, timeLabel, type CalEvent, type MonthRef } from './calendar.ts'
import { CalendarTasks, type TaskState } from './CalendarTasks.tsx'
import { loadCalendarTasks, taskDots, type CalTasks } from './calendar.ts'
import css from './lite.module.css'
import taskCss from './calendar-todo.module.css'

type Loader = (ref: MonthRef) => Promise<{ items: CalEvent[]; truncated: boolean }>
type MonthState = { status: 'loading' } | { status: 'ready'; items: CalEvent[]; truncated: boolean } | { status: 'error'; message: string }

export type MonthCache = Record<string, Extract<MonthState, { status: 'ready' }>>

export function LiteCalendar({ monthCache, now = Date.now(), load = loadMonthEvents, loadTasks = loadCalendarTasks }: { monthCache?: MonthCache; now?: number; load?: Loader; loadTasks?: () => Promise<CalTasks> }): ReactElement {
  const today = dayKeyOf(now)
  const [month, setMonth] = useState<MonthRef>(() => monthOf(now))
  const [selected, setSelected] = useState(today)
  const [cache, setCache] = useState<Record<string, MonthState>>(() => ({ ...monthCache }))
  const [attempt, setAttempt] = useState(0)
  const [taskState, setTaskState] = useState<TaskState>({ status: 'loading' })
  const [taskAttempt, setTaskAttempt] = useState(0)
  useEffect(() => {
    let alive = true; setTaskState({ status: 'loading' })
    loadTasks().then(result => { if (alive) setTaskState({ status: 'ready', ...result }) }).catch(cause => { if (alive) setTaskState({ status: 'error', message: cause instanceof Error ? cause.message : String(cause) }) })
    return () => { alive = false }
  }, [taskAttempt])
  const key = monthKey(month)
  const state: MonthState = cache[key] ?? { status: 'loading' }

  const grid = useRef<HTMLDivElement>(null)
  const swipe = useRef<{ id: number; x: number; y: number } | null>(null)
  const agenda = useRef<HTMLElement>(null)
  const last = useRef({ key, selected })
  useLayoutEffect(() => {
    const previous = last.current
    last.current = { key, selected }
    if (previous.selected === selected && previous.key === key) return
    if (!grid.current?.animate || grid.current.closest('[data-reduced-motion="true"]') || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const flip = previous.key !== key ? grid.current.animate([
      { transform: `translateX(${key > previous.key ? 30 : -30}px)`, opacity: .45 },
      { transform: 'translateX(0)', opacity: 1 },
    ], { duration: 560, easing: 'cubic-bezier(.28,.55,.26,1)' }) : undefined
    const changeDay = agenda.current?.animate([
      { transform: 'translateY(5px)', opacity: .48 }, { transform: 'translateY(0)', opacity: 1 },
    ], { duration: 380, easing: 'ease-out' })
    return () => { flip?.cancel(); changeDay?.cancel() }
  }, [key, selected])

  useEffect(() => {
    let alive = true
    setCache(current => ({ ...current, [key]: current[key]?.status === 'ready' ? current[key]! : { status: 'loading' } }))
    load(month)
      .then(result => {
        if (!alive) return
        const ready = { status: 'ready' as const, ...result }
        if (monthCache) monthCache[key] = ready
        setCache(current => ({ ...current, [key]: ready }))
      })
      .catch(cause => { if (alive) setCache(current => ({ ...current, [key]: { status: 'error', message: cause instanceof Error ? cause.message : String(cause) } })) })
    return () => { alive = false }
  }, [key, attempt])

  const cells = useMemo(() => monthGrid(month), [key])
  const days = useMemo(() => groupByDay(state.status === 'ready' ? state.items : []), [state])
  const move = (delta: number) => {
    const next = shiftMonth(month, delta)
    setMonth(next)
    /* 换月后默认选那个月的 1 号；回到本月选今天。 */
    setSelected(monthKey(next) === today.slice(0, 7) ? today : `${monthKey(next)}-01`)
  }
  const startSwipe = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0]
    swipe.current = event.touches.length === 1 && touch
      ? { id: touch.identifier, x: touch.clientX, y: touch.clientY } : null
  }
  const endSwipe = (event: TouchEvent<HTMLDivElement>) => {
    const start = swipe.current
    swipe.current = null
    const touch = event.changedTouches[0]
    if (!start || !touch || event.touches.length || touch.identifier !== start.id) return
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.4) return
    event.preventDefault() // 翻月后不再把手指落点当成点选日期。
    move(dx < 0 ? 1 : -1)
  }
  const pick = (cellKey: string) => {
    setSelected(cellKey)
    if (cellKey.slice(0, 7) !== key) setMonth({ year: Number(cellKey.slice(0, 4)), month: Number(cellKey.slice(5, 7)) })
  }
  const list = days.get(selected) ?? []
  const tasks = taskState.status === 'ready' ? taskState.items : []
  const reminders = [
    ...(state.status === 'ready' ? state.items.filter(event => event.status !== 'canceled' && event.remindAt && dayKeyOf(event.remindAt) === selected).map(event => ({ id: `e:${event.id}`, title: event.title, at: event.remindAt! })) : []),
    ...tasks.filter(task => task.status !== 'done' && task.status !== 'canceled' && task.remindAt && dayKeyOf(task.remindAt) === selected).map(task => ({ id: `t:${task.id}`, title: task.title, at: task.remindAt })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  /* 本月（不含上下月补位）有几项安排：跨天的只算一项。 */
  const monthCount = useMemo(() => { const ids = new Set<string>(); for (const [k, v] of days) if (k.startsWith(key)) for (const e of v) ids.add(e.id); return ids.size }, [days, key])

  return <div className={css.scroll} data-lite-calendar="" data-month={key}>
    <div className={taskCss.monthCard}><div className={css.calHead}>
      <div className={css.calTitle}><b>{monthLabel(month)}</b><span role="status">{state.status === 'loading' ? '正在读取…' : state.status === 'error' ? '没读到' : monthCount ? `${monthCount} 项安排` : '本月没有安排'}</span></div>
      <button className={css.icon} aria-label="上个月" onClick={() => move(-1)}><Arrow dir="left" /></button>
      <button className={css.icon} aria-label="下个月" onClick={() => move(1)}><Arrow dir="right" /></button>
    </div>
    <div className={css.calWeek} aria-hidden="true">{WEEKDAYS.map(day => <span key={day}>{day}</span>)}</div>
    <div ref={grid} className={css.calGrid} role="grid" aria-label={monthLabel(month)}
      onTouchStart={startSwipe} onTouchEnd={endSwipe} onTouchCancel={() => { swipe.current = null }}>
      {cells.map(cell => {
        const dots = dotsOf(days.get(cell.key))
        const reminderCount = (state.status === 'ready' ? state.items.filter(event => event.status !== 'canceled' && event.remindAt && dayKeyOf(event.remindAt) === cell.key).length : 0) + tasks.filter(task => task.status !== 'done' && task.status !== 'canceled' && task.remindAt && dayKeyOf(task.remindAt) === cell.key).length
        const taskMarks = [...taskDots(tasks, cell.key, now), ...Array<'reminder'>(reminderCount).fill('reminder')].slice(0, Math.max(0, 3 - dots.length))
        const count = days.get(cell.key)?.length ?? 0
        return <button key={cell.key} role="gridcell" className={css.calDay} data-day={cell.key} data-out={cell.inMonth ? undefined : ''} data-today={cell.key === today ? '' : undefined}
          aria-selected={cell.key === selected} aria-label={`${dayLabel(cell.key)}${cell.key === today ? '，今天' : ''}${count ? `，${count} 项安排` : ''}`} onClick={() => pick(cell.key)}>
          <span className={css.calNum}>{cell.day}</span>
          <span className={css.calDots} aria-hidden="true">{dots.map((hue, index) => <i key={index} data-hue={hue} />)}{taskMarks.map((tone, index) => <i key={`t${index}`} className={taskCss.dot} data-tone={tone} />)}</span>
        </button>
      })}
    </div>
    <div className={taskCss.legend}><span><i />日程</span><span><i data-tone="due" />待办快到期</span><span><i data-tone="reminder" />提醒</span><span><i data-tone="done" />已完成</span></div></div>
    {reminders.length > 0 && <section className={taskCss.reminders} aria-label="这天的提醒"><h2>提醒</h2>{reminders.map(item => <p key={item.id}>{remindLabel(item.at, selected)} · {item.title}</p>)}</section>}
    <section ref={agenda} className={css.calList} aria-label={`${dayLabel(selected)} 的安排`} data-lite-day={selected}>
      <header className={css.groupHead}><h2>{dayLabel(selected)}{selected === today ? ' · 今天' : ''}</h2></header>
      {state.status === 'error'
        ? <div className={css.calError} role="alert"><span>读不到日程：{state.message}</span><button className={css.textButton} onClick={() => setAttempt(n => n + 1)}>重试</button></div>
        : state.status === 'loading' && !list.length
          ? <p className={css.hint}>正在读取…</p>
          : !list.length
            ? <p className={css.calEmpty}>这天没有安排</p>
            : <ol className={css.calEvents}>{list.map(event => <li key={event.id} className={css.calEvent} data-hue={hueOf(event)}>
                <time>{timeLabel(event, selected)}</time>
                <span className={css.lineText}>
                  <b>{event.title}</b>
                  {(event.location || event.remindAt) && <span>{[event.location, event.remindAt ? `提醒 ${remindLabel(event.remindAt, selected)}` : ''].filter(Boolean).join(' · ')}</span>}
                </span>
              </li>)}</ol>}
      {state.status === 'ready' && state.truncated && <p className={css.hint}>这个月日程太多，只显示了前 500 条。</p>}
    </section>
    <CalendarTasks state={taskState} setState={setTaskState} retry={() => setTaskAttempt(n => n + 1)} now={now} />
  </div>
}

function remindLabel(iso: string, key: string): string {
  const day = dayKeyOf(iso)
  const time = timeLabel({ id: '', title: '', start: iso, end: iso }, day)
  return day === key ? time : `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日 ${time}`
}

function Arrow({ dir }: { dir: 'left' | 'right' }): ReactElement {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={css.glyph}><path d={dir === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} /></svg>
}
