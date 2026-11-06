import { WorkCardStore, WorkFeed, type WorkFeedOptions, type WorkFeedPort } from '../work-cards/work-card-store.ts';
import { NoticeDispatcher, type DotNotice, type NoticeDispatcherOptions, type PostboxNoticeEvent, type SystemNoticePayload } from './notices.ts';
import { SpriteSignals, type SpritePoseTimers } from './sprite-pose.ts';
import { SpriteBubbleQueue, type SpriteBubbleTimers } from './sprite-bubbles.ts';
import { ApprovalBridge } from './approvals.ts';
import { AwayTracker } from './away-summary.ts';
import type { SpriteBubbleActions } from './SpriteBubbles.tsx';
export interface DotLiveOptions {
    readonly clock?: () => number;
    readonly timers?: SpriteBubbleTimers;
    readonly dismissMs?: number;
    /** 这条气泡的内容是否已由屏幕上的工作卡展示（展示了就不在精灵上重复弹）。默认查 DOM，见 card-coverage.ts。 */
    readonly covered?: (notice: DotNotice) => boolean;
    readonly dispatcher?: Omit<NoticeDispatcherOptions, 'clock'>;
    readonly feed?: WorkFeedOptions;
    /** 手机系统通知栏（platform.showNotification）。不给时视为弹不出，回前台从精灵补弹。 */
    readonly system?: (payload: SystemNoticePayload, onClick: () => void) => boolean | Promise<boolean>;
    readonly poseTimers?: SpritePoseTimers;
    /** 「你不在时完成了几件」的记账。不给时按 localStorage 记；false 关掉（测试用）。见 away-summary.ts。 */
    readonly away?: AwayTracker | false;
}
/** 星邮匣投递回执：via 'sprite' 是用户点了精灵气泡，'native' 是系统通知栏真弹出来了。 */
export type PostboxReceipt = (postboxId: string, via: 'sprite' | 'native') => void;
export interface DotLiveNavigation {
    openWork(workId: string): void;
    openPostbox(postboxId?: string): void;
}
export declare class DotLive {
    private readonly options;
    readonly store: WorkCardStore;
    readonly bubbles: SpriteBubbleQueue;
    readonly dispatcher: NoticeDispatcher;
    readonly approvals: ApprovalBridge;
    readonly signals: SpriteSignals;
    private feedInstance;
    private readonly handled;
    private readonly liveTopics;
    private readonly clock;
    private readonly stopStore;
    private navigation;
    private receipt;
    private awayNotice;
    private readonly awayListeners;
    readonly awaySummary: {
        get: () => DotNotice | null;
        subscribe: (listener: () => void) => (() => void);
        dismiss: () => void;
    };
    private readonly receipted;
    private readonly stopVisibility;
    private readonly away;
    constructor(options?: DotLiveOptions);
    /** remote-adapter 连上星邮匣后接上回执写入。 */
    setPostboxReceipt(receipt: PostboxReceipt): void;
    private markReceipt;
    private open;
    /** 跳转动作由 index.ts 在视图仓库就绪后接上。 */
    setNavigation(navigation: DotLiveNavigation): void;
    /** 业务 Remote 连上后建馈送器：推送优先，断了 5 秒一次查询兜底。 */
    connect(port: WorkFeedPort): WorkFeed;
    get feed(): WorkFeed | null;
    disconnect(): void;
    /** 星邮匣待投递事件。返回 true 表示这条归精灵气泡管（含被去重挡下的同一件事）；false 表示沿用原来的顶部提示。 */
    postbox(event: PostboxNoticeEvent): boolean;
    /** 直接分发一条通知（测试和截图用）。 */
    notify(notice: DotNotice): boolean;
    private sync;
    private sessionOf;
    /** 给 SpriteBubbles 的动作。 */
    readonly actions: SpriteBubbleActions;
    dispose(): void;
}
