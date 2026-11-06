/* ================================================================
   DOT 工作卡 · 对话里的小卡 / 候选条
   ▍这是什么
   ① WorkChatCard：插在对话消息流里的工作小卡，是工作空间主卡的缩小版：
      同一套深蓝玻璃底 + 玫瑰金边、宋体标题、状态标签、阶段线（绿 = 已完成，蓝 = 当前）。
      数据按任务编号从全局状态读，状态变了自己跟着变；点一下跳到工作空间对应的大卡。
   ② WorkCandidates：用户问得含糊、有好几项都像时，列出候选（ASTRA 同时会反问是哪一项）。
   通知不在这里：做完了 / 等你确认 / 没做成都从精灵弹气泡（notify/）。
   ▍修改铁律
   1. 【不】自己拉接口，只读全局状态；全量还没到时用工具 meta 的精简行先画。
   2. 【不】编百分比和步骤：后端没给就不画进度条、不画阶段线。
   3. 可点区域不小于 40px 高。
   ▍更新记录
   *更新：2026-10-24 · 改成工作空间主卡的缩小版；通知条移到精灵气泡*
================================================================ */
import { useEffect, useRef, useState, type ReactElement } from 'react'
import css from './work-cards.module.css'
import { describeWorkCard, relativeTime, statusText, type WorkCard, type WorkCardStatus, type WorkCardStep } from './work-card.ts'

export interface WorkChatCardProps {
  readonly card: WorkCard
  readonly now: number
  readonly onOpen?: (id: string) => void
  /** 这张卡是怎么来的：问进度拉出来的 / 刚交代的新工作 / 取消的。 */
  readonly origin?: 'progress' | 'created' | 'cancelled'
}

const ORIGIN_TEXT = { progress: '工作进度', created: '新交代的工作', cancelled: '已取消的工作' } as const

/** 阶段线最多画 5 个点：步骤更多时取当前步附近的一段，和工作空间主卡一致。 */
export function visibleSteps(steps: readonly WorkCardStep[], max = 5): readonly WorkCardStep[] {
  if (steps.length <= max) return steps
  const current = Math.max(0, steps.findIndex(step => step.status === 'running' || step.status === 'failed' || step.status === 'pending'))
  const start = Math.min(Math.max(0, current - Math.floor(max / 2)), steps.length - max)
  return steps.slice(start, start + max)
}

const STEP_STATE = { done: 'done', running: 'current', failed: 'failed', pending: 'todo' } as const

function WorkGlyph(): ReactElement {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.1 6.1 6.1 2.1-6.1 2.1L12 19.2l-2.1-6.1L3.8 11l6.1-2.1z" fill="currentColor" /></svg>
}

export function WorkChatCard({ card, now, onOpen, origin = 'progress' }: WorkChatCardProps): ReactElement {
  const title = card.title || '这项工作'
  const summary = describeWorkCard(card, now)
  const steps = visibleSteps(card.steps)
  const current = card.steps.find(step => step.status === 'running' || step.status === 'failed')
  const position = card.position ? `第 ${card.position.current}/${card.position.total} 步` : ''
  return <article className={css['chatCard']} data-tone={card.tone} data-status={card.status} data-work-id={card.id} data-dot-work-chat-card="">
    <button type="button" className={css['chatCardHit']} onClick={() => onOpen?.(card.id)} aria-label={`在工作空间打开：${title}，${summary}`}>
      <span className={css['chatCardBar']}>
        <span className={css['chatCardTag']}><WorkGlyph />{ORIGIN_TEXT[origin]}</span>
        <span className={css['chatCardTime']}>{card.updatedAt ? relativeTime(card.updatedAt, now) : ''}</span>
      </span>
      <strong className={css['chatCardTitle']}>{title}</strong>
      <span className={css['chatCardChips']}>
        <em className={css['chatCardChip']} data-status={card.status}>{statusText[card.status]}</em>
        {position && <em className={css['chatCardChip']} data-tone="plain">{position}</em>}
        {card.progress !== undefined && <em className={css['chatCardChip']} data-tone="plain">{card.progress}%</em>}
      </span>
      {steps.length > 0 && <span className={css['chatCardStages']} aria-hidden="true">
        {steps.map(step => <i key={step.index} data-state={STEP_STATE[step.status]} title={step.label}><b>{step.status === 'done' ? '✓' : step.index + 1}</b></i>)}
      </span>}
      {card.progress !== undefined && <span className={css['chatCardProgress']} aria-hidden="true"><i style={{ transform: `scaleX(${card.progress / 100})` }} /></span>}
      <span className={css['chatCardSummary']}>{current ? <><b>{current.label}</b> · </> : null}{summary}</span>
      <span className={css['chatCardFoot']}>
        <span>{card.artifactCount ? `${card.artifactCount} 个产出` : (card.stage || '')}</span>
        <span className={css['chatCardOpen']}>在工作空间查看 ›</span>
      </span>
    </button>
    {/* ⚠️ 入口放在整卡按钮**外面**：按钮里再嵌 a 是非法结构，点击会串行为。
        地址完全来自后端 blocked.action（服务端下发的专用页），这里只画一个可点的链接。 */}
    {card.attention?.action !== undefined && <a
      className={css['chatCardEntry']}
      href={card.attention.action.url}
      target="_blank"
      rel="noreferrer noopener"
      data-dot-work-entry={card.attention.action.kind}
    >{card.attention.action.label} ›</a>}
  </article>
}

