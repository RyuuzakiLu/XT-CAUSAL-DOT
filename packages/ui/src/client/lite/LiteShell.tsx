/* ================================================================
   DOT 简洁版外壳（2026-10-31）
   ◍ 用户原话：「简洁版我就要最简单的那种黑白配色的，但是要好看」、「功能都要保留」、
     「精灵不要了，换成传统的交互，但是不要底栏」。
   ◍ 只换界面层：数据（useDotData）、视图（useStore / navigate / actions）、联动运行时（live：
     工作卡 store、气泡队列、审批桥）、指令（command）全部照用经典版那一套，不另接后端。
   ◍ 结构：顶栏（菜单 · 标题 · 铃铛 · 本页动作）＋ 左侧抽屉。抽屉里是对话 / 日程 / 后台工作 / 星邮匣 /
     消息 / 记忆 / 设置、打电话、切回经典版。日程（2026-11-01）是知序日程的只读月历。没有底栏，没有精灵。
   ◍ 只有一个对话（2026-10-31 用户原话：「历史会话那个选项也去掉，所有会话只留在一个界面上」）：
     没有历史对话、没有新对话按钮；打开就是对话页，更早的会话都拼在上方，往上滚就能看到
     （打开哪个、拼哪些见 session-chain.ts 的 pickSingleSession / singleSessionBefore）。
     没有消息时也是对话页，输入栏在底部，没有欢迎页、没有鲸鱼。
   ◍ 名字和图标：显示名 Xtcausal dot、品牌 logo 都在 lite-brand.ts，这里不写死。
   ◍ 硬规矩：等你处理的事（审批 / 凭证填写 / 远程登录 / 补充）在对话页顶部一直有一条，
     对话流里的工作小卡、工作页、工作详情、顶部提醒里也都能直接答。
   ◍ 提醒：顶部 toast（同一个气泡队列）＋「你不在时」横幅；露出来过的都进「消息」列表。
   ================================================================ */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import type { DotProps } from '../DotShell.tsx'
import { installReplyMotion } from './reply-motion.ts'
import { installSendMotion } from './send-motion.ts'
import { installStickToBottom } from './stick-bottom.ts'
import { LINK_LABEL, useLinkLevel, type LinkLevel } from './link-status.ts'
import type { WorkRow, LetterRow, PlanRow, DataSnapshot, MemoryRow } from '../model.ts'
import type { WorkCard } from '../work-cards/work-card.ts'
import type { DotNotice } from '../notify/notices.ts'
import { openNoticeEntry } from '../notify/notices.ts'
import { markPostboxSeen, unseenLetterCount, usePostboxSeenAt } from '../notify/postbox-seen.ts'
import { CallOverlay } from '../call/CallOverlay.tsx'
import { deliveryFailed } from '../postbox-letters.ts'
import { readLitePrefs, writeLitePrefs, type LitePrefs } from './ui-mode.ts'
import { GENDER_OPTIONS, loadPersona, previewPersona, savePersona, type PersonaGender, type PersonaView } from '../persona/persona-api.ts'
import { noticeLog, type LoggedNotice } from './notice-log.ts'
import { LITE_NAME, liteIconUrl } from './lite-brand.ts'
import { LiteWorkCard, liteCardKind, liteCardLabel, liveWorkLine, viewOfCard, viewOfRow, type LiteCardView } from './LiteWorkCard.tsx'
import { LiteCalendar, type MonthCache } from './LiteCalendar.tsx'
import { MessagesView, handledAttentionIds, messageEntries, type MessageEntry } from './MessagesView.tsx'
import { LiteBoot } from './LiteBoot.tsx'
import { explainFailure } from './failure-reason.ts'
import { ensureViewportFitCover } from './safe-area.ts'
import { useTabMarker } from './use-tab-marker.ts'
import { WorkFilters, type WorkFilter } from './WorkFilters.tsx'
import workCss from './work-page.module.css'
import css from './lite.module.css'

export type LiteProps = DotProps & { renderSettings(): ReactNode }
type Tab = 'chat' | 'work' | 'postbox' | 'calendar' | 'notices' | 'memory' | 'me'
type Local = null | 'calendar' | 'notices' | 'memory' | 'me'

const noopSubscribe = () => () => {}
const EMPTY_CARDS = { cards: {}, order: [] as readonly string[] } as const

/* ---------- 小工具 ---------- */
function ago(value: string | number | undefined, now: number): string {
  const at = typeof value === 'number' ? value : value ? Date.parse(value) : NaN
  if (!Number.isFinite(at)) return ''
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 45) return '刚刚'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} 分钟前`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.round(h / 24)
  if (d < 7) return `${d} 天前`
  const date = new Date(at)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}
function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(timer) }, [ms])
  return now
}
const opId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`)

/** 工作状态 → 一个词 + 一类。类别决定语义颜色和圆点形状。 */
const STATUS: Record<string, { label: string; kind: 'attention' | 'active' | 'done' | 'failed' | 'idle' }> = {
  'waiting-approval': { label: '等你确认', kind: 'attention' },
  'waiting-input': { label: '等你处理', kind: 'attention' },
  queued: { label: '排队中', kind: 'active' },
  running: { label: '进行中', kind: 'active' },
  succeeded: { label: '已完成', kind: 'done' },
  completed: { label: '已完成', kind: 'done' },
  failed: { label: '没做成', kind: 'failed' },
  cancelled: { label: '已取消', kind: 'idle' },
  interrupted: { label: '被打断', kind: 'failed' },
}
const statusOf = (status: string) => STATUS[status] ?? { label: status || '未知', kind: 'idle' as const }

/** 工作列表的一行：实时卡片优先（推送最新），没有时用快照里的 WorkRow。 */
type Item = { id: string; title: string; status: string; doing: string; updatedAt: string; createdAt?: string | undefined; progress?: number | undefined; card?: WorkCard | undefined; row?: WorkRow | undefined }
export function mergeWorks(cards: Readonly<Record<string, WorkCard>>, order: readonly string[], rows: readonly WorkRow[]): Item[] {
  const byId = new Map<string, Item>()
  for (const row of rows) byId.set(row.id, { id: row.id, title: row.goal, status: row.status, doing: row.blocked?.message ?? row.stage, updatedAt: row.updatedAt, createdAt: row.createdAt, progress: row.progress, row })
  for (const id of order) {
    const card = cards[id]; if (!card) continue
    const row = byId.get(id)?.row
    const newer = !row || Date.parse(card.updatedAt) >= Date.parse(row.updatedAt)
    byId.set(id, newer
      ? { id, title: card.title || row?.goal || '后台工作', status: card.status, doing: card.attention?.message ?? card.doing ?? card.stage, updatedAt: card.updatedAt, createdAt: card.createdAt ?? row?.createdAt, progress: card.progress, card, row }
      : { ...byId.get(id)!, card })
  }
  return [...byId.values()].sort((a, b) => (Date.parse(b.createdAt || b.updatedAt) || 0) - (Date.parse(a.createdAt || a.updatedAt) || 0))
}
/** 「要你动手」：等确认 / 等处理的工作。 */
const attentionOf = (item: Item) => {
  if (!item.card) return item.row?.blocked
  if (!item.row || Date.parse(item.card.updatedAt) >= Date.parse(item.row.updatedAt)) return item.card.attention
  return item.row.blocked
}
export const needsYou = (item: Item) => item.status === 'waiting-approval' || item.status === 'waiting-input' || (item.status === 'running' && Boolean(attentionOf(item)?.action))

/* ---------- 图标：统一 1.6 线宽的线性图标，不用图片 ---------- */
const PATHS: Record<string, string> = {
  chat: 'M4 5.5h16v10H9l-5 4v-14z',
  work: 'M4 7.5h16v11H4zM9 7.5V5h6v2.5',
  mail: 'M3.5 6h17v12h-17zM3.5 6l8.5 7 8.5-7',
  me: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5',
  plus: 'M12 5v14M5 12h14',
  history: 'M4 12a8 8 0 1 0 2.4-5.7M4 4.5v3.8h3.8M12 8v4.5l3 2',
  back: 'M15 5l-7 7 7 7',
  more: 'M5 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM19 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
  close: 'M6 6l12 12M18 6L6 18',
  chevron: 'M9 6l6 6-6 6',
  phone: 'M7 3.5h3l1.5 4-2 1.2a10 10 0 0 0 5.8 5.8l1.2-2 4 1.5v3A2 2 0 0 1 18.5 19 15.5 15.5 0 0 1 5 5.5 2 2 0 0 1 7 3.5z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  open: 'M14 5h5v5M19 5l-8 8M18 14v5H5V6h5',
  menu: 'M4 7h16M4 12h16M4 17h10',
  bell: 'M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5h4',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  memory: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4l3 2',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8',
  box: 'M4 7.5h16v11H4zM9 7.5V5h6v2.5',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  swap: 'M7 7h12l-3-3M17 17H5l3 3',
  calendar: 'M4.5 6h15v13.5h-15zM4.5 10h15M8.5 4v4M15.5 4v4',
}
function Glyph({ name }: { name: keyof typeof PATHS | string }): ReactElement {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={css.glyph}><path d={PATHS[name] ?? ''} /></svg>
}

