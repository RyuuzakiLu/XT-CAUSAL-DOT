/* ================================================================
   简洁版 · 工作卡（2026-11-01，照竞品报告第 5 条）
   ◍ 结构：状态行（等宽小字：状态 · 第几步 / 时间）→ 标题 → 一行「正在做什么」→ 3px 进度条；
     步骤日志默认收起，点开才看。
   ◍ 要你批准：状态变成强调色「要你批准」，下面把原文摆出来（预览块），按钮由调用方传进来（批准 / 拒绝）。
   ◍ 做完收成一行：「✓ 已完成 · 标题 · 查看结果」；没做成写一行红字原因；取消也收成一行。
   ◍ 同一张卡用在两处：对话流里（WorkToolView 的 renderCard，数据是 WorkCard）、后台工作页（数据是 WorkRow 合并后的行）。
   ◍ 硬规矩：不编百分比、不编步骤——后端没给就不画进度条、不画「第几步」。
   ================================================================ */
import { useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import type { WorkCard } from '../work-cards/work-card.ts'
import type { WorkRow } from '../model.ts'
import css from './lite.module.css'

export type LiteCardKind = 'attention' | 'active' | 'done' | 'failed' | 'idle'

export interface LiteCardView {
  readonly id: string
  readonly title: string
  readonly status: string
  readonly doing: string
  readonly updatedAt: string
  /** 0–100；只在后端给了时有。 */
  readonly progress?: number
  readonly position?: { readonly current: number; readonly total: number }
  readonly steps: readonly { readonly index: number; readonly label: string; readonly status: string }[]
  readonly attention?: { readonly kind: 'input' | 'approval'; readonly message: string }
  readonly error?: string
  readonly artifactCount: number
}

const LABEL: Record<string, string> = {
  'waiting-approval': '要你批准',
  'waiting-input': '要你补充',
  queued: '排队中',
  running: '进行中',
  succeeded: '已完成',
  completed: '已完成',
  failed: '没做成',
  cancelled: '已取消',
  interrupted: '被打断',
}

export function liteCardKind(status: string): LiteCardKind {
  if (status === 'waiting-approval' || status === 'waiting-input') return 'attention'
  if (status === 'queued' || status === 'running') return 'active'
  if (status === 'succeeded' || status === 'completed') return 'done'
  if (status === 'failed' || status === 'interrupted') return 'failed'
  return 'idle'
}
export const liteCardLabel = (status: string): string => LABEL[status] ?? (status || '未知')

/** 进度统一成 0–100：后端行里是 0–1，工作卡里已经是 0–100。 */
export function percent(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.max(0, Math.min(100, Math.round(value <= 1 ? value * 100 : value)))
}

export function viewOfCard(card: WorkCard): LiteCardView {
  return {
    id: card.id, title: card.title || '这项工作', status: card.status,
    doing: card.doing || card.stage,
    updatedAt: card.updatedAt,
    ...(card.progress !== undefined ? { progress: card.progress } : {}),
    ...(card.position ? { position: card.position } : {}),
    steps: card.steps,
    ...(card.attention ? { attention: { kind: card.attention.kind, message: card.attention.message } } : {}),
    ...(card.error ? { error: card.error } : {}),
    artifactCount: card.artifactCount,
  }
}

export function viewOfRow(row: WorkRow): LiteCardView {
  const progress = percent(row.progress)
  return {
    id: row.id, title: row.goal || '这项工作', status: row.status, doing: row.stage, updatedAt: row.updatedAt,
    ...(progress !== undefined ? { progress } : {}),
    steps: [],
    ...(row.blocked ? { attention: { kind: row.blocked.kind, message: row.blocked.message } } : {}),
    ...(row.error ? { error: row.error } : {}),
    artifactCount: row.artifacts.length,
  }
}

/** 顶栏实时状态（竞品报告第 6 条）：「正在做 2 件 · 1 件等你」；没有工作时为空（顶栏只留名字）。 */
export function liveWorkLine(running: number, waiting: number): string {
  return [running ? `正在做 ${running} 件` : '', waiting ? `${waiting} 件等你` : ''].filter(Boolean).join(' · ')
}

export function ago(value: string | undefined, now: number): string {
  const at = value ? Date.parse(value) : NaN
  if (!Number.isFinite(at)) return ''
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 45) return '刚刚'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} 分钟前`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} 小时前`
  const date = new Date(at)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

