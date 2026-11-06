/* ================================================================
   简洁版 · 对话里工作小卡的「就地处理」按钮（2026-10-31）
   ◍ 为什么：经典版里确认 / 拒绝只长在精灵气泡上；简洁版没有精灵，按钮必须直接长在对话流里的工作卡上，
     否则后台工作会一直卡在等批准。
   ◍ 只在简洁版挂上（index.ts 按 readUiMode() 传进 WorkToolView），经典版的对话小卡一点不变。
   ◍ 答复走同一个审批桥（live.approvals）；填写 / 登录走服务端给的入口；要补充时可以直接回一句。
   ◍ 2026-11-01：按钮文案改「批准 / 拒绝」；原文预览由 LiteWorkCard 画在按钮上方。
   ================================================================ */
import { useState, useSyncExternalStore, type ReactElement } from 'react'
import type { WorkCard } from '../work-cards/work-card.ts'
import type { ApprovalBridge } from '../notify/approvals.ts'
import { openNoticeEntry } from '../notify/notices.ts'
import { LITE_NAME } from './lite-brand.ts'
import css from './lite.module.css'

const noopSubscribe = () => () => {}

export interface WorkCardActionsProps {
  readonly card: WorkCard
  readonly approvals: ApprovalBridge | undefined
  readonly onOpen?: (id: string) => void
  readonly command: (action: string, value: Record<string, unknown>) => Promise<void>
}

export function WorkCardActions({ card, approvals, command, onOpen }: WorkCardActionsProps): ReactElement | null {
  useSyncExternalStore(approvals?.subscribe ?? noopSubscribe, approvals?.getVersion ?? (() => 0))
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const retryable = card.status === 'failed' || card.status === 'interrupted'
  if (card.status !== 'waiting-approval' && card.status !== 'waiting-input' && !retryable && !card.attention?.action) return null
  const attention = card.attention
  const action = attention?.action
  const decidable = card.status === 'waiting-approval' && Boolean(approvals?.canDecide(card.sessionId))
  const decide = (decision: 'allow' | 'reject') => {
    if (approvals?.decide(card.sessionId, decision)) setNote(decision === 'allow' ? '已确认，它会接着做' : '已拒绝')
    else setNote('这条确认已经不在了，刷新看看最新状态')
  }
  const supplement = async () => {
    setBusy(true); setNote('')
    try { await command('work.supplement', { workId: card.id, text }); setText(''); setNote('已发给它') }
    catch (cause) { setNote(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const retry = async () => {
    setBusy(true); setNote('')
    try {
      const operationId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
      await command('work.retry', { workId: card.id, operationId })
      setNote('已请求重新做一次')
    } catch (cause) { setNote(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  return <div className={css.cardActions} data-dot-lite-card-actions="" onClick={event => event.stopPropagation()}>
    {attention?.risk && <p className={css.risk}>风险：{attention.risk}</p>}
    <div className={css.buttons}>
      {retryable && <button type="button" className={css.secondary} disabled={busy} onClick={() => void retry()}>重试</button>}
      {retryable && onOpen && <button type="button" className={css.textButton} onClick={() => onOpen(card.id)}>看详情</button>}
      {decidable && <><button type="button" className={css.primary} onClick={() => decide('allow')}>批准</button><button type="button" className={css.secondary} data-narrow="" onClick={() => decide('reject')}>拒绝</button></>}
      {action?.kind === 'open-url' && <button type="button" className={css.primary} onClick={() => { if (!openNoticeEntry(action.url, true)) window.open(action.url, '_blank', 'noopener') }}>{action.label || '去填写'}</button>}
    </div>
    {card.status === 'waiting-approval' && !decidable && !note && <p className={css.hint}>确认按钮还在连接，稍等几秒；也可以在对话里跟 {LITE_NAME} 说「继续」。</p>}
    {card.status === 'waiting-input' && !action && <form className={css.inline} onSubmit={event => { event.preventDefault(); if (text.trim()) void supplement() }}>
      <input value={text} onChange={event => setText(event.target.value)} placeholder="补充一句给它" aria-label="补充说明" />
      <button className={css.secondary} disabled={busy || !text.trim()}>发送</button>
    </form>}
    {note && <p className={css.hint} role="status">{note}</p>}
  </div>
}