/* ================================================================ */
export function LiteShell(props: LiteProps): ReactElement {
  const view = props.useStore(value => value)
  const data = props.useDotData(value => value)
  const live = props.live
  const [prefs, setPrefsState] = useState<LitePrefs>(readLitePrefs)
  const setPrefs = (patch: Partial<LitePrefs>) => setPrefsState(current => { const next = { ...current, ...patch }; writeLitePrefs(next); return next })
  /* 不对应经典版房间的页（消息 / 记忆 / 设置）只在简洁版里记，房间变了就离开。 */
  const [local, setLocal] = useState<Local>(null)
  const [drawer, setDrawer] = useState(false)
  const [sheet, setSheet] = useState<null | 'create'>(null)
  /* 抽屉里点「要你处理 / 进行中 / 已完成」：进后台工作页并滚到那一组。 */
  const [workFocus, setWorkFocus] = useState<WorkGroup | null>(null)
  const personal = useSyncExternalStore(props.personalSettings?.subscribe ?? noopSubscribe, props.personalSettings?.getSnapshot ?? (() => null))
  const store = useSyncExternalStore(live?.store.subscribe ?? noopSubscribe, live?.store.getSnapshot ?? (() => EMPTY_CARDS))
  const items = useMemo(() => mergeWorks(store.cards, store.order, data.works), [store, data.works])
  const waiting = items.filter(needsYou)
  const running = items.filter(item => !needsYou(item) && statusOf(item.status).kind === 'active')
  const finished = items.filter(item => !needsYou(item) && statusOf(item.status).kind !== 'active')
  const seenAt = usePostboxSeenAt()
  const unseen = unseenLetterCount(data.letters, seenAt)
  const transientNotices = useSyncExternalStore(noticeLog.subscribe, noticeLog.get)
  const unreadNotices = messageEntries(data.letters, transientNotices).filter(entry => !entry.read).length

  /* 经典版的首页是「书房」；简洁版首页就是对话。书房/下线房间一律送到对话（两边取的数据域一样）。 */
  useEffect(() => { if (view.space !== 'conversation' && view.space !== 'work' && view.space !== 'postbox') props.navigate('conversation') }, [view.space])
  /* 房间变了（点了工作卡、提醒、返回键）就离开本地页，并收起抽屉。 */
  useEffect(() => { setLocal(null); setDrawer(false) }, [view.space])
  useEffect(() => {
    setLocal(current => current === 'notices' ? current : null)
    setDrawer(false)
  }, [view.card])
  const tab: Tab = local ?? (view.space === 'work' ? 'work' : view.space === 'postbox' ? 'postbox' : 'chat')
  const go = (next: Tab) => {
    setSheet(null); setDrawer(false)
    if (next === 'me' || next === 'notices' || next === 'memory' || next === 'calendar') { setLocal(next); return }
    setLocal(null)
    const space = next === 'chat' ? 'conversation' : next
    if (view.space !== space) props.navigate(space)
    if (view.card) props.actions.openCard(null)
  }

  /* 主题：浅色（默认）/ 深色 / 跟随系统。浏览器顶栏颜色也跟着变。 */
  const systemDark = useSyncExternalStore(subscribeScheme, () => matchMedia('(prefers-color-scheme: dark)').matches)
  const theme: 'light' | 'dark' = prefs.theme === 'auto' ? (systemDark ? 'dark' : 'light') : prefs.theme
  useLayoutEffect(() => {
    let meta = document.querySelector('meta[name=theme-color]')
    if (!meta) { meta = document.createElement('meta'); meta.setAttribute('name', 'theme-color'); document.head.append(meta) }
    meta.setAttribute('content', theme === 'dark' ? '#0E1018' : '#F8F9FC')
    document.documentElement.style.colorScheme = theme
    document.documentElement.dataset.liteTheme = theme
    /* 原生组件（代码块、菜单）跟着走：浅色时去掉 index.ts 默认挂的深色标记。 */
    if (theme === 'dark') document.body.setAttribute('data-ds-dark-theme', '')
    else document.body.removeAttribute('data-ds-dark-theme')
  }, [theme])
  /* 手机底部手势条 / 刘海：让 env(safe-area-inset-*) 生效（安卓壳另注入 --dot-inset-*，见 safe-area.ts）。 */
  useEffect(() => { ensureViewportFitCover() }, [])
  /* 抽屉开着时按 Esc 收起。 */
  useEffect(() => {
    if (!drawer) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setDrawer(false) } }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [drawer])

  /* 截图验收用：地址带 liteqa 时把运行时挂到 window，只在本页内存里塞假卡，不碰服务端。 */
  useEffect(() => { if (live && /[?&]liteqa\b/.test(location.search)) (window as unknown as { __dotLiteQa?: unknown }).__dotLiteQa = { live, noticeLog } }, [live])

  const goWork = (group: WorkGroup) => { setWorkFocus(group); go('work') }
  const ctx: Ctx = { props, data, live, items, waiting, running, finished, unseen, unreadNotices, prefs, setPrefs, theme, tab, go, goWork, workFocus, clearWorkFocus: () => setWorkFocus(null), setSheet, openDrawer: () => setDrawer(true) }
  return <div className={css.lite} data-theme={theme} data-tab={tab} data-reduced-motion={view.reducedMotion}>
    <LiteBoot ready={(data.connected && !data.loading) || Boolean(data.error)} reducedMotion={view.reducedMotion} onStart={() => go('chat')} />
    {live && <NoticeRecorder live={live} />}
    {data.error && <div role="alert" className={css.alert}><span>{data.error}</span><button onClick={() => void props.refresh()}>重试</button></div>}
    {view.nativePanel
      ? <section className={css.page}>
          <header className={css.top}><button className={css.icon} aria-label="返回" onClick={props.back}><Glyph name="back" /></button><div className={css.heading}><h1 className={css.title}>对话工具</h1></div><span className={css.iconSpacer} /></header>
          <div className={css.native}>{props.renderSlot('main', {}, { entryKey: view.nativePanel })}</div>
        </section>
      : <MainPages ctx={ctx} reducedMotion={view.reducedMotion} />}
    {live && <Toasts ctx={ctx} />}
    <Drawer ctx={ctx} open={drawer} close={() => setDrawer(false)} />
    {sheet === 'create' && <CreateSheet ctx={ctx} />}
    <WorkDetailPresence ctx={ctx} id={view.card} reduced={view.reducedMotion} />
    <div className={css.nativePanel} hidden={!view.rightbar}>
      <button onClick={() => props.actions.rightbar(false)}>关闭</button>
      {props.renderSlot('rightbar', { width: Math.min(window.innerWidth - 32, 700), viewportWidth: window.innerWidth, canShow: true })}
    </div>
    <div hidden>{props.renderSlot('sidebar.settings', { wide: false })}</div>
    {props.renderSlot('shell.bottom', {})}
    {props.call && <CallOverlay engine={props.call} />}
    {props.renderSlot('shell.overlay', {})}
    {personal?.notice && !view.settings && <div className={css.receipt} role="status"><span>{personal.notice}</span>{(personal.canUndo || personal.serverUndo) && <button onClick={() => void props.personalSettings?.undoLast().catch(cause => props.personalSettings?.notify(String(cause)))}>撤销</button>}<button aria-label="关闭设置回执" onClick={() => props.personalSettings?.notify('')}><Glyph name="close" /></button></div>}
    {view.settings && props.personalSettings && <div className={css.classicLayer}>{props.renderSettings()}</div>}
  </div>
}

function subscribeScheme(listener: () => void): () => void {
  const query = matchMedia('(prefers-color-scheme: dark)')
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

type WorkGroup = 'attention' | 'active' | 'finished'
type Ctx = {
  props: LiteProps; data: DataSnapshot; live: LiteProps['live']
  items: Item[]; waiting: Item[]; running: Item[]; finished: Item[]; unseen: number; unreadNotices: number
  prefs: LitePrefs; setPrefs(patch: Partial<LitePrefs>): void; theme: 'light' | 'dark'
  tab: Tab; go(tab: Tab): void; goWork(group: WorkGroup): void; workFocus: WorkGroup | null; clearWorkFocus(): void
  setSheet(sheet: null | 'create'): void; openDrawer(): void
}

/** 工作行 → 简洁版工作卡的数据：有实时卡用实时卡，否则用快照行。 */
function itemView(item: Item): LiteCardView {
  if (item.card) return viewOfCard(item.card)
  if (item.row) return viewOfRow(item.row)
  return { id: item.id, title: item.title, status: item.status, doing: item.doing, updatedAt: item.updatedAt, steps: [], artifactCount: 0 }
}

/* ================= 顶栏 + 抽屉（替代底栏和精灵菜单） ================= */
/** 每页同一条顶栏：左菜单、中间标题和一行状态、右边铃铛和本页动作。 */
/** 以后的图标位：lite-brand.ts 里的 LITE_ICON 不空时显示，空的时候什么都不占。 */
function BrandMark({ large }: { large?: boolean }): ReactElement | null {
  const url = liteIconUrl()
  return url ? <img className={large ? css.brandMarkLarge : css.brandMark} src={url} alt="" aria-hidden="true" data-lite-brand-icon="" /> : null
}

function TopBar({ ctx, title, sub, offline, live, brand, hideBell, link, children }: { ctx: Ctx; title: string; sub?: string; offline?: boolean; live?: boolean; brand?: boolean; hideBell?: boolean; link?: LinkLevel; children?: ReactNode }): ReactElement {
  const bell = ctx.unreadNotices
  return <header className={css.top}>
    <button className={css.icon} aria-label="打开菜单" aria-haspopup="dialog" onClick={ctx.openDrawer}><Glyph name="menu" />{ctx.tab !== 'chat' && ctx.waiting.length > 0 && <i className={css.badge} data-dot="true" />}</button>
    <div className={css.heading}><h1 className={css.title} data-dot-name-keep="">{brand && <BrandMark />}{title}</h1>{link
      ? <span className={css.sub} data-link-line="">
          <span className={css.linkState} role="status" aria-label={`连接状态：${LINK_LABEL[link]}`} data-link={link}><i aria-hidden="true" />{LINK_LABEL[link]}</span>
          {sub && <span className={css.linkWork} data-live={live ? '' : undefined}>{sub}</span>}
        </span>
      : sub && <span className={css.sub} role="status" data-offline={Boolean(offline)} data-live={live ? '' : undefined}>{live && <i className={css.breath} aria-hidden="true" />}{sub}</span>}</div>
    {!hideBell && <button className={css.icon} aria-label={bell ? `消息（${bell} 条新）` : '消息'} aria-current={ctx.tab === 'notices' ? 'page' : undefined} onClick={() => ctx.go('notices')}><Glyph name="bell" />{bell > 0 && <i className={css.badge}>{bell > 99 ? '99+' : bell}</i>}</button>}
    <button className={css.icon} aria-label={ctx.theme === 'dark' ? '切换浅色模式' : '切换深色模式'} onClick={() => ctx.setPrefs({ theme: ctx.theme === 'dark' ? 'light' : 'dark' })}>
      <svg className={css.themeGlyph} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <g className={css.themeMoon}><path d="M8.4 3.5a9 9 0 0 0 12.2 12.2A8.8 8.8 0 1 1 8.4 3.5Z" /></g>
        <g className={css.themeSun}><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></g>
      </svg>
    </button>
    {children}
  </header>
}

/** 左侧抽屉：所有去处都在这里（原来底栏 + 精灵菜单里的事）。 */
export function Drawer({ ctx, open = true, close }: { ctx: Ctx; open?: boolean; close(): void }): ReactElement {
  const { props, data, waiting, running, finished, tab } = ctx
  const layer = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (!layer.current) return
    layer.current.inert = !open
    if (!open) return
    const trigger = document.activeElement
    panel.current?.focus({ preventScroll: true })
    return () => {
      if (trigger instanceof HTMLElement && trigger.isConnected && trigger.getClientRects().length)
        trigger.focus({ preventScroll: true })
    }
  }, [open])
  const nav = (key: Tab, label: string, icon: string, meta?: ReactNode) => <button className={css.navItem} aria-current={tab === key ? 'page' : undefined} onClick={() => ctx.go(key)}>
    <Glyph name={icon} /><span>{label}</span>{meta}
  </button>
  return <div ref={layer} className={css.drawerLayer} data-open={open} aria-hidden={!open}>
    <button className={css.scrim} aria-label="关闭菜单" tabIndex={-1} onClick={close} />
    <aside ref={panel} tabIndex={-1} className={css.drawer} role={open ? "dialog" : undefined} aria-modal={open || undefined} aria-label="菜单">
      <div className={css.drawerHead}>
        {liteIconUrl() ? <BrandMark large /> : null}
        <span className={css.drawerWho}><b>{LITE_NAME}</b><span data-offline={!data.connected}>{!data.connected ? '未连接' : liveWorkLine(running.length, waiting.length) || (data.busy ? '正在回复' : '已连接')}</span></span>
      </div>
      {/* 点状态进入后台工作对应筛选；列表仍默认折叠。 */}
      <div className={css.drawerSection}><span>后台工作</span></div>
      <nav className={`${css.nav} ${workCss.drawerGroups}`} aria-label="后台工作" data-lite-work-groups="">
        <button className={css.navItem} data-group="attention" data-hot={waiting.length > 0} onClick={() => ctx.goWork('attention')}>
          <span className={css.mark} data-kind="attention" /><span>要你处理</span><em className={css.count} data-strong={waiting.length ? '' : undefined}>{waiting.length}</em>
        </button>
        <button className={css.navItem} data-group="active" onClick={() => ctx.goWork('active')}>
          <span className={css.mark} data-kind={running.length ? 'active' : 'idle'} /><span>进行中</span><em className={css.count}>{running.length}</em>
        </button>
        <button className={css.navItem} data-group="finished" onClick={() => ctx.goWork('finished')}>
          <span className={css.mark} data-kind="done" /><span>已结束</span><em className={css.count}>{finished.length}</em>
        </button>
      </nav>
      <nav className={css.nav} aria-label="去处">
        {nav('chat', '对话', 'chat')}
        {nav('notices', '消息', 'bell', ctx.unreadNotices ? <em className={css.count} data-strong="">{ctx.unreadNotices}</em> : null)}
        {nav('calendar', '日程与待办', 'calendar')}
        {nav('me', '设置', 'gear')}
      </nav>
      <div className={css.drawerFoot}>
        {props.call && <button className={css.navItem} onClick={() => { close(); void props.call?.start() }}><Glyph name="phone" /><span>和 {LITE_NAME} 打电话</span></button>}
      </div>
    </aside>
  </div>
}

