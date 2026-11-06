/* ================================================================
   DOT 工作卡 · 对话消息流里的工具视图（work_query / work_create / work_cancel）
   ▍这是什么
   挂在原生工具插槽 tool.call.toolview 上：ASTRA 在对话里调用这几个工作工具时，原生聊天在
   工具调用那一格画我们的工作卡，代替通用的“工具已调用”块。于是：
   ① 用户问“那个进度怎么样了”→ ASTRA 调 work_query → 消息流里插进一张活的工作小卡；
   ② 对话里交代新工作 → ASTRA 调 work_create → 当场插一张小卡；
   ③ 有歧义 → work_query 返回候选 → 画候选条，ASTRA 同时反问。
   卡片内容按任务编号从全局状态读，所以老消息里的卡也会跟着工作进展更新。
   ▍修改铁律
   1. 【不】往会话日志写任何东西：卡片就画在已有的工具结果位置上，刷新重放一致。
   2. 工具报错或 meta 不认识时退回一行纯文字，【不】白屏。
   ▍更新记录
   *更新：2026-10-24 · 建立*
================================================================ */
import { useEffect, useMemo, type ReactElement, type ReactNode } from 'react'
import type { PreparingToolCall, StartedToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './work-cards.module.css'
import { readWorkToolMeta, type WorkToolMeta, type WorkCard } from './work-card.ts'
import type { WorkCardStore } from './work-card-store.ts'
import { useNow, useWorkCards } from './use-work-cards.ts'
import { WorkCandidates, WorkChatCard, WorkChatPending } from './WorkChatCard.tsx'

/** 工具插槽传进来的属性里我们用到的那部分（与 ui-tool 的 ToolCallOwnerProps 结构兼容）。 */
export interface WorkToolOwnerProps {
  readonly callId: string
  readonly toolName: string
  readonly phase: 'preparing' | 'start' | 'result'
  readonly block?: PreparingToolCall | StartedToolCall | ToolResultNode
}

export const WORK_TOOL_NAMES = ['work_query', 'work_create', 'work_cancel', 'work_route_adjustment', 'work_supplement'] as const

const PENDING_TEXT: Record<string, string> = {
  work_supplement: '正在提交补充…',
  work_query: '正在查这项工作的最新进度…',
  work_route_adjustment: '正在查这条调整属于哪项工作…',
  work_create: '正在交代这项工作…',
  work_cancel: '正在取消这项工作…',
}

/** 一次最多在对话里插几张卡；更多的去工作空间看。 */
export const MAX_CHAT_CARDS = 3

function resultOf(block: WorkToolOwnerProps['block']): ToolResultNode | null {
  return block && (block as ToolResultNode).kind === 'tool-result' ? block as ToolResultNode : null
}

function resultText(result: ToolResultNode): string {
  return result.content.flatMap(part => typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'text' ? [String((part as { text?: unknown }).text ?? '')] : []).join('\n')
}

export interface WorkToolViewDeps {
  readonly choose?: (ticket: string, readOnly?: boolean) => Promise<{selectedId:string;targetId:string}>
  readonly store: WorkCardStore
  /** 跳到工作空间对应大卡。 */
  readonly open: (id: string) => void
  /** 简洁版专用：卡下面就地处理（确认 / 拒绝 / 去填写）。经典版不传，小卡和原来一样。 */
  readonly renderActions?: (card: WorkCard) => ReactNode
  /** 简洁版专用（2026-11-01）：整张卡换成简洁版自己的工作卡。给了就不再画经典小卡和 renderActions。 */
  readonly renderCard?: (card: WorkCard, now: number) => ReactNode
}

export function createWorkToolView(deps: WorkToolViewDeps): (props: WorkToolOwnerProps | { history: WorkToolMeta }) => ReactElement {
  return function WorkToolView(props: WorkToolOwnerProps | { history: WorkToolMeta }): ReactElement {
    return 'history' in props ? <Cards meta={props.history} /> : <ToolResult {...props} />
  }
  function ToolResult(props: WorkToolOwnerProps): ReactElement {
    const result = resultOf(props.block)
    const meta = useMemo(() => result ? readWorkToolMeta(result.meta) : null, [result])
    if (!result) return <WorkChatPending label={PENDING_TEXT[props.toolName] ?? '正在处理工作…'} />
    if (!meta || result.isError) {
      const text = resultText(result) || (result.isError ? '这次没查到工作状态。' : '工作工具已完成。')
      return <div className={css['plain']} data-dot-work-plain="">{text}</div>
    }
    return <Cards meta={meta} />
  }
  function Cards({ meta }: { meta: WorkToolMeta }): ReactElement {
    const snapshot = useWorkCards(deps.store)
    const now = useNow()
    // 精简行当种子：全量还没到（或这项工作已经不在最近列表里）时也能先画出来。
    useEffect(() => { if (meta?.works.length) deps.store.seed(meta.works) }, [meta])
    if (meta.kind === 'work-candidates') return <WorkCandidates candidates={meta.candidates} onOpen={deps.open} onChoose={deps.choose} />
    if (!meta.works.length) return <div className={css['plain']} data-dot-work-plain="">目前没有任何工作记录。</div>
    const origin = meta.kind === 'work-created' ? 'created' : meta.kind === 'work-cancelled' ? 'cancelled' : 'progress'
    return <div className={css['cardStack']}>
      {meta.works.slice(0, MAX_CHAT_CARDS).map(seed => {
        const card = snapshot.cards[seed.id] ?? seed
        /* data-dot-work-chat-card 要留在外层：answer-only.ts 和简洁版的折叠放行都靠它认出「这里有工作卡」。 */
        if (deps.renderCard) return <div key={seed.id} data-dot-work-chat-card="" data-dot-lite-card="">{deps.renderCard(card, now)}</div>
        const chatCard = <WorkChatCard key={seed.id} card={card} now={now} onOpen={deps.open} origin={origin} />
        return deps.renderActions ? <div key={seed.id} data-dot-lite-card="">{chatCard}{deps.renderActions(card)}</div> : chatCard
      })}
      {meta.works.length > MAX_CHAT_CARDS && <div className={css['plain']} data-dot-work-more="">还有 {meta.works.length - MAX_CHAT_CARDS} 项工作，在工作空间里都能看到。</div>}
    </div>
  }
}
