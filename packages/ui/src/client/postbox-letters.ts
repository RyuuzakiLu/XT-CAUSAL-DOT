/* ================================================================
   DOT · 星邮匣信件 → 界面行（postbox-letters）· 总导游图

   ◍这是什么
   ① 干什么：把 dotPostbox.list 的一条信变成 LetterRow；知序待办（服务端按任务折好的那条）
      带上 todo：状态、最新进展、动态列表。
   ② 角标口径：at = 这一条最近一次有新动态的时间，精灵角标用它和“上次打开星邮匣”比。
   ③ 谁调用：remote-adapter.ts 的 postbox 域。

   ◍修改铁律
   1. 待办的状态【只】来自服务端 todo.status（知序任务实时值）；read 只是阅读状态，不推断完成。
   2. 服务端 todo 字段丢了（旧网关/字段被过滤）时，只按 id 前缀 zhixu-task: + 正文第一行「状态：X」
      兜底，【不】按标题猜。
   ◍更新记录
   *更新：2026-10-30 · postbox-todo：新建。
   *更新：2026-10-30 · postbox-quiet：服务端把待办的 createdAt 定成「最近一次出声的变动」（新建/完成/取消），
     安静的进度更新不推它，角标（at）因此不被更新点亮；列表上显示的时间改用 updatedAt（最近一次任何动态）。
   ================================================================ */
import type { LetterRow, LetterTodo } from './model.ts'

export const TODO_ID_PREFIX = 'zhixu-task:'
const STATUS_BY_LABEL: Record<string, LetterTodo['status']> = { 待办: 'pending', 进行中: 'in_progress', 已完成: 'done', 已取消: 'canceled' }
const LABEL_BY_STATUS: Record<LetterTodo['status'], string> = { pending: '待办', in_progress: '进行中', done: '已完成', canceled: '已取消' }

/** dotPostbox.list 里一条信的最小形状（只列这里用到的字段）。 */
export interface PostboxListItem {
  readonly id: string
  readonly kind?: string | undefined
  readonly dedupeKey?: string | undefined
  readonly title: string
  readonly body?: string | undefined
  readonly read: boolean
  readonly archived: boolean
  readonly createdAt: number
  readonly updatedAt?: number | undefined
  readonly severity?: string | undefined
  readonly workId?: string | undefined
  readonly deliveries: readonly { readonly channel: string; readonly status: string }[]
  readonly todo?: unknown
}

function todoOf(event: PostboxListItem): LetterTodo | undefined {
  const raw = event.todo as Partial<{ taskId: string; status: string; statusLabel: string; done: boolean; closed: boolean; progress: string; changedAt: number; updates: { id: string; title: string; body: string; at: number; read: boolean }[] }> | undefined
  if (raw && typeof raw === 'object' && typeof raw.taskId === 'string' && raw.status && raw.status in LABEL_BY_STATUS) {
    const status = raw.status as LetterTodo['status']
    return {
      taskId: raw.taskId,
      status,
      statusLabel: LABEL_BY_STATUS[status],
      done: status === 'done',
      closed: status === 'done' || status === 'canceled',
      progress: typeof raw.progress === 'string' ? raw.progress : '',
      updates: Array.isArray(raw.updates)
        ? raw.updates.map(update => ({ id: String(update.id), title: String(update.title ?? ''), body: String(update.body ?? ''), at: new Date(Number(update.at)).toLocaleString(), read: Boolean(update.read) }))
        : [],
    }
  }
  if (!event.id.startsWith(TODO_ID_PREFIX)) return undefined
  const label = /^状态：(待办|进行中|已完成|已取消)/.exec(event.body ?? '')?.[1]
  const status = (label && STATUS_BY_LABEL[label]) || 'pending'
  const progress = /最新进展：([^\n]+)/.exec(event.body ?? '')?.[1] ?? ''
  return { taskId: event.id.slice(TODO_ID_PREFIX.length), status, statusLabel: LABEL_BY_STATUS[status], done: status === 'done', closed: status === 'done' || status === 'canceled', progress, updates: [] }
}

/** 投递摘要中只把真实 failed 状态视作失败；suppressed 不算失败。 */
export function deliveryFailed(delivery: string | undefined): boolean {
  return (delivery ?? '').split('·').some(part => /:\s*failed\s*$/.test(part))
}

/** 一条信 → 界面行。 */
export function letterRowOf(event: PostboxListItem): LetterRow {
  const todo = todoOf(event)
  const changedAt = Number((event.todo as { changedAt?: unknown } | undefined)?.changedAt)
  /* postbox-quiet：待办显示最近一次动态（含安静的进度更新）；普通信的 updatedAt 会随已读/回执变，仍显示 createdAt。 */
  const shownAt = todo && Number(event.updatedAt) > event.createdAt ? Number(event.updatedAt) : event.createdAt
  return {
    id: event.id,
    title: event.title,
    body: event.body ?? '',
    read: event.read,
    archived: event.archived,
    createdAt: new Date(shownAt).toLocaleString(),
    at: Number.isFinite(changedAt) && changedAt > 0 ? changedAt : event.createdAt,
    ...(event.kind ? { kind: event.kind } : {}),
    ...(event.dedupeKey?.startsWith('dot:greeting:') ? { proactive: true } : {}),
    ...(event.severity ? { severity: event.severity } : {}),
    ...(event.workId ? { workId: event.workId } : {}),
    ...(todo ? { todo } : {}),
    delivery: event.deliveries.map(value => `${value.channel}: ${value.status}`).join(' · '),
  }
}