/** 露出来过的提醒都记进「消息」列表（同一个气泡队列，加上「你不在时」）。 */
function NoticeRecorder({ live }: { live: NonNullable<LiteProps['live']> }): null {
  const snap = useSyncExternalStore(live.bubbles.subscribe, live.bubbles.getSnapshot)
  const away = useSyncExternalStore(live.awaySummary.subscribe, live.awaySummary.get)
  useEffect(() => { for (const notice of snap.visible) noticeLog.record(notice) }, [snap.visible])
  useEffect(() => { if (away) noticeLog.record(away) }, [away])
  return null
}

/* ================= 对话 ================= */
/* 顶栏标题 = 本户在设置里定的助手名（dot-lite-header-name-2026-11-01）；没取到才用 LITE_NAME。
   设置保存时 persona-api 发 dot-persona:changed，这里就地换名，不用刷新。浏览器标题/manifest 不跟着改。 */
let assistantNameCache = ''
function useAssistantName(): string {
  const [name, setName] = useState(assistantNameCache)
  useEffect(() => {
    let alive = true
    const take = (value: unknown) => { const next = typeof value === 'string' ? value.trim() : ''; assistantNameCache = next; if (alive) setName(next) }
    loadPersona().then(view => take(view.profile.name)).catch(() => {})
    const onChange = (event: Event) => take((event as CustomEvent<{ name?: string }>).detail?.name)
    window.addEventListener('dot-persona:changed', onChange)
    return () => { alive = false; window.removeEventListener('dot-persona:changed', onChange) }
  }, [])
  return name || LITE_NAME
}

function ChatPage({ ctx, hidden }: { ctx: Ctx; hidden: boolean }): ReactElement {
  const { props, data, running, waiting } = ctx
  const reducedMotion = props.useStore(state => state.reducedMotion)
  const chat = useRef<HTMLDivElement>(null)
  const stick = useRef<ReturnType<typeof installStickToBottom> | null>(null)
  const returnButton = useRef<HTMLButtonElement>(null)
  const [awayFromBottom, setAwayFromBottom] = useState(false)
  const searchInput = useRef<HTMLInputElement>(null)
  const searchToggle = useRef<HTMLButtonElement>(null)
  const [searching, setSearching] = useState(false)
  const toggleSearch = (open: boolean) => {
    if (open) {
      // 在同一次点击内启用并聚焦输入框，手机键盘与搜索栏同时开始展开。
      flushSync(() => setSearching(true))
      searchInput.current?.focus({ preventScroll: true })
    } else {
      searchToggle.current?.focus({ preventScroll: true })
      setSearching(false)
    }
  }
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<HTMLElement[]>([])
  const [index, setIndex] = useState(0)
  useEffect(() => {
    const root = chat.current
    const term = query.trim().toLocaleLowerCase()
    if (!root || hidden || !searching || !term) { setMatches([]); return }
    const collect = () => {
      const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-chat-flow-kind="user"], [data-chat-flow-kind="assistant-step"]'))
      const found = rows.filter(row => row.getClientRects().length && row.innerText.toLocaleLowerCase().includes(term))
      setMatches(old => old.length === found.length && old.every((row, n) => row === found[n]) ? old : found)
    }
    collect()
    const observer = new MutationObserver(collect)
    observer.observe(root, { subtree: true, childList: true, characterData: true })
    return () => observer.disconnect()
  }, [hidden, searching, query])
  const position = Math.min(index, Math.max(0, matches.length - 1))
  useEffect(() => {
    const row = matches[position]
    if (!row || !searching) return
    row.setAttribute('data-lite-search-hit', '')
    stick.current?.jump(row)
    return () => row.removeAttribute('data-lite-search-hit')
  }, [matches, position, searching])
  /* 打开即贴底：规则见 stick-bottom.ts（hark-reloadfix-20261101：手指一碰不再永久停止贴底；装填期保持位置；图片/iframe 加载也算）。 */
  useLayoutEffect(() => {
    const root = chat.current
    if (hidden || !root) return
    const handle = installStickToBottom(root, { trace: info => {
      const away = !info.following && info.gap > 60
      const button = returnButton.current
      if (away && button?.offsetParent) {
        const card = root.querySelector('[data-composer-seat] [data-composer-card]')
        if (card) {
          const inset = button.offsetParent.getBoundingClientRect().bottom - card.getBoundingClientRect().top
          button.style.setProperty('--dot-composer-inset', Math.max(0, inset) + 'px')
        }
      }
      setAwayFromBottom(away)
      ;(window as unknown as { __dotStick?: unknown }).__dotStick = { ...info, at: Date.now() }
    } })
    stick.current = handle
    return () => { handle.stop(); stick.current = null }
  }, [hidden])
  useLayoutEffect(() => {
    if (!hidden && !reducedMotion && chat.current) return installSendMotion(chat.current)
  }, [hidden, reducedMotion])
  useLayoutEffect(() => {
    if (!hidden && chat.current) return installReplyMotion(chat.current, reducedMotion)
  }, [hidden, reducedMotion])
  /* 顶栏状态：未连接最要紧；有工作时显示「正在做 n 件 · m 件等你」；只在回复时显示「正在回复」；没事时不显示。 */
  /* 2026-11-01 设计稿修正轮（用户定）：标题仍是设置里的助手名，下面一行先是连接灯（在线 / 连接中 / 未连接，
     真实取自原生连接服务，见 link-status.ts），后面接工作状态或「正在回复」。 */
  const link = useLinkLevel(data.connected, data.link)
  const work = liveWorkLine(running.length, waiting.length)
  const status = link !== 'online' ? '' : work || (data.busy ? '正在回复' : '')
  const title = useAssistantName()
  /* 顶栏不放 logo（logo 只在抽屉里）。 */
  return <section className={css.page} hidden={hidden} data-page="chat" data-lite-single="">
    <TopBar ctx={ctx} title={title} link={link} {...(status ? { sub: status } : {})} live={Boolean(work)}><button ref={searchToggle} className={css.icon} aria-label="搜索会话内容" aria-expanded={searching} onClick={() => toggleSearch(!searching)}><svg className={css.glyph} viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg></button></TopBar>
    <div className={css.chatFindFold} aria-hidden={!searching} onKeyDown={e => {
      if (e.key === 'Escape' && !e.nativeEvent.isComposing) { e.preventDefault(); toggleSearch(false) }
    }}>
      <div className={css.chatFindClip}>
        <div className={css.chatFind}>
          <input ref={searchInput} disabled={!searching} aria-label="搜索当前会话" placeholder="搜索当前会话" value={query} onChange={e => { setQuery(e.target.value); setIndex(0) }} onKeyDown={e => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && matches.length) setIndex((position + (e.shiftKey ? -1 : 1) + matches.length) % matches.length)
          }}/>
          <span aria-live="polite">{query.trim() && (matches.length ? (position + 1) + '/' + matches.length : '无匹配')}</span>
          <button disabled={!searching || !matches.length} aria-label="上一个匹配" onClick={() => setIndex((position + matches.length - 1) % matches.length)}>↑</button>
          <button disabled={!searching || !matches.length} aria-label="下一个匹配" onClick={() => setIndex((position + 1) % matches.length)}>↓</button>
          <button disabled={!searching} aria-label="关闭搜索" onClick={() => toggleSearch(false)}>×</button>
        </div>
      </div>
    </div>
    <AwayBanner ctx={ctx} />
    <AttentionTray ctx={ctx} />
    <div ref={chat} className={css.chat}>{props.renderSlot('main', {}, { entryKey: 'conversation' })}</div>
    <button ref={returnButton} type="button" className={css.chatBottom} disabled={!awayFromBottom} aria-hidden={!awayFromBottom} aria-label="返回会话底部" onClick={() => { setSearching(false); stick.current?.jump() }}>↓</button>
  </section>
}

