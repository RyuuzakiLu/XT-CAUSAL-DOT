export type ApprovalDecision = 'allow' | 'reject';
/** 原生 PendingApproval 里用得到的字段（鸭子类型，避免依赖原生包的私有类）。 */
export interface NativePendingApproval {
    readonly kind: string;
    readonly key?: string;
    readonly toolName?: string;
    readonly reason?: string;
    readonly answerable?: boolean;
    answer?(outcome: 'allowed-once' | 'rejected'): void;
}
export interface SessionStatusLike {
    readonly pendingInteraction?: unknown;
}
export interface SessionStatusSource {
    getSnapshot(): ReadonlyMap<string, SessionStatusLike>;
    subscribe(listener: () => void): () => void;
}
export declare class ApprovalBridge {
    private source;
    private readonly listeners;
    private version;
    getVersion: () => number;
    subscribe: (listener: () => void) => (() => void);
    /** 接上原生的 sessionStatus；返回断开函数。 */
    attach(source: SessionStatusSource): () => void;
    private bump;
    /** 这个会话当前可答的审批请求。 */
    pending(sessionId: string | undefined): NativePendingApproval | undefined;
    canDecide(sessionId: string | undefined): boolean;
    /** 按钮点了「确认」或「拒绝」。确认只允许这一次，不替用户打开长期授权。 */
    decide(sessionId: string | undefined, decision: ApprovalDecision): boolean;
}