export interface WorkCandidatesProps {
  readonly candidates: readonly { readonly id: string; readonly title: string; readonly status: WorkCardStatus; readonly stage: string; readonly ticket?: string }[]
  readonly onOpen?: (id: string) => void
  readonly onChoose?: ((ticket: string, readOnly?: boolean) => Promise<{selectedId:string;targetId:string}>) | undefined
}

export function WorkCandidates({ candidates, onOpen, onChoose }: WorkCandidatesProps): ReactElement {
  const busy = useRef(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{selected:string;target:string}>()
  const [error, setError] = useState('')
  const firstTicket = candidates.find(item=>item.ticket)?.ticket
  useEffect(() => {
    let live = true
    if (firstTicket && onChoose) void onChoose(firstTicket,true).then(value=>{
      if (live && value.selectedId) setResult({selected:value.selectedId,target:value.targetId})
    }).catch(()=>{})
    return () => { live=false }
  }, [firstTicket,onChoose])
  async function choose(ticket: string) {
    if (!onChoose || result || busy.current) return
    busy.current = true
    setSending(true)
    setError('')
    try {
      const value = await onChoose(ticket)
      setResult({selected:value.selectedId,target:value.targetId})
    }
    catch (err) {
      const stale = /stale|conflict|clarification/.test(String(err))
      setError(stale ? '工单或对话已更新，请在对话里重新选择。' : '选择未确认，可以再点一次。')
    } finally { busy.current = false; setSending(false) }
  }
  return <section className={css['candidates']} aria-label="可能是这几项工作" data-dot-work-candidates="">
    <span className={css['chatCardTag']}><WorkGlyph />你指的是哪一项？</span>
    {candidates.map(item => <div key={item.id} className={css['candidateRow']}>
      <button type="button" className={css['candidate']} onClick={()=>onOpen?.(item.id)} data-status={item.status}>
        <strong>{item.title || item.id}</strong>
        <em data-status={item.status}>{statusText[item.status]}</em>
        {item.stage && item.stage!==statusText[item.status] && <span>{item.stage}</span>}
      </button>
      {item.ticket && <button type="button" role="checkbox" aria-label={'选择'+(item.title || item.id)}
        aria-checked={result?.selected===item.id} disabled={sending || !!result}
        className={css['choiceHit']} onClick={()=>void choose(item.ticket!)}>
        <i className={css['choiceBox']} aria-hidden="true">{result?.selected===item.id &&
          <svg viewBox="0 0 16 16" fill="none"><path d="m3 8 3.2 3.2L13 4.8" pathLength="1"/></svg>}</i>
      </button>}
    </div>)}
    {error && <span role="status">{error}</span>}
  </section>
}

/** 工具还在跑时的占位行：按结果卡的高度预留一半，结果到了不会大跳。 */
export function WorkChatPending({ label }: { readonly label: string }): ReactElement {
  return <div className={css['pending']} role="status" data-dot-work-pending=""><i aria-hidden="true" />{label}</div>
}