export interface LiteWorkCardProps {
  readonly view: LiteCardView
  readonly now: number
  readonly onOpen?: (id: string) => void
  /** 工作列表统一收成一行，点开进入完整详情。 */
  readonly inline?: boolean
  readonly compact?: boolean
  /** 要你处理时的按钮（批准 / 拒绝 / 去填写 / 补一句），由调用方给。 */
  readonly actions?: ReactNode
}

export function LiteWorkCard({ view, now, onOpen, actions, inline = false, compact = false }: LiteWorkCardProps): ReactElement {
  const kind = liteCardKind(view.status)
  const label = liteCardLabel(view.status)
  const open = () => onOpen?.(view.id)
  const [expanded, setExpanded] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const panelId = useId()
  useLayoutEffect(() => { if (panel.current) panel.current.inert = !expanded }, [expanded])
  /* 工作列表默认收成一行；对话卡保持原有交互。 */
  if (!inline && (compact || kind === 'done' || kind === 'idle')) {
    return <article className={css.work} data-lite-work="" data-kind={kind} data-collapsed="" data-work-id={view.id}>
      <button type="button" className={css.workOneLine} onClick={open}>
        <span className={css.workCheck} aria-hidden="true">{kind === 'done' ? '✓' : kind === 'failed' ? '×' : kind === 'attention' ? '!' : kind === 'active' ? '•' : '–'}</span>
        <span className={css.workOneText}><b>{label}</b> · {view.title}</span>
        {(kind === 'done' || compact) && <span className={css.workLink}>{kind === 'done' ? '查看结果' : '查看详情'}</span>}
      </button>
    </article>
  }
  const time = ago(view.updatedAt, now)
  const step = view.position ? `第 ${view.position.current}/${view.position.total} 步` : ''
  const showPreview = kind === 'attention' && Boolean(view.attention?.message)
  const Head = inline ? 'div' : 'button'
  const body = <>
    <Head className={css.workHit} {...(inline ? {} : { type: 'button' as const, onClick: open, 'aria-label': `查看工作：${view.title}，${label}` })}>
      <span className={css.workStatus}><span className={css.workStatusLeft}><b data-kind={kind}>{kind === 'active' ? <i className={css.breath} aria-hidden="true" /> : kind === 'attention' || kind === 'failed' ? <i className={css.workStateMark} aria-hidden="true" /> : null}{label}</b>{step && <span> · {step}</span>}</span>{time && <time>{time}</time>}</span>
      <strong className={css.workTitle}>{view.title}</strong>
      {kind === 'failed'
        ? <span className={css.workReason}>{view.error || view.doing || '没有留下原因'}</span>
        : view.doing && !showPreview && <span className={css.workNow}>{view.doing}</span>}
      {kind === 'active' && view.progress !== undefined && <span className={css.workBar} aria-hidden="true"><i style={{ width: `${view.progress}%` }} /></span>}
    </Head>
    {showPreview && <div className={css.workPreview} data-lite-work-preview="">{view.attention!.message}</div>}
    {actions}
    {view.steps.length > 0 && <details className={css.workSteps}>
      <summary>步骤 {view.position ? `${view.position.current}/${view.position.total}` : view.steps.length}</summary>
      <ol>{view.steps.map(item => <li key={item.index} data-status={item.status}><span className={css.stepMark} />{item.label}</li>)}</ol>
    </details>}
  </>
  return <article className={css.work} data-lite-work="" data-kind={kind} data-status={view.status} data-work-id={view.id} data-inline={inline || undefined} data-collapsed={inline && !expanded ? '' : undefined}>
    {inline ? <>
      <button type="button" className={css.workOneLine} aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(!expanded)}>
        <span className={css.workCheck} aria-hidden="true">{kind === 'done' ? '✓' : kind === 'failed' ? '×' : kind === 'attention' ? '!' : kind === 'active' ? '•' : '–'}</span>
        <span className={css.workOneText}><b>{label}</b> · {view.title}</span><span className={css.workLink}>{expanded ? '收起' : '展开'}</span>
      </button>
      <div ref={panel} id={panelId} className={css.workCardFold} aria-hidden={!expanded}>
        <div className={css.workCardClip}>
          <div className={css.workCardBody}>{body}
            {view.artifactCount > 0 && <span className={css.workNow}>{view.artifactCount} 个成果</span>}
          </div>
          <button className={css.workFullLink} type="button" onClick={open}>{kind === 'done' ? '查看结果' : '查看完整工单'} ›</button>
        </div>
      </div>
    </> : body}
  </article>
}
