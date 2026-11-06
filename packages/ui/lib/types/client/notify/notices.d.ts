import type { WorkCard } from '../work-cards/work-card.ts';
import type { WorkNotice } from '../work-cards/work-card-store.ts';
/** confirm：要你确认（一直留着）；input：要你补充信息；info：只是告诉你（几秒后自动收起）。 */
export type DotNoticeKind = 'confirm' | 'input' | 'info';
export type DotNoticeTone = 'done' | 'failed' | 'attention' | 'reminder';
export interface DotNotice {
    /** 唯一键：同一键只弹一次。 */
    readonly key: string;
    /** 同一件事的主题键：工作推送和星邮匣各来一条时，靠它只弹一次。 */
    readonly topic: string;
    readonly kind: DotNoticeKind;
    readonly tone: DotNoticeTone;
    readonly source: 'work' | 'postbox';
    /** 气泡顶部的小字，例如「请你确认」「做完了」。 */
    readonly eyebrow: string;
    readonly title: string;
    readonly text: string;
    /** 风险说明：要确认的通知有就必须显示。 */
    readonly risk?: string;
    readonly workId?: string;
    readonly postboxId?: string;
    /** 要你补充时服务端给的入口（同源 /_dot/ 专用页才会被直接打开，见 openNoticeEntry）。 */
    readonly entryUrl?: string;
    /** 入口按钮上的字（服务端给，如「去登录」）；缺省「去填写」。 */
    readonly entryLabel?: string;
    /** true：不自动收起，直到用户处理。 */
    readonly sticky: boolean;
    readonly at: number;
}
/**
 * 气泡「去填写」直达保密表单（2026-10-30 · Hark）。
 * 为什么：后台要用户钥匙时，入口原来只写在工作卡上，气泡点了先跳工作页、再点一次链接，
 * 手机上很容易断。这里只认**同源**、且路径在 /_dot/ 下的入口（服务端 blocked.action 下发的专用页），
 * 其余一律返回 false，调用方照旧打开工作页——不做任意外部跳转。
 */
export declare function openNoticeEntry(url: string | undefined, sameWindow?: boolean): boolean;
/** 工作全局状态里「亲眼看到的状态变化」→ 通知。只认四种变化，其余返回 null。 */
export declare function noticeFromWork(notice: WorkNotice, card: WorkCard | undefined): DotNotice | null;
/** 星邮匣事件的最小形状（和 @xtcausal/dot-postbox 的 PostboxEventView 对齐，只取用得到的字段）。 */
export interface PostboxNoticeEvent {
    readonly id: string;
    readonly kind: string;
    readonly severity: string;
    readonly title: string;
    readonly body?: string | undefined;
    readonly workId?: string | undefined;
    readonly createdAt?: number;
}
/**
 * 星邮匣事件 → 通知。
 * - 工作类事件（work-*）一律算工作通知，和工作推送共用 topic，只弹一次。
 * - 提醒 / 消息类只有「重要」「紧急」才走精灵气泡；普通的返回 null，沿用原来的顶部提示条。
 */
