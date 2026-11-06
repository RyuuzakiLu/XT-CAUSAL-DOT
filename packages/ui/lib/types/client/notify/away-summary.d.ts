import type { WorkCard } from '../work-cards/work-card.ts';
import type { DotNotice } from './notices.ts';
export declare const AWAY_SEEN_KEY = "dot.away.lastSeen.v1";
export interface AwaySeenStore {
    get(): number | null;
    set(at: number): void;
}
export declare const localAwaySeen: AwaySeenStore;
export interface AwayCounts {
    readonly done: number;
    readonly failed: number;
    readonly attention: number;
    readonly interrupted: number;
    /** 按更新时间新→旧。 */
    readonly workIds: readonly string[];
}
/** 数「上次在之后」变成做完 / 没做成 / 等你处理 / 被打断的工作。 */
export declare function countAway(cards: readonly WorkCard[], since: number): AwayCounts;
/** 计数 → 一条气泡。什么都没有时返回 null。 */
export declare function awayNotice(counts: AwayCounts, since: number, now: number): DotNotice | null;
export interface AwayTrackerOptions {
    readonly store?: AwaySeenStore;
    readonly clock?: () => number;
    /** 页面是否可见；不可见时「上次在」不往前走。 */
    readonly visible?: () => boolean;
    readonly intervalMs?: number;
}
/** 记「上次在 DOT 里」的时间，并在第一次全量时给出那条汇总。 */
export declare class AwayTracker {
    private readonly store;
    private readonly clock;
    private readonly visible;
    private checked;
    private timer;
    private readonly stopListeners;
    constructor(options?: AwayTrackerOptions);
    /** 页面可见且已经对过一次时，把「上次在」推到现在。 */
    touch(): void;
    /**
     * 第一次全量到了：返回那条汇总（可能为 null），之后再调一律返回 null。
     * @param cards - 第一次全量里的工作卡
     * @returns 汇总气泡或 null
     */
    hydrated(cards: readonly WorkCard[]): DotNotice | null;
    dispose(): void;
}
