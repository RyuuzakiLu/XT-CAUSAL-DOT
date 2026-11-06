/* ================================================================
   DOT 工作确认桥 · 把原生「等待用户批准」交给精灵气泡里的「确认 / 拒绝」
   ▍这是什么
   工作跑在自己的 DSH 会话里；要批准时，原生审批插件（dsh-client-ui-approval）会在
   uiSession.sessionStatus 里给那个会话挂一个 pendingInteraction（kind = 'approval'），
   它带 answer(outcome)。这里只是按会话编号把它找出来，气泡的按钮调的就是它。
   ▍修改铁律
   1. 【不】自己另答审批请求；只用原生已经挂出来、answerable 的那一条。
   2. 找不到可答的（例如页面刷新后原生还没重新挂出来）就返回 undefined，
      气泡改显示「去处理」，【不】假装确认成功。
   *更新：2026-10-24 · 建立*
================================================================ */

export type ApprovalDecision = 'allow' | 'reject'

/** 原生 PendingApproval 里用得到的字段（鸭子类型，避免依赖原生包的私有类）。 */
export interface NativePendingApproval {
  readonly kind: string
  readonly key?: string
  readonly toolName?: string
  readonly reason?: string
  readonly answerable?: boolean
  answer?(outcome: 'allowed-once' | 'rejected'): void
}

export interface SessionStatusLike { readonly pendingInteraction?: unknown }
export interface SessionStatusSource {
  getSnapshot(): ReadonlyMap<string, SessionStatusLike>
  subscribe(listener: () => void): () => void
}

function asApproval(value: unknown): NativePendingApproval | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as NativePendingApproval
  return candidate.kind === 'approval' && typeof candidate.answer === 'function' ? candidate : undefined
}

export class ApprovalBridge {
  private source: SessionStatusSource | null = null
  private readonly listeners = new Set<() => void>()
  private version = 0

  getVersion = (): number => this.version
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }

  /** 接上原生的 sessionStatus；返回断开函数。 */
  attach(source: SessionStatusSource): () => void {
    this.source = source
    const stop = source.subscribe(() => this.bump())
    this.bump()
    return () => { stop(); if (this.source === source) { this.source = null; this.bump() } }
  }

  private bump(): void { this.version += 1; for (const listener of [...this.listeners]) listener() }

  /** 这个会话当前可答的审批请求。 */
  pending(sessionId: string | undefined): NativePendingApproval | undefined {
    if (!sessionId || !this.source) return undefined
    const approval = asApproval(this.source.getSnapshot().get(sessionId)?.pendingInteraction)
    return approval && approval.answerable !== false ? approval : undefined
  }

  canDecide(sessionId: string | undefined): boolean { return this.pending(sessionId) !== undefined }

  /** 按钮点了「确认」或「拒绝」。确认只允许这一次，不替用户打开长期授权。 */
  decide(sessionId: string | undefined, decision: ApprovalDecision): boolean {
    const approval = this.pending(sessionId)
    if (!approval?.answer) return false
    approval.answer(decision === 'allow' ? 'allowed-once' : 'rejected')
    return true
  }
}
