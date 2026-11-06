/* ================================================================
   DOT 记忆卡 · 对话消息流里的工具视图（dot_memory_search）
   ▍这是什么
   挂在原生工具插槽 tool.call.toolview 上：ASTRA 在对话里检索 XTMEM 时，工具那一格画成
   一张记忆卡：查了什么、命中几条、每条原文和更新时间。取代了独立的记忆空间——
   记忆在哪里被用到，就在哪里给人看。
   ▍数据从哪来
   只读工具结果的 meta（@xtcausal/dot-memory 的 presentationMeta：
   dot === 'memory' && kind === 'memory-search'）。不解析给模型看的中文。
   ▍修改铁律
   1. 【不】往会话日志写任何东西：卡片就画在已有的工具结果位置上，刷新重放一致。
   2. 工具报错或 meta 不认识（老版本结果没有 meta）时退回一行纯文字，【不】白屏。
   3. 只读：卡片里不放纠正/删除按钮，改记忆仍然走对话（写入有预检和确认）。
   ▍更新记录
   *更新：2026-10-27 · 建立*
================================================================ */
import { useState, type ReactElement } from 'react'
import type { PreparingToolCall, StartedToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './memory-cards.module.css'

export interface MemoryToolOwnerProps {
  readonly callId: string
  readonly toolName: string
  readonly phase: 'preparing' | 'start' | 'result'
  readonly block?: PreparingToolCall | StartedToolCall | ToolResultNode
}

export const MEMORY_CARD_TOOL_NAMES = ['dot_memory_search'] as const

/** 卡片里默认展开几条；其余点「再看 N 条」。 */
const FOLDED_HITS = 3

export interface MemoryCardHit { readonly id: string; readonly text: string; readonly updatedAt?: number; readonly tier?: string }
export interface MemoryCardMeta { readonly query: string; readonly mode: string | null; readonly count: number; readonly hits: readonly MemoryCardHit[] }

/** 认识就返回卡片数据，不认识返回 null（调用方退回纯文字）。 */
export function readMemoryToolMeta(meta: unknown): MemoryCardMeta | null {
  if (meta === null || typeof meta !== 'object') return null
  const record = meta as Record<string, unknown>
  if (record['dot'] !== 'memory' || record['kind'] !== 'memory-search' || !Array.isArray(record['hits'])) return null
  const hits: MemoryCardHit[] = []
  for (const raw of record['hits'] as unknown[]) {
    if (raw === null || typeof raw !== 'object') continue
    const hit = raw as Record<string, unknown>
    if (typeof hit['id'] !== 'string' || typeof hit['text'] !== 'string') continue
    hits.push({
      id: hit['id'], text: hit['text'],
      ...(typeof hit['updatedAt'] === 'number' ? { updatedAt: hit['updatedAt'] } : {}),
      ...(typeof hit['tier'] === 'string' ? { tier: hit['tier'] } : {}),
    })
  }
  return {
    query: typeof record['query'] === 'string' ? record['query'] : '',
    mode: typeof record['mode'] === 'string' ? record['mode'] : null,
    count: typeof record['count'] === 'number' ? record['count'] : hits.length,
    hits,
  }
}

function resultOf(block: MemoryToolOwnerProps['block']): ToolResultNode | null {
  return block && (block as ToolResultNode).kind === 'tool-result' ? block as ToolResultNode : null
}

function resultText(result: ToolResultNode): string {
  return result.content.flatMap(part => typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'text' ? [String((part as { text?: unknown }).text ?? '')] : []).join('\n')
}

function when(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return ''
  const date = new Date(ms)
  const now = new Date()
  const sameYear = date.getFullYear() === now.getFullYear()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${sameYear ? '' : `${date.getFullYear()}-`}${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const TIER_LABEL: Record<string, string> = { refined: '精选', raw: '原料' }

export function MemoryToolView(props: MemoryToolOwnerProps): ReactElement {
  const [open, setOpen] = useState(false)
  const result = resultOf(props.block)
  if (!result) return <div className={css['pending']} data-memory-card="pending"><span className={css['dot']} aria-hidden="true" />正在翻记忆…</div>
  const meta = result.isError ? null : readMemoryToolMeta(result.meta)
  if (!meta) {
    const text = resultText(result).trim()
    return <div className={css['plain']} data-memory-card="plain">{result.isError ? `记忆检索没成功：${text || '未知原因'}` : (text || '记忆检索已完成。')}</div>
  }
  const shown = open ? meta.hits : meta.hits.slice(0, FOLDED_HITS)
  const hidden = meta.hits.length - shown.length
  return <section className={css['card']} data-memory-card="" data-memory-hits={meta.hits.length} aria-label="记忆检索结果">
    <header className={css['head']}>
      <span className={css['mark']} aria-hidden="true">✦</span>
      <strong>记忆</strong>
      <span className={css['count']}>{meta.hits.length === 0 ? '没有找到' : `找到 ${meta.count} 条`}</span>
    </header>
    {meta.query && <p className={css['query']}>查找：{meta.query}</p>}
    {meta.hits.length === 0
      ? <p className={css['empty']}>XTMEM 里没有和这件事相关的记忆。</p>
      : <ol className={css['list']}>
          {shown.map(hit => <li key={hit.id} className={css['hit']} data-memory-id={hit.id}>
            <p className={css['text']}>{hit.text}</p>
            <p className={css['meta']}>
              <code>m:{hit.id.replace(/^mem-/, '').slice(0, 8)}</code>
              {hit.tier && <span>{TIER_LABEL[hit.tier] ?? hit.tier}</span>}
              {hit.updatedAt !== undefined && <time dateTime={new Date(hit.updatedAt).toISOString()}>{when(hit.updatedAt)}</time>}
            </p>
          </li>)}
        </ol>}
    {(hidden > 0 || (open && meta.hits.length > FOLDED_HITS)) && <button type="button" className={css['more']} onClick={() => setOpen(value => !value)}>
      {open ? '收起' : `再看 ${hidden} 条`}
    </button>}
  </section>
}