/** 「你不在时…」：一直留着，用户点掉或点开才收。 */
function AwayBanner({ ctx }: { ctx: Ctx }): ReactElement | null {
  const live = ctx.live
  const away = useSyncExternalStore(live?.awaySummary.subscribe ?? noopSubscribe, live?.awaySummary.get ?? (() => null))
  if (!away || !live) return null
  const open = () => { live.awaySummary.dismiss(); if (away.workId) live.actions.openWork(away.workId); else ctx.go('work') }
  return <div className={css.away} role="status">
    <button className={css.awayBody} onClick={open}><b>{away.title}</b>{away.text && <span>{away.text}</span>}</button>
    <button className={css.icon} aria-label="知道了" onClick={() => live.awaySummary.dismiss()}><Glyph name="close" /></button>
  </div>
}

/** 等你处理：对话页顶部一条，点开就地答。这是审批 / 填写 / 登录卡在主界面上的保底位置。 */
function AttentionTray({ ctx }: { ctx: Ctx }): ReactElement | null {
  const [open, setOpen] = useState(false)
  const list = ctx.waiting
  useEffect(() => { if (!list.length) setOpen(false) }, [list.length])
  if (!list.length) return null
  const first = list[0]!
  return <div className={css.tray} data-open={open}>
    <button className={css.trayHead} aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className={css.mark} data-kind="attention" />
      <span className={css.trayText}><b>{list.length > 1 ? `${list.length} 件事等你处理` : statusOf(first.status).label}</b><span>{list.length > 1 ? first.title : attentionOf(first)?.message ?? first.title}</span></span>
      <span className={css.trayChevron}><Glyph name="chevron" /></span>
    </button>
    {open && <div className={css.trayList}>{list.map(item => <div key={item.id} className={css.trayItem}>
      <button className={css.trayTitle} onClick={() => ctx.props.actions.openCard(item.id)}>{item.title}</button>
      <AttentionActions ctx={ctx} item={item} />
    </div>)}</div>}
  </div>
}

