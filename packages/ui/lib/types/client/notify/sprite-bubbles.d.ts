import type { DotNotice, NoticeChannel } from './notices.ts';
export declare const MAX_VISIBLE = 2;
export declare const INFO_DISMISS_MS = 6000;
export interface SpriteBubblesSnapshot {
    readonly visible: readonly DotNotice[];
    /** 排队中、还没露出来的条数。 */
    readonly queued: number;
    /** 露在外面的气泡里有没有「要确认」。 */
    readonly confirmShown: boolean;
}
export interface SpriteBubbleTimers {
    readonly setTimeout: (fn: () => void, ms: number) => unknown;
    readonly clearTimeout: (handle: unknown) => void;
}
export declare class SpriteBubbleQueue {
    private readonly timer;
    private readonly dismissMs;
    private readonly covered;
    private items;
    private snapshot;
    private readonly listeners;
    private readonly timers;
    private readonly held;
    constructor(timer?: SpriteBubbleTimers, dismissMs?: number, covered?: (notice: DotNotice) => boolean);
    getSnapshot: () => SpriteBubblesSnapshot;
    subscribe: (listener: () => void) => (() => void);
    /** 作为分发层的「精灵」渠道。 */
    readonly channel: NoticeChannel;
    push(notice: DotNotice): void;
    dismiss(key: string): void;
    /** 收掉已经被屏幕上的工作卡展示了的气泡（卡后出现、或滚进视口时）。只收起，不记回执。 */
    sweepCovered(): void;
    /** 手指 / 焦点停在气泡上：暂停自动收起；离开后重新计时。 */
    hold(key: string, holding: boolean): void;
    clear(): void;
    private arm;
    private clearTimer;
    private publish;
}