export declare function noticeFromPostbox(event: PostboxNoticeEvent, card: WorkCard | undefined, now: number): DotNotice | null;
/** 通知此刻所处的环境：页面在不在前台。以后安卓壳可以再加「锁屏」「勿扰」。 */
export interface NoticeEnvironment {
    readonly visible: boolean;
}
/** 一个能把通知弹出去的渠道。 */
export interface NoticeChannel {
    readonly id: string;
    /** 返回 false（或兑现为 false）表示没弹出来，分发器会把这条留到回前台再补。 */
    deliver(notice: DotNotice): void | boolean | Promise<boolean>;
    /** 通知已经不成立（例如工作已不在等确认）：收回。 */
    withdraw(key: string): void;
}
/** 路由：给一条通知和当前环境，返回要走哪些渠道。 */
export type NoticeRoute = (notice: DotNotice, environment: NoticeEnvironment) => readonly string[];
/** 旧规则：不管前台后台都从精灵弹。现在只留给测试和截图用。 */
export declare const spriteEverywhere: NoticeRoute;
/** 现在的规则（用户 2026-10-24 定第 2 项 C）：前台走精灵，后台走手机系统通知栏。 */
export declare const foregroundSpriteBackgroundNative: NoticeRoute;
export interface NoticeDispatcherOptions {
    readonly route?: NoticeRoute;
    readonly environment?: () => NoticeEnvironment;
    readonly clock?: () => number;
    /** 同一 topic 在这段时间内只弹一次；默认 10 分钟。 */
    readonly topicWindowMs?: number;
}
export declare class NoticeDispatcher {
    private readonly channels;
    private readonly seenKeys;
    private readonly topics;
    private route;
    private readonly environment;
    private readonly clock;
    private readonly topicWindowMs;
    private readonly deferred;
    constructor(channels: readonly NoticeChannel[], options?: NoticeDispatcherOptions);
    /** 接系统通知栏：addChannel(createSystemNoticeChannel(...)) 或 addChannel(createAndroidNoticeChannel(...))。 */
    addChannel(channel: NoticeChannel): () => void;
    setRoute(route: NoticeRoute): void;
    /** 分发一条通知；被去重挡下或没有可用渠道时返回 false。 */
    dispatch(notice: DotNotice): boolean;
    /** 这条没弹出来：放开去重，留到 flushDeferred（回到前台）再分发一次。 */
    private defer;
    /** 回到前台时调用：把后台没弹出来的通知重新分发（此时会走精灵）。 */
    flushDeferred(): number;
    /** 还在等回前台补弹的通知数（测试用）。 */
    get deferredCount(): number;
    /** 收回某个主题的通知（例如工作已经不在等确认）。 */
    withdrawTopic(topic: string): void;
    /** 某个主题重新允许弹（例如工作离开了等确认，下次再进来要再弹）。 */
    forgetTopic(topic: string): void;
}
/** 工作当前状态对应的「还成立」的主题；不在等待中就没有。 */
export declare function liveWorkTopic(card: WorkCard | undefined): string | null;
export declare function workTopicOf(workId: string, kind: 'approval' | 'input'): string;
/** 交给系统通知栏的一条通知（platform.showNotification 的入参形状）。 */
export interface SystemNoticePayload {
    readonly id: string;
    readonly title: string;
    readonly body: string;
    readonly workId?: string;
}
/**
 * 手机系统通知栏渠道：在安卓壳里走 window.dotAndroid.notify，网页里走 Notification。
 * show 返回 false 表示没弹出来（没权限 / 不支持），分发器会留到回前台从精灵补弹。
 * onShown：真的弹出来了（星邮匣据此记投递回执）；onOpen：用户点了系统通知。
 */
export declare function createSystemNoticeChannel(show: (payload: SystemNoticePayload, onClick: () => void) => boolean | Promise<boolean>, hooks?: {
    onShown?(notice: DotNotice): void;
    onOpen?(notice: DotNotice): void;
}): NoticeChannel;
/** 安卓壳桥的最小形状（platform.ts 里 window.dotAndroid 已有 notify）。 */
export interface AndroidNoticeBridge {
    notify(payload: string): void;
}
/**
 * 直接把通知交给原生壳的渠道（壳支持动作按钮时用）。现在注册的是 createSystemNoticeChannel。
 * payload 是 JSON：{ id, kind, title, body, risk?, workId?, postboxId?, actions }，
 * actions 里 confirm 类给 ['confirm','reject']，input 给 ['fill']，info 给 ['open']。
 * 原生点按后回调网页（例如 dot://notice?id=…&action=confirm），由壳调 onAction 交回来。
 */
export declare function createAndroidNoticeChannel(bridge: AndroidNoticeBridge): NoticeChannel;
