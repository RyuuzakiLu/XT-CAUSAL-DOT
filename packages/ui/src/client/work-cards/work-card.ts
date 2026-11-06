/* ================================================================
   DOT 工作卡 · 数据适配层（工作空间大卡与对话小卡共用）
   ▍这是什么
   把后端给的原始工作数据（WorkSnapshot 全量快照、工具 meta 里的精简行）
   翻成一份统一的 WorkCard，再给出一句“做到哪了”。纯函数，不碰 React、不碰网络。
   ▍字段从哪来（后端现状，2026-10-24 读源码确认）
   status / stage / progress(0–1, 可缺) / steps[] / blocked{kind,message,code,risk} /
   artifacts[] / error / queuedReason / createdAt / updatedAt / revision / sessionId / origin。
   ▍修改铁律
   1. 【不】编百分比：progress 缺省就是“算不出”，只显示阶段文字和已知步骤。
   2. 【不】编流程：steps 为空时 position 也为空，不画“第 x/4 步”。
   3. 一句话摘要只拼真实字段；字段缺了就少说一句，不猜。
   ▍更新记录
   *更新：2026-10-24 · 建立：工作空间 × 对话空间联动的统一工作卡*
================================================================ */
import type { WorkSnapshot } from '@xtcausal/dot-contracts'

export type WorkCardStatus = 'queued' | 'running' | 'waiting-input' | 'waiting-approval' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'
/** 界面配色与分组用的粗粒度语气。 */
export type WorkCardTone = 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'stopped'

export interface WorkCardStep {
  readonly index: number
  readonly label: string
  readonly status: 'pending' | 'running' | 'done' | 'failed'
}

export interface WorkCardArtifact {
  readonly id: string
  readonly title: string
  readonly mimeType?: string
}

export interface WorkCard {
  readonly id: string
  /** 工作目标原文。精简行（工具 meta）里没有目标时为空串。 */
  readonly title: string
  readonly status: WorkCardStatus
  readonly tone: WorkCardTone
  /** 后端写的阶段文字；可能为空串。 */
  readonly stage: string
  /** 当前在做什么：运行中的那一步，没有步骤时退回阶段文字。 */
  readonly doing: string
  /** 已知步骤（后端没给就是空数组）。 */
  readonly steps: readonly WorkCardStep[]
  /** 只有已知步骤时才有：当前第几步 / 共几步。 */
  readonly position?: { readonly current: number; readonly total: number }
  /** 0–100 整数；只在后端给了可靠进度时出现。 */
  readonly progress?: number
  readonly createdAt?: string
  readonly updatedAt: string
  /** 全量快照的修订号；精简行没有修订号时为 -1。 */
  readonly revision: number
  /** 待用户处理的事项（补充信息或确认）。 */
  readonly attention?: {
    readonly kind: 'input' | 'approval'
    readonly message: string
    readonly code?: string
    readonly risk?: string
    /**
     * 用户可以点开的入口（保密表单 / 第三方授权页）。
     * ⚠️ 只来自后端 `blocked.action`，本层不拼地址也不猜；没有就只是普通文字说明。
     */
    readonly action?: { readonly kind: 'open-url'; readonly label: string; readonly url: string; readonly requestId?: string }
  }
  readonly artifacts: readonly WorkCardArtifact[]
  /** 产出数：全量快照里等于 artifacts.length；精简行只知道个数。 */
  readonly artifactCount: number
  readonly error?: string
  readonly queuedReason?: string
  readonly sessionId?: string
  /** true：只来自工具 meta 的精简行，缺目标、步骤、产出明细，等全量快照补齐。 */
  readonly partial: boolean
}

const STATUSES: readonly WorkCardStatus[] = ['queued', 'running', 'waiting-input', 'waiting-approval', 'succeeded', 'failed', 'cancelled', 'interrupted']

export function isWorkCardStatus(value: unknown): value is WorkCardStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value)
}

export function toneOf(status: WorkCardStatus): WorkCardTone {
  switch (status) {
    case 'queued': return 'queued'
    case 'running': return 'running'
    case 'waiting-input': case 'waiting-approval': return 'waiting'
    case 'succeeded': return 'done'
    case 'failed': return 'failed'
    default: return 'stopped'
  }
}

/** 终态：不会再变，不再需要盯推送。 */
export function isTerminal(status: WorkCardStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled' || status === 'interrupted'
}

