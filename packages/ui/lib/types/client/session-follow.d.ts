export interface FollowState {
    readonly current: string | null;
    readonly rollovers: Readonly<Record<string, {
        readonly from: string;
        readonly createdAt?: number;
    }>>;
}
export interface FollowDeps {
    /** 原生会话目录里现有的会话编号。 */
    ids(): readonly string[];
    /** 原生会话目录变化。 */
    subscribe(listener: () => void): () => void;
    /** 主视图正在看的会话。 */
    viewed(): string | undefined;
    /** 打开会话；目标不在原生目录里时先刷新目录再开（服务端建的会话不推进已打开的网页目录）。 */
    open(id: string): void | Promise<void>;
    load(): Promise<FollowState | null>;
    /** 正在打字：输入框里有字。 */
    draftBusy(): boolean;
    onFollow?(from: string, to: string): void;
    now?(): number;
    storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
    /** 页面回到前台。 */
    onVisible?(listener: () => void): () => void;
    /** 点进输入框。 */
    onComposerFocus?(listener: () => void): () => void;
    /** 页面是否在前台（定时检查只在前台做）。 */
    visible?(): boolean;
    /** 前台定时检查间隔；0 = 不做。 */
    pollMs?: number;
    retryMs?: number;
    debounceMs?: number;
    /** 装好后多久内看到的会话算“页面打开时恢复的”。 */
    restoreWindowMs?: number;
    /** 诊断：每次检查的结论（只有编号和原因，不含内容）。 */
    trace?(info: {
        at: number;
        viewed?: string;
        target?: string;
        reason: string;
        known: number;
    }): void;
}
/** 沿换会话链从 viewed 走到底；只走 openedAt 之后发生的换会话；跟过的不再跟；走不动返回 undefined。
    （目标不要求已在原生目录里：服务端建的会话不推进已打开的网页目录。） */
export declare function followTarget(viewed: string | undefined, state: FollowState | null, openedAt?: number, handled?: ReadonlySet<string>): {
    from: string;
    to: string;
    key: string;
} | undefined;
export declare function installSessionFollow(deps: FollowDeps): () => void;
/** 浏览器里的默认接线：本实例跟随接口 + 原生输入框是否在打字。 */
export declare function loadFollowState(fetchImpl?: typeof fetch): Promise<FollowState | null>;
export declare function composerBusy(doc?: Document): boolean;