/** 处理一件「等你」的工作：确认 / 拒绝（审批桥能答时）、去填写 / 去登录（服务端给的入口）、补一句。 */
function AttentionActions({ ctx, item, full }: { ctx: Ctx; item: Item; full?: boolean }): ReactElement {
  const live = ctx.live
  useSyncExternalStore(live?.approvals.subscribe ?? noopSubscribe, live?.approvals.getVersion ?? (() => 0))
  const attention = attentionOf(item)
  const sessionId = item.card?.sessionId
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const run = async (action: string, value: Record<string, unknown>) => {
    setBusy(true); setNote('')
    try { await ctx.props.command(action, value); if (action === 'work.supplement') { setText(''); setNote('已发给它') } }
    catch (cause) { setNote(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const decidable = item.status === 'waiting-approval' && Boolean(live?.approvals.canDecide(sessionId))
  const decide = (decision: 'allow' | 'reject') => { if (!live?.approvals.decide(sessionId, decision)) setNote('这条确认已经不在了，刷新看看最新状态') }
  const action = attention?.action
  return <div className={css.actions}>
    {full && attention?.message && <p className={css.attentionText}>{attention.message}</p>}
    {attention?.risk && <p className={css.risk}>风险：{attention.risk}</p>}
    <div className={css.buttons}>
      {decidable && <><button className={css.primary} onClick={() => decide('allow')}><Glyph name="check" />批准</button><button className={css.secondary} onClick={() => decide('reject')}>拒绝</button></>}
      {action?.kind === 'open-url' && <button className={css.primary} onClick={() => { if (!openNoticeEntry(action.url, true)) window.open(action.url, '_blank', 'noopener') }}><Glyph name="open" />{action.label || '去填写'}</button>}
      {item.status === 'waiting-approval' && !decidable && <span className={css.hint}>确认按钮还没接上（页面刚打开时会这样）。稍等几秒，或在对话里跟 {LITE_NAME} 说「继续」。</span>}
    </div>
    {item.status === 'waiting-input' && !action && <form className={css.inline} onSubmit={event => { event.preventDefault(); if (text.trim()) void run('work.supplement', { workId: item.id, text }) }}>
      <input value={text} onChange={event => setText(event.target.value)} placeholder="补充一句给它" aria-label="补充说明" />
      <button className={css.secondary} disabled={busy || !text.trim()}>发送</button>
    </form>}
    {note && <p className={css.hint} role="status">{note}</p>}
  </div>
}

/* ================= 顶部提醒（替代精灵气泡，队列同一个） ================= */
function Toasts({ ctx }: { ctx: Ctx }): ReactElement | null {
  const live = ctx.live!
  const snap = useSyncExternalStore(live.bubbles.subscribe, live.bubbles.getSnapshot)
  useSyncExternalStore(live.actions.subscribeDecidable ?? noopSubscribe, live.actions.decidableVersion ?? (() => 0))
  if (!snap.visible.length) return null
  return <div className={css.toasts} aria-live="polite">{snap.visible.map(notice => <Toast key={notice.key} notice={notice} ctx={ctx} />)}</div>
}
function Toast({ notice, ctx }: { notice: DotNotice; ctx: Ctx }): ReactElement {
  const live = ctx.live!
  const actions = live.actions
  const dismiss = () => live.bubbles.dismiss(notice.key)
  const ack = () => actions.acknowledge?.(notice)
  const open = () => {
    ack(); dismiss()
    if (notice.kind === 'input' && openNoticeEntry(notice.entryUrl)) return
    if (notice.workId && notice.tone !== 'reminder') actions.openWork(notice.workId)
    else actions.openPostbox(notice.postboxId)
  }
  const decidable = notice.kind === 'confirm' && actions.canDecide(notice)
  return <div className={css.toast} data-tone={notice.tone} role={notice.kind === 'info' ? 'status' : 'alertdialog'}
    onPointerEnter={() => live.bubbles.hold(notice.key, true)} onPointerLeave={() => live.bubbles.hold(notice.key, false)}>
    <button className={css.toastBody} onClick={open}>
      <small>{notice.eyebrow}</small><b>{notice.title}</b>{notice.text && <span>{notice.text}</span>}
      {notice.risk && <span className={css.risk}>风险：{notice.risk}</span>}
    </button>
    <div className={css.toastActions}>
      {decidable && <><button className={css.primary} onClick={() => { if (actions.decide(notice, 'allow')) { ack(); dismiss() } }}>确认</button><button className={css.secondary} onClick={() => { if (actions.decide(notice, 'reject')) { ack(); dismiss() } }}>拒绝</button></>}
      {notice.kind === 'confirm' && !decidable && <button className={css.secondary} onClick={open}>去处理</button>}
      {notice.kind === 'input' && <button className={css.primary} onClick={open}>{notice.entryLabel ?? '去填写'}</button>}
      <button className={css.icon} aria-label="收起" onClick={dismiss}><Glyph name="close" /></button>
    </div>
  </div>
}

/* ================= 工作 ================= */
export function WorkPage({ ctx }: { ctx: Ctx }): ReactElement {
  const { data, items } = ctx
  const now = useNow()
  const [more, setMore] = useState(false)
  const [filter, setFilter] = useState<WorkFilter>('all')
  const list = useRef<HTMLDivElement>(null)
  const lastFilter = useRef(filter)
  useLayoutEffect(() => {
    if (lastFilter.current === filter) return
    lastFilter.current = filter
    const node = list.current
    if (!node?.animate || node.closest('[data-reduced-motion="true"]') || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const motion = node.animate([{ opacity: .45 }, { opacity: 1 }], { duration: 270, easing: 'ease-out' })
    return () => motion.cancel()
  }, [filter])
  const waiting = ctx.waiting
  const active = ctx.running
  const rest = ctx.finished
  const loading = data.domainLoading?.work ?? data.loading
  /* 从抽屉点组，直接选择对应筛选；无数据也可看空态。 */
  useEffect(() => {
    if (!ctx.workFocus) return
    setFilter(ctx.workFocus)
    ctx.clearWorkFocus()
  }, [ctx.workFocus])
  return <section className={css.page} data-page="work">
    <TopBar ctx={ctx} title="后台工作" sub={[active.length ? `${active.length} 件进行中` : '', waiting.length ? `${waiting.length} 件等你` : ''].filter(Boolean).join(' · ') || `${items.length} 件`} />
    <WorkFilters value={filter} counts={{ attention: waiting.length, active: active.length, finished: rest.length }} onChange={setFilter} />
    <div ref={list} className={css.scroll}>
      <AwayBanner ctx={ctx} />
      {!items.length && <p className={css.empty}>{loading ? '正在读取…' : `还没有后台工作。在对话里让 ${LITE_NAME} 去做。`}</p>}
      {items.length > 0 && filter !== 'all' && ({ attention: waiting.length, active: active.length, finished: rest.length }[filter] === 0) && <p className={css.empty}>这里暂时没有工作。</p>}
      {(filter === 'all' || filter === 'attention') && waiting.length > 0 && <Group title={`要你处理 · ${waiting.length}`} id="attention">{waiting.map(item => <WorkLine key={item.id} item={item} ctx={ctx} now={now} />)}</Group>}
      {(filter === 'all' || filter === 'active') && active.length > 0 && <Group title={`进行中 · ${active.length}`} id="active">{active.map(item => <WorkLine key={item.id} item={item} ctx={ctx} now={now} />)}</Group>}
      {(filter === 'all' || filter === 'finished') && rest.length > 0 && <Group title={`已结束 · ${rest.length}`} id="finished"><div className={workCss.finishedList}>{(more ? rest : rest.slice(0, 12)).map(item => <WorkLine key={item.id} item={item} ctx={ctx} now={now} />)}</div>
        {rest.length > 12 && !more && <button className={css.more} onClick={() => setMore(true)}>显示全部 {rest.length} 件</button>}</Group>}
      {filter === 'all' && <Plans ctx={ctx} plans={data.plans} />}
    </div>
  </section>
}

function WorkLine({ item, ctx, now }: { item: Item; ctx: Ctx; now: number }): ReactElement {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const retrying = useRef(false)
  const kind = liteCardKind(item.status)
  const label = liteCardLabel(item.status)
  const retry = async () => {
    if (retrying.current) return
    retrying.current = true
    setBusy(true); setNote('')
    try { await ctx.props.command('work.retry', { workId: item.id, operationId: opId() }) }
    catch (cause) { setNote(cause instanceof Error ? cause.message : String(cause)) }
    finally { retrying.current = false; setBusy(false) }
  }
  /* 09 列表独立于对话卡；沿用新建时间倒序，默认折叠。 */
  return <article className={workCss.listRow} data-lite-work="" data-collapsed="" data-kind={kind} data-work-id={item.id}>
    <button type="button" className={workCss.rowOpen} onClick={() => ctx.props.actions.openCard(item.id)} aria-label={`查看工作：${item.title}，${label}`}>
      <span className={workCss.rowMark} aria-hidden="true">{kind === 'done' ? '✓' : kind === 'failed' ? '◆' : item.status === 'cancelled' ? '×' : kind === 'active' ? '•' : '◇'}</span>
      <span className={workCss.rowTitle}>{item.title}</span>
      <span className={workCss.rowMeta}>{kind === 'done' ? <time dateTime={item.updatedAt}>{ago(item.updatedAt, now)}</time> : label}</span>
    </button>
    {kind === 'failed' && <button type="button" className={workCss.rowRetry} disabled={busy} aria-label={`重试：${item.title}`} onClick={() => void retry()}>{busy ? '提交中…' : '重试'}</button>}
    {note && <p className={workCss.rowNote} role="alert">{note}</p>}
  </article>
}

function WorkDetailPresence({ ctx, id, reduced }: { ctx: Ctx; id?: string | null | undefined; reduced: boolean }): ReactElement | null {
  const [retained, setRetained] = useState(id)
  const layer = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (layer.current) layer.current.inert = !id
    if (id || reduced || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setRetained(id)
      return
    }
    if (!retained) return
    const timer = window.setTimeout(() => setRetained(null), 280)
    return () => window.clearTimeout(timer)
  }, [id, reduced, retained])
  const shown = id || retained
  return shown ? <div ref={layer} className={workCss.detailMotion} data-open={Boolean(id)}>
    <WorkDetail key={shown} ctx={ctx} id={shown} />
  </div> : null
}

export function WorkDetail({ ctx, id }: { ctx: Ctx; id: string }): ReactElement {
  const { props, items } = ctx
  const item = items.find(value => value.id === id)
  const now = useNow(10_000)
  const [supplement, setSupplement] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const resultsRef = useRef<HTMLDivElement>(null)
  const close = () => props.actions.openCard(null)
  if (!item) return <Sheet title="工作" onClose={close}><p className={css.empty}>正在读取这件工作…</p></Sheet>
  const status = statusOf(item.status)
  const card = item.card
  const row = item.row
  const active = status.kind === 'active' || status.kind === 'attention'
  const retryable = item.status === 'failed' || item.status === 'cancelled' || item.status === 'interrupted'
  const run = async (action: string, value: Record<string, unknown>) => {
    setBusy(true); setNote('')
    try { await props.command(action, value); if (action === 'work.supplement') { setSupplement(''); setNote('已发给它') } }
    catch (cause) { setNote(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const artifacts = row?.artifacts ?? []
  const error = row?.error ?? (card as { error?: string } | undefined)?.error
  const returnToChat = () => { close(); ctx.go('chat') }
  const cancel = () => { if (confirm('取消这件工作？')) void run('work.cancel', { workId: item.id }) }
  const reason = explainFailure(error)
  const footer = <div className={workCss.detailFooter}>
    {active && <button className={css.secondary} disabled={busy} onClick={cancel}>取消这件工作</button>}
    {retryable && <button className={css.primary} disabled={busy} onClick={() => void run('work.retry', { workId: item.id, operationId: opId() })}>{item.status === 'cancelled' ? '重新派这件活' : '重试'}</button>}
    {status.kind === 'done' && artifacts.length > 0 && <button className={css.primary} onClick={() => resultsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })}>看结果</button>}
    <button className={css.secondary} onClick={returnToChat}>回到对话</button>
  </div>
  const menu: SheetMenuItem[] = [
    { label: '回到对话', onSelect: returnToChat },
    ...(active ? [{ label: '取消这件工作', onSelect: cancel, disabled: busy }] : []),
    ...(error ? [{ label: '复制原始信息', onSelect: () => { void navigator.clipboard?.writeText(String(error)).then(() => setNote('原始信息已复制'), () => setNote('复制没成功，可以展开「查看原始信息」长按复制')) } }] : []),
  ]
  return <Sheet title="任务详情" sub="后台工作" back menu={menu} onClose={close} footer={footer}>
    <div className={css.detail}>
      <div className={workCss.detailCard}>
        <div className={css.detailHead}>
          <span className={css.chip} data-kind={status.kind}><span className={css.mark} data-kind={status.kind} />{status.label}</span>
          <time>更新于 {ago(item.updatedAt, now)}</time>
        </div>
        <DetailTitle text={item.title} />
        {typeof item.progress === 'number' && active && <span className={css.bar}><i style={{ width: `${Math.round(item.progress * (item.progress <= 1 ? 100 : 1))}%` }} /></span>}
      </div>
      {needsYou(item) && <div className={workCss.detailSection}><h3 className={workCss.detailSectionTitle}>等你处理</h3><div className={workCss.detailPanel}><AttentionActions ctx={ctx} item={item} full /></div></div>}
      {reason && <div className={workCss.detailSection} data-failure-kind={reason.kind}><h3 className={workCss.detailSectionTitle}>{item.status === 'failed' ? '为什么没做成' : '原因'}</h3><div className={workCss.detailPanel}>
        <p className={workCss.reason}>{reason.sentence}</p>
        {reason.raw && <details className={workCss.raw}><summary>查看原始信息</summary><pre>{reason.raw}</pre></details>}
      </div></div>}
      {card && card.steps.length > 0 && <div className={workCss.detailSection}><h3 className={workCss.detailSectionTitle}>步骤</h3><div className={workCss.detailPanel}><ol className={css.steps}>{card.steps.map(step => <li key={step.index} data-status={step.status}><span className={css.stepMark} />{step.label}</li>)}</ol></div></div>}
      {item.doing && status.kind !== 'done' && <div className={workCss.detailSection}><h3 className={workCss.detailSectionTitle}>正在做</h3><div className={workCss.detailPanel}><p className={css.doing}>{item.doing}</p></div></div>}
      {row?.goal && <div className={workCss.detailSection}><h3 className={workCss.detailSectionTitle}>工作目标</h3><div className={workCss.detailPanel}><p>{row.goal}</p></div></div>}
      {artifacts.length > 0 && <div className={workCss.detailSection} ref={resultsRef}><h3 className={workCss.detailSectionTitle}>成果</h3>{artifacts.map(artifact => <Artifact key={artifact.id} artifact={artifact} />)}</div>}
      {status.kind === 'done' && !artifacts.length && <p className={css.hint}>成果正在读取，或这件工作没有留下文件。完成信也在消息里。</p>}
      {active && item.status !== 'waiting-input' && <form className={css.inline} onSubmit={event => { event.preventDefault(); if (supplement.trim()) void run('work.supplement', { workId: item.id, text: supplement }) }}>
        <input value={supplement} onChange={event => setSupplement(event.target.value)} placeholder="给它补充一句" aria-label="补充说明" />
        <button className={css.secondary} disabled={busy || !supplement.trim()}>发送</button>
      </form>}
      {note && <p className={css.hint} role="status">{note}</p>}

    </div>
  </Sheet>
}

/** 09b：标题中号；超过两行先收起，点一下看全。 */
function DetailTitle({ text }: { text: string }): ReactElement {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLHeadingElement>(null)
  const [long, setLong] = useState(false)
  useLayoutEffect(() => { const el = ref.current; if (el && !open) setLong(el.scrollHeight > el.clientHeight + 1) }, [text, open])
  return <h2 ref={ref} className={css.detailTitle} data-open={open ? '' : undefined} data-long={long ? '' : undefined}
    {...(long || open ? { role: 'button', tabIndex: 0, 'aria-expanded': open, title: open ? '收起标题' : '展开完整标题', onClick: () => setOpen(!open), onKeyDown: (event: { key: string; preventDefault(): void }) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpen(!open) } } } : {})}>{text}</h2>
}

function Artifact({ artifact }: { artifact: WorkRow['artifacts'][number] }): ReactElement {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  return <div className={css.artifact}>
    <div className={css.artifactHead}>
      <b>{artifact.title}</b>
      {artifact.url && <a className={css.icon} href={artifact.url} target="_blank" rel="noopener" aria-label={`打开 ${artifact.title}`}><Glyph name="open" /></a>}
      {artifact.text && <button className={css.icon} aria-label="复制" onClick={() => void navigator.clipboard?.writeText(artifact.text ?? '').then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })}><Glyph name={copied ? 'check' : 'copy'} /></button>}
    </div>
    {artifact.text && <><pre className={css.artifactText} data-open={open}>{artifact.text}</pre>
      {artifact.text.length > 280 && <button className={css.more} onClick={() => setOpen(!open)}>{open ? '收起' : '展开全文'}</button>}</>}
  </div>
}

function CreateSheet({ ctx }: { ctx: Ctx }): ReactElement {
  const [goal, setGoal] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const close = () => ctx.setSheet(null)
  const submit = () => {
    if (!goal.trim()) return
    setBusy(true); setError('')
    void ctx.props.command('work.create', { goal: goal.trim(), operationId: opId() })
      .then(() => { close(); ctx.go('work') })
      .catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false))
  }
  return <Sheet title="派一件后台工作" onClose={close} compact>
    <p className={css.sheetLead}>写清楚要做什么。它在后台做，你关掉页面也会做完，结果会在消息里告诉你。</p>
    <textarea className={css.textarea} autoFocus rows={4} value={goal} onChange={event => setGoal(event.target.value)} placeholder="比如：整理这周的 AI 新闻，列五条要点" aria-label="工作内容" />
    {error && <p className={css.errorText}>{error}</p>}
    <div className={css.buttons} data-end><button className={css.secondary} onClick={close}>取消</button><button className={css.primary} disabled={busy || !goal.trim()} onClick={submit}>派出去</button></div>
  </Sheet>
}

