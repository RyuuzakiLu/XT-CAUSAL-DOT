import type { WorkSnapshot } from '@xtcausal/dot-contracts';
import { type WorkCard, type WorkCardStatus } from './work-card.ts';
export type WorkFeedSource = 'idle' | 'push' | 'poll' | 'offline';
/** 对话里推的一条通知：工作做完、需要你确认/补充、失败。 */
export interface WorkNotice {
    readonly key: string;
    readonly workId: string;
    readonly kind: 'done' | 'attention' | 'failed';
    readonly status: WorkCardStatus;
    readonly title: string;
    readonly text: string;
    readonly at: number;
}
export interface WorkCardsSnapshot {
    readonly cards: Readonly<Record<string, WorkCard>>;
    /** 按更新时间新→旧。 */
    readonly order: readonly string[];
    readonly source: WorkFeedSource;
    readonly notices: readonly WorkNotice[];
    readonly syncedAt: number | null;
    readonly error: string | null;
}
export type WorkFollowFrame = {
    readonly type: 'snapshot';
    readonly works: readonly WorkSnapshot[];
    readonly revision?: number;
} | {
    readonly type: 'changed';
    readonly work: WorkSnapshot;
    readonly revision?: number;
};
export declare class WorkCardStore {
    private readonly clock;
    private snapshot;
    private readonly listeners;
    private readonly dismissed;
    private filled;
    constructor(clock?: () => number);
    getSnapshot: () => WorkCardsSnapshot;
    subscribe: (listener: () => void) => (() => void);
    get(id: string): WorkCard | undefined;
    /** 是否已经拿到过一次全量。 */
    get hydrated(): boolean;
    private publish;
    private orderOf;
    private merge;
    /** 全量（推送 snapshot 帧或轮询结果）。 */
    replaceAll(works: readonly WorkSnapshot[]): void;
    /** 增量（推送 changed 帧）。 */
    upsert(work: WorkSnapshot): void;
    /** 对话里工具结果带来的精简行：只在全量还没有这项工作时当种子。 */
    seed(cards: readonly WorkCard[]): void;
    frame(frame: WorkFollowFrame): void;
    setSource(source: WorkFeedSource, error?: string | null): void;
    dismissNotice(key: string): void;
    /** 还在跑的工作（非终态）。 */
    active(): WorkCard[];
}
export interface WorkFeedPort {
    /** 全量查询（轮询用）。 */
    list(): Promise<readonly WorkSnapshot[]>;
}
export interface WorkFeedOptions {
    /** 推送不可用时的轮询间隔；默认 5000ms。 */
    readonly pollMs?: number;
    readonly setInterval?: (fn: () => void, ms: number) => unknown;
    readonly clearInterval?: (handle: unknown) => void;
}
/** 推送优先、轮询兜底的馈送器。push() 由推送循环调，pushLost() 在推送断开时调。 */
export declare class WorkFeed {
    private readonly store;
    private readonly port;
    private pollHandle;
    private stopped;
    private polling;
    private readonly pollMs;
    private readonly setTimer;
    private readonly clearTimer;
    constructor(store: WorkCardStore, port: WorkFeedPort, options?: WorkFeedOptions);
    /** 收到一帧推送：写入全局状态，推送恢复就停轮询。 */
    push(frame: WorkFollowFrame): void;
    /** 推送断了或没开成：退回定时查询。 */
    pushLost(error?: unknown): void;
    pollOnce(): Promise<void>;
    get isPolling(): boolean;
    private stopPolling;
    stop(): void;
}
