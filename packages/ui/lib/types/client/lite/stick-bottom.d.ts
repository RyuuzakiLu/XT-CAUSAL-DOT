export declare const THRESHOLD = 80;
export declare const SETTLE_MS = 1500;
export declare const MAX_HYDRATE_MS = 20000;
export interface StickOptions {
    /** 滚动区选择器（在 root 里找）。 */
    selector?: string;
    now?: () => number;
    /** 批处理调度（默认 requestAnimationFrame，测试可换）。 */
    schedule?: (fn: () => void) => void;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
    /** 诊断：最近一次状态（无内容）。 */
    trace?: (info: StickTrace) => void;
}
export interface StickTrace {
    following: boolean;
    hydrating: boolean;
    gap: number;
    session: string | null;
    reason: string;
}
export interface StickHandle {
    jump(target?: HTMLElement): void;
    stop(): void;
    state(): {
        following: boolean;
        hydrating: boolean;
        session: string | null;
    };
}
export declare function installStickToBottom(root: HTMLElement, options?: StickOptions): StickHandle;