function Plans({ ctx, plans }: { ctx: Ctx; plans: readonly PlanRow[] }): ReactElement {
  const [adding, setAdding] = useState(false)
  const [goal, setGoal] = useState('')
  const [minutes, setMinutes] = useState(60)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const now = useNow()
  const list = plans.filter(plan => !plan.cancelled)
  const run = async (action: string, value: Record<string, unknown>) => {
    setBusy(true); setNote('')
    try { await ctx.props.command(action, value); if (action === 'plan.create') { setGoal(''); setAdding(false) } }
    catch (cause) { setNote(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  return <Group title="持续职责" action={<button className={css.link} onClick={() => setAdding(!adding)}>{adding ? '收起' : '新建'}</button>}>
    {adding && <div className={css.planForm}>
      <textarea className={css.textarea} rows={2} value={goal} onChange={event => setGoal(event.target.value)} placeholder="每隔一段时间要做的事" aria-label="持续职责内容" />
      <label className={css.field}>每隔<input type="number" min={5} step={5} value={minutes} onChange={event => setMinutes(Math.max(5, Number(event.target.value) || 5))} aria-label="间隔分钟" />分钟做一次</label>
      <div className={css.buttons} data-end><button className={css.primary} disabled={busy || !goal.trim()} onClick={() => void run('plan.create', { goal: goal.trim(), minutes, operationId: opId() })}>开始</button></div>
    </div>}
    {!list.length && !adding && <p className={css.empty}>还没有持续职责。</p>}
    {list.map(plan => <div key={plan.planId} className={css.line} data-kind={plan.paused ? 'idle' : 'active'}>
      <div className={css.lineMain} data-static>
        <span className={css.mark} data-kind={plan.paused ? 'idle' : 'active'} />
        <span className={css.lineText}><b>{plan.title || plan.goal}</b><span>{plan.paused ? '已暂停' : plan.nextAt ? `下次 ${ago(plan.nextAt, now).replace('前', '后')}` : '等待调度'}</span></span>
      </div>
      <div className={css.buttons} data-end>
        <button className={css.secondary} disabled={busy} onClick={() => void run(plan.paused ? 'plan.resume' : 'plan.pause', { planId: plan.planId, operationId: opId() })}>{plan.paused ? '继续' : '暂停'}</button>
        <button className={css.secondary} disabled={busy} onClick={() => { if (confirm('取消这项持续职责？已经发生的工作仍会保留。')) void run('plan.cancel', { planId: plan.planId, operationId: opId() }) }}>取消</button>
      </div>
    </div>)}
    {note && <p className={css.hint} role="status">{note}</p>}
  </Group>
}

/* ================= 星邮匣 ================= */
type Filter = 'inbox' | 'unread' | 'todo' | 'archived'
function PostboxPage({ ctx }: { ctx: Ctx }): ReactElement {
  const { props, data } = ctx
  const now = useNow()
  const [filter, setFilter] = useState<Filter>('inbox')
  const [openId, setOpenId] = useState<string | null>(null)
  const [busyAll, setBusyAll] = useState('')
  /* 进来就算「看过」：底栏红点消失；「已读」仍是每封信自己的状态。 */
  const newest = data.letters.reduce((max, letter) => Math.max(max, letter.at ?? Date.parse(letter.createdAt) ?? 0), 0)
  useEffect(() => { if (newest) markPostboxSeen(newest) }, [newest])
  const letters = data.letters.filter(letter => filter === 'archived' ? letter.archived : !letter.archived && (filter === 'inbox' || (filter === 'unread' ? !letter.read : Boolean(letter.todo && !letter.todo.closed))))
  const unread = data.letters.filter(letter => !letter.archived && !letter.read)
  const loading = data.domainLoading?.postbox ?? data.loading
  const readAll = async () => {
    let failed = 0
    setBusyAll('正在标为已读…')
    /* 沿用经典版的做法：逐封 postbox.read，顺序执行（并发会互相冲掉快照）。待办信不在这里统一处理。 */
    for (const letter of unread.filter(value => !value.todo)) { try { await props.command('postbox.read', { id: letter.id }) } catch { failed += 1 } }
    setBusyAll(failed ? `${failed} 封没标上` : '')
  }
  return <section className={css.page} data-page="postbox">
    <TopBar ctx={ctx} title="星邮匣" sub={unread.length ? `${unread.length} 封未读` : '都看过了'}>
      {unread.some(letter => !letter.todo) ? <button className={css.textButton} disabled={Boolean(busyAll)} onClick={() => void readAll()}>全部已读</button> : undefined}
    </TopBar>
    <div className={css.segment} role="tablist">
      {([['inbox', '全部'], ['unread', '未读'], ['todo', '待办'], ['archived', '归档']] as const).map(([key, label]) => <button key={key} role="tab" aria-selected={filter === key} onClick={() => setFilter(key)}>{label}</button>)}
    </div>
    <div className={css.scroll}>
      {busyAll && <p className={css.hint}>{busyAll}</p>}
      {!letters.length && <p className={css.empty}>{loading ? '正在读取…' : filter === 'inbox' ? '星邮匣是空的。后台工作做完、要你处理、提醒到点时，信会出现在这里。' : '这里没有信。'}</p>}
      <div className={css.letters}>{letters.map(letter => <Letter key={letter.id} letter={letter} ctx={ctx} now={now} open={openId === letter.id} toggle={() => setOpenId(openId === letter.id ? null : letter.id)} />)}</div>
    </div>
  </section>
}

function Letter({ letter, ctx, now, open, toggle }: { letter: LetterRow; ctx: Ctx; now: number; open: boolean; toggle(): void }): ReactElement {
  const { props, live } = ctx
  const [busy, setBusy] = useState(false)
  const failed = deliveryFailed(letter.delivery)
  const run = async (action: string) => { setBusy(true); try { await props.command(action, { id: letter.id }) } catch { /* 快照会刷新出真实状态 */ } finally { setBusy(false) } }
  const onToggle = () => {
    /* 没有待办的信：打开即已读（和经典版一致）。待办信不自动标读，由用户点「标为已读」。 */
    if (!open && !letter.read && !letter.todo) void props.command('postbox.read', { id: letter.id }).catch(() => {})
    toggle()
  }
  const todo = letter.todo
  return <article className={css.letter} data-kind={letter.kind} data-proactive={letter.proactive ? 'true' : undefined} data-unread={!letter.read} data-open={open}>
    <button className={css.letterHead} aria-expanded={open} onClick={onToggle}>
      <span className={css.unreadDot} aria-hidden="true" />
      <span className={css.lineText}>
        <b>{letter.title}</b>
        {!open && <span className={css.preview}>{letter.body}</span>}
      </span>
      <span className={css.letterMeta}><time>{ago(letter.at ?? letter.createdAt, now)}</time>{todo && <em data-closed={todo.closed} data-kind={todo.closed ? 'idle' : todo.status === 'in_progress' ? 'active' : 'attention'}>{todo.statusLabel}</em>}{failed && <em data-kind="failed">投递失败</em>}</span>
    </button>
    {open && <div className={css.letterBody}>
      <p className={css.prose}>{letter.body}</p>
      {todo && todo.progress && <p className={css.hint}>{todo.progress}</p>}
      {todo && todo.updates.length > 0 && <ol className={css.updates}>{todo.updates.map(update => <li key={update.id}><time>{ago(update.at, now)}</time><b>{update.title}</b>{update.body && <span>{update.body}</span>}</li>)}</ol>}
      <div className={css.buttons}>
        {letter.workId && <button className={css.secondary} onClick={() => live ? live.actions.openWork(letter.workId!) : props.actions.openCard(letter.workId!)}>查看工作</button>}
        {!letter.read && <button className={css.secondary} disabled={busy} onClick={() => void run('postbox.read')}>标为已读</button>}
        {failed && <button className={css.secondary} disabled={busy} onClick={() => void run('postbox.retry')}>重新投递</button>}
        {!letter.archived && (!todo || todo.closed) && <button className={css.secondary} disabled={busy} onClick={() => void run('postbox.archive')}>归档</button>}
      </div>
    </div>}
  </article>
}

/* ================= 日程（2026-11-01 calendar） =================
   本账号在知序里的日程，只读月历。正文在 LiteCalendar.tsx，数据在 calendar.ts。 */
const PAGE_TABS: readonly Tab[] = ['chat', 'work', 'notices', 'postbox', 'calendar', 'memory', 'me']

function MainPages({ ctx, reducedMotion }: { ctx: Ctx; reducedMotion: boolean }): ReactElement {
  const tab = ctx.tab
  const [route, setRoute] = useState<{ current: Tab; previous: Tab | null }>({ current: tab, previous: null })
  const monthCache = useRef<MonthCache>({})
  if (route.current !== tab) {
    const immediate = reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches
    setRoute({ current: tab, previous: immediate ? null : route.current })
  }
  useEffect(() => {
    if (!route.previous) return
    const timer = setTimeout(() => setRoute(state => state === route ? { current: tab, previous: null } : state), 500)
    return () => clearTimeout(timer)
  }, [route, tab])
  return <div className={css.pageStack}>{PAGE_TABS.map(key => {
    const leaving = route.previous === key
    const active = key === tab
    const visible = active || leaving
    if (!visible && key !== 'chat') return null
    return <div key={key} className={css.pageLayer} data-route={key}
      data-motion={leaving ? 'out' : active && route.previous ? 'in' : undefined}
      hidden={!visible} aria-hidden={!active} ref={node => { if (node) node.inert = !active }}>
      {key === 'chat' ? <ChatPage ctx={ctx} hidden={!visible} />
        : key === 'work' ? <WorkPage ctx={ctx} />
        : key === 'calendar' ? <CalendarPage ctx={ctx} monthCache={monthCache.current} />
        : key === 'memory' ? <MemoryPage ctx={ctx} />
        : key === 'me' ? <MePage ctx={ctx} />
        : <NoticesPage ctx={ctx} />}
    </div>
  })}</div>
}

function CalendarPage({ ctx, monthCache }: { ctx: Ctx; monthCache: MonthCache }): ReactElement {
  return <section className={css.page} data-page="calendar">
    <TopBar ctx={ctx} title="日程与待办" sub="北京时间 · 在对话里也能加日程" />
    <LiteCalendar monthCache={monthCache} />
  </section>
}

/* ================= 我的 ================= */
/* 设置只有一页：人格与称呼、提醒、外观。经典版的设置中心在简洁版里不再打开；
   用的是同一份数据：人格走 /dot-persona，提醒走星邮匣的提醒偏好，字号走个人设置，主题是简洁版自己的本机偏好。 */
function SettingsChoices({ label, value, children }: { label: string; value: string; children: ReactNode }): ReactElement {
  const bar = useTabMarker(value)
  return <div ref={bar} className={css.segment} role="radiogroup" aria-label={label} data-inline>
    <span className={css.choiceMarker} aria-hidden="true" />
    {children}
  </div>
}

function MePage({ ctx }: { ctx: Ctx }): ReactElement {
  const { props, data, prefs, setPrefs } = ctx
  const personal = useSyncExternalStore(props.personalSettings?.subscribe ?? noopSubscribe, props.personalSettings?.getSnapshot ?? (() => null))
  /* 微信：只有开了 dsh-im 的账号才有这个服务，没有就不露入口。 */
  const im = useSyncExternalStore(props.imClient?.subscribe ?? noopSubscribe, props.imClient?.getSnapshot ?? (() => null))
  const [imOpen, setImOpen] = useState(false)
  const [permission, setPermission] = useState(() => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const asked = useRef(false)
  /* 提醒偏好在星邮匣那块数据里，打开设置就取一次。 */
  useEffect(() => { if (!asked.current) { asked.current = true; void props.loadDomain?.('postbox') } }, [])
  const fontScale = personal?.value.fontScale ?? 100
  const setFont = (value: number) => props.personalSettings?.change({ fontScale: Math.min(130, Math.max(85, value)) })
  const reminder = data.reminderSettings
  const events = reminder?.preferences.events as Partial<Record<'completed' | 'attention' | 'failed', boolean>> | undefined
  const reminderOff = busy || !data.connected || !reminder?.personalReminders
  const save = async (action: string, patch: Record<string, unknown>) => {
    if (busy) return
    setBusy(true); setError('')
    try { await props.command(action, patch); await props.loadDomain?.('postbox') }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const remindLabels = { completed: '工作完成时提醒我', attention: '需要我确认或处理时提醒我', failed: '工作失败时提醒我' } as const
  return <section className={css.page} data-page="me">
    <TopBar ctx={ctx} title="设置" sub={data.connected ? '已连接' : '未连接'} offline={!data.connected} />
    <div className={css.scroll}>
      <Group title="人格与称呼"><LitePersona /></Group>
      <Group title="提醒">
        <div className={css.list}>
          <Row label="免打扰" {...(data.dnd ? { value: '开着' } : {})} toggle={data.dnd} onClick={() => void save('postbox.preferences', { dnd: !data.dnd })} />
          <Row label="系统通知" value={window.dotAndroid ? (permission === 'granted' ? '已启动提醒同步' : '点此开启或恢复') : permission === 'granted' ? '已开启' : permission === 'denied' ? '已被浏览器拦下' : permission === 'unsupported' ? '这个浏览器不支持' : '点此开启'} onClick={() => { setError(''); void props.command('notifications.enable').then(() => setPermission(window.dotAndroid ? 'granted' : typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)).catch(cause => setError(cause instanceof Error ? cause.message : String(cause))) }} />
          {(['completed', 'attention', 'failed'] as const).map(category => <Row key={category} label={remindLabels[category]} toggle={events?.[category] ?? true} {...(reminderOff ? {} : { onClick: () => void save('settings.reminders', { category, enabled: !(events?.[category] ?? true) }) })} />)}
          <Row label="飞书推送" value={data.channelStatus ? (data.channelStatus.feishuConfigured ? '已配置' : '未配置') : '—'} />
        </div>
        {error ? <p className={css.perror} role="alert">{error}</p> : <p className={css.hint}>关掉提醒只是不再主动弹出，仍可在消息里查看。</p>}
      </Group>
      {im && <Group title="微信">
        <div className={css.list}>
          <Row label="微信" value="扫码绑定与管理" onClick={() => setImOpen(true)} />
        </div>
        <p className={css.hint}>用微信扫码绑定后，在微信里给它发消息，就跟在这里对话一样。</p>
      </Group>}
      <Group title="外观">
        <SettingsChoices label="主题" value={prefs.theme}>
          {(['light', 'dark'] as const).map(value => <button key={value} role="radio" aria-checked={prefs.theme === value} onClick={() => setPrefs({ theme: value })}>{value === 'light' ? '浅色' : '深色'}</button>)}
        </SettingsChoices>
        <div className={css.list}>
          <div className={css.row} data-static><span className={css.rowLabel}>字体大小</span><span className={css.stepper}><button aria-label="字号减小" disabled={fontScale <= 85} onClick={() => setFont(fontScale - 5)}>A−</button><output>{fontScale}%</output><button aria-label="字号增大" disabled={fontScale >= 130} onClick={() => setFont(fontScale + 5)}>A+</button></span></div>
        </div>
      </Group>
    </div>
    {im && imOpen && <Sheet title="微信" onClose={() => setImOpen(false)}><div className={css.imPanel} data-lite-im="">{im.render({ preferredSectionId: 'weixin' })}</div></Sheet>}
  </section>
}

/** 人格与称呼：和经典版同一份云端设定。人设先预览扩写，满意了再保存。 */
function LitePersona(): ReactElement {
  const [view, setView] = useState<PersonaView | null>(null)
  const [loadError, setLoadError] = useState('')
  const [name, setName] = useState('')
  const [userName, setUserName] = useState('')
  const [gender, setGender] = useState<PersonaGender>('unset')
  const [brief, setBrief] = useState('')
  const [expanded, setExpanded] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [previewFor, setPreviewFor] = useState('')
  const [busy, setBusy] = useState<'' | 'basic' | 'expand' | 'text'>('')
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const adopt = (next: PersonaView) => {
    setView(next); setName(next.profile.name); setUserName(next.profile.userName); setGender(next.profile.gender)
    setBrief(next.profile.brief); setExpanded(next.profile.expanded); setPreview(null)
  }
  useEffect(() => { loadPersona().then(adopt).catch(cause => setLoadError(cause instanceof Error ? cause.message : String(cause))) }, [])
  if (loadError) return <p className={css.hint}>暂时读不到人格设定：{loadError}</p>
  if (!view) return <p className={css.hint}>正在读取…</p>
  const p = view.profile
  const shownName = name.trim() || view.defaults.name
  const basicDirty = name.trim() !== p.name || userName.trim() !== p.userName || gender !== p.gender
  const briefDirty = brief.trim() !== p.brief
  const textDirty = expanded.trim() !== p.expanded
  const run = async (kind: 'basic' | 'expand' | 'text', patch: Parameters<typeof savePersona>[0], done: string) => {
    if (busy) return
    setBusy(kind); setError(''); setOk('')
    try { const next = await savePersona(patch); adopt(next); if (next.expandError) setError(next.expandError); else setOk(done) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy('') }
  }
  const askPreview = async () => {
    if (busy) return
    const text = brief.trim()
    setBusy('expand'); setError(''); setOk('')
    try { const out = await previewPersona({ name: shownName, userName: userName.trim(), gender, brief: text }); setPreview(out); setPreviewFor(text) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy('') }
  }
  const button = (label: string, onClick: () => void, opts: { primary?: boolean; disabled?: boolean } = {}) => <button type="button" className={opts.primary ? css.primary : css.secondary} aria-disabled={busy !== '' || Boolean(opts.disabled)} onClick={() => { if (!busy && !opts.disabled) onClick() }}>{label}</button>
  return <div data-lite-persona="">
    <label className={css.pfield}><span>助手的名字</span><input value={name} maxLength={view.limits.name} placeholder={view.defaults.name} onChange={event => setName(event.target.value)} /></label>
    <label className={css.pfield}><span>它怎么称呼你</span><input value={userName} maxLength={view.limits.userName} placeholder="不填就叫“你”" onChange={event => setUserName(event.target.value)} /></label>
    <div className={css.pfield}><span>性别</span><SettingsChoices label="性别" value={gender}>
      {GENDER_OPTIONS.map(option => <button key={option.key} type="button" role="radio" aria-checked={gender === option.key} onClick={() => setGender(option.key)}>{option.label}</button>)}
    </SettingsChoices></div>
    {basicDirty && <div className={css.pactions}>{button(busy === 'basic' ? '保存中…' : '保存', () => void run('basic', { name: shownName, userName: userName.trim(), gender }, '已保存，下一句回复起生效。'), { primary: true })}</div>}
    <label className={css.pfield}><span>人格</span><textarea rows={4} value={brief} placeholder="想写什么写什么，比如它的性格、说话风格、口头禅……" onChange={event => setBrief(event.target.value)} /></label>
    {preview === null && (briefDirty || brief.trim() !== '') && <div className={css.pactions}>
      {brief.trim() !== '' ? button(busy === 'expand' ? '扩写中…' : briefDirty ? '预览扩写' : '重新扩写', () => void askPreview(), { primary: briefDirty }) : button(busy === 'expand' ? '保存中…' : '保存', () => void run('expand', { brief: '' }, '已清空人格，恢复默认性格。'), { primary: true })}
    </div>}
    {preview !== null && <>
      <label className={css.pfield}><span>扩写预览 · 还没保存</span><textarea rows={8} value={preview} onChange={event => setPreview(event.target.value)} /></label>
      <div className={css.pactions}>
        {button('不要这版', () => { setPreview(null); setError('') })}
        {button(busy === 'expand' ? '扩写中…' : '重新扩写', () => void askPreview())}
        {button(busy === 'text' ? '保存中…' : '保存这一版', () => void run('text', { name: shownName, userName: userName.trim(), gender, brief: previewFor, expanded: preview.trim(), expand: false }, '已保存这一版人格，下一句回复起生效。'), { primary: true, disabled: preview.trim() === '' })}
      </div>
    </>}
    {preview === null && p.expanded !== '' && <>
      <label className={css.pfield}><span>现在用的完整人格</span><textarea rows={6} value={expanded} onChange={event => setExpanded(event.target.value)} /></label>
      {textDirty && <div className={css.pactions}>
        {button('撤销修改', () => setExpanded(p.expanded))}
        {button(busy === 'text' ? '保存中…' : '保存修改', () => void run('text', { expanded: expanded.trim() }, '修改已保存，下一句回复起生效。'), { primary: true })}
      </div>}
    </>}
    {error && <p className={css.perror} role="alert">{error}</p>}
    {ok && <p className={css.pok} role="status">{ok}</p>}
  </div>
}

/* ================= 消息（提醒列表） ================= */
function NoticesPage({ ctx }: { ctx: Ctx }): ReactElement {
  const { props, data } = ctx
  const [readAllBusy, setReadAllBusy] = useState(false)
  const [readAllNote, setReadAllNote] = useState('')
  const log = useSyncExternalStore(noticeLog.subscribe, noticeLog.get)
  useEffect(() => { void props.loadDomain?.('postbox') }, [])
  const autoRead = useRef(new Set<string>())
  useEffect(() => {
    for (const id of handledAttentionIds(data.letters, ctx.items)) {
      if (autoRead.current.has(id)) continue
      autoRead.current.add(id)
      void props.command('postbox.read', { id }).catch(() => { autoRead.current.delete(id) })
    }
  }, [data.letters, ctx.items])
  const loading = data.domainLoading?.postbox ?? data.loading
  const unread = messageEntries(data.letters, log).filter(entry => !entry.read)
  const read = (entry: MessageEntry) => {
    if (entry.letter) {
      void props.command('postbox.read', { id: entry.letter.id }).catch(() => {})
      for (const notice of log) if (notice.postboxId === entry.letter.id) noticeLog.markRead(notice.key)
    } else if (entry.notice) noticeLog.markRead(entry.notice.key)
  }
  const readAll = async (entries: readonly MessageEntry[]) => {
    let failed = 0, todos = 0
    for (const entry of entries) {
      if (entry.letter?.todo) { todos += 1; continue }
      if (entry.letter) {
        try { await props.command('postbox.read', { id: entry.letter.id }); for (const notice of log) if (notice.postboxId === entry.letter.id) noticeLog.markRead(notice.key) } catch { failed += 1 }
      } else if (entry.notice) noticeLog.markRead(entry.notice.key)
    }
    return [failed ? `${failed} 条没有标上已读` : '', todos ? `${todos} 条待办可单独标为已读` : ''].filter(Boolean).join('；')
  }
  const open = (entry: MessageEntry) => {
    if (entry.workId) {
      if (!ctx.items.some(item => item.id === entry.workId)) void props.loadDomain?.('work')
      props.actions.openCard(entry.workId)
    }
    else if (entry.notice?.kind === 'input') openNoticeEntry(entry.notice.entryUrl)
  }
  return <section className={css.page} data-page="notices">
    <TopBar ctx={ctx} title="消息" sub={unread.length ? `${unread.length} 条未读` : loading ? '正在读取消息…' : '没有未读消息'} hideBell><button className={css.textButton} disabled={readAllBusy || unread.length === 0} onClick={() => { setReadAllBusy(true); setReadAllNote(''); void readAll(unread).then(setReadAllNote).catch(() => setReadAllNote('标记失败，请重试')).finally(() => setReadAllBusy(false)) }}>全部已读</button></TopBar>
    {readAllNote && <p className={css.hint} role="status">{readAllNote}</p>}
    <MessagesView hideReadAll letters={data.letters} notices={log} loading={loading} selectedNoticeId={data.noticeId} onOpen={open} onRead={read} onReadAll={readAll}
      onArchive={letter => props.command('postbox.archive', { id: letter.id })} onRetry={letter => props.command('postbox.retry', { id: letter.id })} />
  </section>
}

/* ================= 记忆 ================= */
function MemoryPage({ ctx }: { ctx: Ctx }): ReactElement {
  const { props, data } = ctx
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [note, setNote] = useState('')
  const asked = useRef(false)
  useEffect(() => { if (!asked.current) { asked.current = true; void props.loadDomain?.('memory'); if (!data.memoryStatus) void props.loadDomain?.('capabilities') } }, [])
  const loading = data.domainLoading?.memory ?? false
  const run = async (action: string, value: Record<string, unknown>, done: string) => {
    setNote('')
    try { await props.command(action, { ...value, operationId: opId() }); setNote(done); setEditing(null); void props.loadDomain?.('memory') }
    catch (cause) { setNote(cause instanceof Error ? cause.message : String(cause)) }
  }
  const status = data.memoryStatus
  return <section className={css.page} data-page="memory">
    <TopBar ctx={ctx} title="记忆" sub={status ? (status.available ? `XTMEM 可用${status.engineVersion ? ` · ${status.engineVersion}` : ''}` : 'XTMEM 不可用') : `${data.memories.length} 条`} />
    <form className={css.search} onSubmit={event => { event.preventDefault(); void props.search(query.trim()) }}>
      <Glyph name="search" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜记忆" aria-label="搜记忆" />
      {query && <button type="button" className={css.textButton} onClick={() => { setQuery(''); void props.search('') }}>清除</button>}
    </form>
    <div className={css.scroll}>
      {note && <p className={css.hint} role="status">{note}</p>}
      {!data.memories.length && <p className={css.empty}>{loading ? '正在读取…' : query ? '没搜到相关的记忆。' : `还没有记忆。要 ${LITE_NAME} 记住什么，直接在对话里说。`}</p>}
      <div className={css.memories}>{data.memories.map((memory: MemoryRow) => <article key={memory.id} className={css.memory}>
        {editing === memory.id
          ? <form onSubmit={event => { event.preventDefault(); if (draft.trim()) void run('memory.correct', { id: memory.id, text: draft.trim() }, '已改好') }}>
              <textarea value={draft} onChange={event => setDraft(event.target.value)} rows={3} aria-label="改这条记忆" />
              <div className={css.buttons}><button className={css.primary} disabled={!draft.trim()}>保存</button><button type="button" className={css.secondary} onClick={() => setEditing(null)}>取消</button></div>
            </form>
          : <><p>{memory.text}</p>
              <footer><span>{[memory.kind, memory.updatedAt ? ago(memory.updatedAt, Date.now()) : ''].filter(Boolean).join(' · ')}</span>
                <button className={css.textButton} onClick={() => { setEditing(memory.id); setDraft(memory.text) }}>纠正</button>
                <button className={css.textButton} onClick={() => { if (confirm('忘掉这条记忆？以后还能在历史里找回。')) void run('memory.forget', { id: memory.id }, '已忘掉') }}>忘掉</button>
              </footer></>}
      </article>)}</div>
    </div>
  </section>
}

/* ================= 通用小部件 ================= */
function Group({ title, action, id, children }: { title: string; action?: ReactNode; id?: string; children: ReactNode }): ReactElement {
  return <section className={css.group} {...(id ? { 'data-work-group': id } : {})}><header className={css.groupHead}><h2>{title}</h2>{action}</header>{children}</section>
}
function Row({ label, value, toggle, icon, onClick }: { label: string; value?: string; toggle?: boolean; icon?: string; onClick?: () => void }): ReactElement {
  const body = <>
    {icon && <Glyph name={icon} />}
    <span className={css.rowLabel}>{label}</span>
    {value && <span className={css.rowValue}>{value}</span>}
    {typeof toggle === 'boolean' ? <span className={css.switch} data-on={toggle} aria-hidden="true"><i /></span> : onClick ? <span className={css.rowChevron}><Glyph name="chevron" /></span> : null}
  </>
  if (!onClick) return <div className={css.row} data-static>{body}</div>
  return <button className={css.row} onClick={onClick} {...(typeof toggle === 'boolean' ? { role: 'switch', 'aria-checked': toggle } : {})}>{body}</button>
}
/** back：左侧 ‹ 返回（代替右侧 ×，09b 任务详情）；sub：标题下一行副标题；menu：右侧「…」菜单项。 */
function Sheet({ title, sub, back, menu, onClose, compact, children, footer }: { title: string; sub?: string; back?: boolean; menu?: readonly SheetMenuItem[]; onClose(): void; compact?: boolean; children: ReactNode; footer?: ReactNode }): ReactElement {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [onClose])
  return <div className={css.sheetLayer} data-compact={Boolean(compact)}>
    <button className={css.scrim} aria-label="关闭" onClick={onClose} tabIndex={-1} />
    <section className={css.sheet} role="dialog" aria-modal="true" aria-label={title}>
      {back
        ? <header className={css.sheetHead} data-back="">
            <button className={css.icon} aria-label="返回" onClick={onClose}><Glyph name="back" /></button>
            <div className={css.sheetTitles}><h2>{title}</h2>{sub && <span className={css.sheetSub}>{sub}</span>}</div>
            {menu && menu.length > 0 ? <SheetMenu items={menu} /> : <span className={css.iconSpacer} />}
          </header>
        : <header className={css.sheetHead}><h2>{title}</h2><button className={css.icon} aria-label="关闭" onClick={onClose}><Glyph name="close" /></button></header>}
      <div className={css.sheetBody} data-sheet-body="">{children}</div>
      {footer}
    </section>
  </div>
}

export interface SheetMenuItem { label: string; onSelect(): void; disabled?: boolean }
/** 右上角「…」：点开一列操作，点外面或 Esc 收起（Esc 先收菜单，不关整页）。 */
function SheetMenu({ items }: { items: readonly SheetMenuItem[] }): ReactElement {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopImmediatePropagation(); event.preventDefault(); setOpen(false) } }
    addEventListener('pointerdown', onDown, true)
    addEventListener('keydown', onKey, true)
    return () => { removeEventListener('pointerdown', onDown, true); removeEventListener('keydown', onKey, true) }
  }, [open])
  return <div className={css.sheetMenu} ref={box}>
    <button className={css.icon} aria-label="更多操作" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><Glyph name="more" /></button>
    {open && <div className={css.sheetMenuPop} role="menu">{items.map(item => <button key={item.label} role="menuitem" disabled={item.disabled} onClick={() => { setOpen(false); item.onSelect() }}>{item.label}</button>)}</div>}
  </div>
}