function clampProgress(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.max(0, Math.min(100, Math.round(value * 100)))
}

/** 从已知步骤推出“当前第几步”。没有步骤就不推。 */
export function stepPosition(steps: readonly WorkCardStep[], status: WorkCardStatus): WorkCard['position'] {
  if (!steps.length) return undefined
  const total = steps.length
  const running = steps.findIndex(step => step.status === 'running')
  if (running >= 0) return { current: running + 1, total }
  const failed = steps.findIndex(step => step.status === 'failed')
  if (failed >= 0) return { current: failed + 1, total }
  const done = steps.filter(step => step.status === 'done').length
  if (status === 'succeeded' || done >= total) return { current: total, total }
  return { current: Math.min(total, done + 1), total }
}

function doingOf(steps: readonly WorkCardStep[], stage: string): string {
  const running = steps.find(step => step.status === 'running')
  return running?.label || stage
}

/** 全量快照 → 工作卡。 */
export function workCardFromSnapshot(work: WorkSnapshot): WorkCard {
  const status: WorkCardStatus = isWorkCardStatus(work.status) ? work.status : 'running'
  const steps = work.steps.map(step => ({ index: step.index, label: step.label, status: step.status }))
  const progress = clampProgress(work.progress)
  const position = stepPosition(steps, status)
  return {
    id: work.id,
    title: work.goal,
    status,
    tone: toneOf(status),
    stage: work.stage ?? '',
    doing: doingOf(steps, work.stage ?? ''),
    steps,
    ...(position ? { position } : {}),
    ...(progress !== undefined ? { progress } : {}),
    createdAt: work.createdAt,
    updatedAt: work.updatedAt,
    revision: work.revision,
    ...(work.blocked ? { attention: {
      kind: work.blocked.kind,
      message: work.blocked.message,
      code: work.blocked.code,
      ...(work.blocked.risk ? { risk: work.blocked.risk } : {}),
      /* 入口原样透传（地址由服务端给，界面只负责画一个可点的按钮）。 */
      ...(work.blocked.action === undefined ? {} : { action: { ...work.blocked.action } }),
    } } : {}),
    artifacts: work.artifacts.map(artifact => ({ id: artifact.id, title: artifact.title, ...(artifact.mimeType ? { mimeType: artifact.mimeType } : {}) })),
    artifactCount: work.artifacts.length,
    ...(work.error ? { error: work.error } : {}),
    ...(work.queuedReason ? { queuedReason: work.queuedReason } : {}),
    ...(work.sessionId ? { sessionId: work.sessionId } : {}),
    partial: false,
  }
}

/** 工具结果 meta 的一行（`{workId,status,stage?,updatedAt?,progress?,artifactCount?}`）→ 精简工作卡。
    meta 来自会话日志，可能是旧版本写的，所以逐字段校验，不合法返回 null。 */
export function workCardFromToolRow(row: unknown): WorkCard | null {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return null
  const value = row as Record<string, unknown>
  if (typeof value['workId'] !== 'string' || !value['workId'] || !isWorkCardStatus(value['status'])) return null
  const status = value['status']
  const stage = typeof value['stage'] === 'string' ? value['stage'] : ''
  const progress = clampProgress(typeof value['progress'] === 'number' ? value['progress'] : undefined)
  const artifactCount = typeof value['artifactCount'] === 'number' && value['artifactCount'] >= 0 ? Math.floor(value['artifactCount']) : 0
  return {
    id: value['workId'],
    title: typeof value['goal'] === 'string' ? value['goal'] : '',
    status,
    tone: toneOf(status),
    stage,
    doing: stage,
    steps: [],
    ...(progress !== undefined ? { progress } : {}),
    updatedAt: typeof value['updatedAt'] === 'string' ? value['updatedAt'] : '',
    revision: -1,
    artifacts: [],
    artifactCount,
    partial: true,
  }
}

/** 读工具结果 meta：`{dot:'work', kind, works:[...] , candidates?:[...]}`。 */
export interface WorkToolMeta {
  readonly kind: 'work-progress' | 'work-created' | 'work-cancelled' | 'work-candidates'
  readonly works: readonly WorkCard[]
  readonly candidates: readonly { readonly id: string; readonly title: string; readonly status: WorkCardStatus; readonly stage: string; readonly ticket?: string }[]
}

