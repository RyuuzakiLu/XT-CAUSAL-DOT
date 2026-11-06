export declare function registerWorkSession(sessionId: unknown): void;
export declare const DOT_CLOUD: boolean;
/** 当前请求/回合的账号（云端 runtime 的 ALS）；本机模式恒为 undefined。 */
export declare function dotCloudActor(): string | undefined;
/** 后台会话 → 所属账号；runtime 的 runAgent 用它给后台回合恢复账号上下文（不写进 tenancy，不出现在用户会话列表）。 */
export declare const DOT_WORK_SESSION_OWNERS: Map<string, string>;
/** 这条工作对当前账号可见吗：云端只认 owner === 当前账号；没有账号上下文一律不可见。 */
export declare function dotOwnerVisible(record: {
    owner?: string;
} | undefined): boolean;
export declare function dotWorkLimits(): {
    perAccount: number;
    global: number;
};
interface GateEntry {
    workId: string;
    actor: string;
    pid: number;
    at: number;
    seen?: number;
}
interface GateState {
    running: GateEntry[];
    queue: GateEntry[];
}
export interface DotWorkGate {
    tryAcquire(workId: string, actor: string | undefined): boolean;
    markRunning(workId: string, actor: string | undefined): void;
    release(workId: string): void;
    sync(queuedIds: Iterable<string>): void;
    snapshot(): GateState;
}
/**
 * 两层并发闸（跨进程）：状态放在共享目录的 state.json，mkdir 当互斥锁，全同步。
 * running = 正在跑；queue = 先来后到。能不能开跑：按队列顺序模拟分配，
 * 全局没满且本账号没满的才占位，轮到自己才放行。死进程的条目自动清掉。
 */
export declare function createDotWorkGate(dir: string): DotWorkGate;
/** runners 表：进表=占名额，出表=还名额（所有 runners.set/delete 自动过闸）。 */
export declare class DotGatedRunners<K extends string, V> extends Map<K, V> {
    private dotGate;
    private dotOwnerOf;
    constructor(gate: DotWorkGate, ownerOf: (id: K) => string | undefined);
    set(id: K, runner: V): this;
    delete(id: K): boolean;
    clear(): void;
}
export declare function workerModel(): {
    provider: string;
    model: string;
} | undefined;
export declare const WORKER_UNCONFIGURED = "\u540E\u53F0\u6A21\u578B\u8FD8\u6CA1\u63A5\uFF1A\u8FD9\u4EF6\u4E8B\u9700\u8981\u540E\u53F0 Worker \u6765\u505A\uFF0C\u4F46\u540E\u53F0\u6A21\u578B\u8FD8\u6CA1\u914D\u7F6E\uFF0C\u6682\u65F6\u505A\u4E0D\u4E86\u3002\u8BF7\u5982\u5B9E\u544A\u8BC9\u7528\u6237\uFF0C\u4E0D\u8981\u81EA\u5DF1\u4EE3\u505A\u3002";
export {};