export function readWorkToolMeta(meta: unknown): WorkToolMeta | null {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return null
  const value = meta as Record<string, unknown>
  if (value['dot'] !== 'work') return null
  const kind = value['kind']
  if (kind !== 'work-progress' && kind !== 'work-created' && kind !== 'work-cancelled' && kind !== 'work-candidates') return null
  const works = Array.isArray(value['works']) ? value['works'].flatMap(row => { const card = workCardFromToolRow(row); return card ? [card] : [] }) : []
  const candidates = Array.isArray(value['candidates']) ? value['candidates'].flatMap((row,i) => {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) return []
    const item = row as Record<string, unknown>
    if (typeof item['workId'] !== 'string' || !isWorkCardStatus(item['status'])) return []
    const ticket = Array.isArray(value['choices']) ? value['choices'][i] : undefined
    return [{ ...(typeof ticket==='string' && ticket ? {ticket} : {}), id: item['workId'], title: typeof item['goal'] === 'string' ? item['goal'] : '', status: item['status'], stage: typeof item['stage'] === 'string' ? item['stage'] : '' }]
  }) : []
  return { kind, works, candidates }
}

export const statusText: Record<WorkCardStatus, string> = {
  queued: '排队中',
  running: '进行中',
  'waiting-input': '等你补充',
  'waiting-approval': '等你确认',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
}

/** “3 分钟前”这类相对时间；时间串不合法就返回空串（不猜）。 */
export function relativeTime(iso: string, now: number): string {
  const at = Date.parse(iso)
  if (!iso || !Number.isFinite(at)) return ''
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 45) return '刚刚'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.round(hours / 24)} 天前`
}

/** 一句话说清“具体做到哪”。只拼真实字段。 */
export function describeWorkCard(card: WorkCard, now: number = Date.now()): string {
  const parts: string[] = []
  const stepText = card.position ? `第 ${card.position.current}/${card.position.total} 步` : ''
  const doing = card.doing ? `「${card.doing}」` : ''
  switch (card.status) {
    case 'queued': parts.push(card.queuedReason ? `排队中，还没开始（${card.queuedReason}）` : '排队中，还没开始'); break
    case 'running': {
      const where = [stepText, doing].filter(Boolean).join(' ')
      parts.push(where ? `正在做${where}` : '正在进行')
      if (card.progress !== undefined) parts.push(`约 ${card.progress}%`)
      break
    }
    case 'waiting-input': parts.push(card.attention ? `停在这一步，等你补充：${card.attention.message}` : `停下来等你补充${doing ? `，卡在${doing}` : ''}`); break
    case 'waiting-approval': parts.push(card.attention ? `等你确认：${card.attention.message}${card.attention.risk ? `（${card.attention.risk}）` : ''}` : `停下来等你确认${doing ? `，卡在${doing}` : ''}`); break
    case 'succeeded': parts.push(card.artifactCount ? `已经做完，产出 ${card.artifactCount} 个文件` : '已经做完'); break
    case 'failed': parts.push(card.error ? `失败了：${card.error}` : `失败了${doing ? `，停在${doing}` : ''}`); break
    case 'cancelled': parts.push('已取消'); break
    case 'interrupted': parts.push(`中断了${doing ? `，停在${doing}` : ''}`); break
  }
  const ago = relativeTime(card.updatedAt, now)
  if (ago && !isTerminal(card.status)) parts.push(`${ago}更新`)
  return parts.join('，')
}

/** 合并：全量快照永远胜过精简行；同为全量时按修订号，同修订号按更新时间。 */
export function preferCard(current: WorkCard | undefined, next: WorkCard): WorkCard {
  if (!current) return next
  if (next.partial && !current.partial) {
    // 精简行只在明显更新时才覆盖状态字段，目标/步骤/产出保留全量的。
    if (!next.updatedAt || next.updatedAt <= current.updatedAt) return current
    const status = next.status
    return { ...current, status, tone: toneOf(status), stage: next.stage || current.stage, doing: next.stage || current.doing, updatedAt: next.updatedAt, ...(next.progress !== undefined ? { progress: next.progress } : {}) }
  }
  if (!next.partial && current.partial) return next
  if (next.revision !== current.revision) return next.revision > current.revision ? next : current
  return next.updatedAt >= current.updatedAt ? next : current
}
