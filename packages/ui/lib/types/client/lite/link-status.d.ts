export type LinkState = 'connected' | 'connecting' | 'disconnected';
export type LinkLevel = 'online' | 'connecting' | 'offline';
/** 连续重连多久还没成功就改报「未连接」。 */
export declare const LINK_GRACE_MS = 15000;
export declare const LINK_LABEL: Record<LinkLevel, string>;
export declare const LINK_COLORS: {
    readonly light: {
        readonly online: "#079455";
        readonly connecting: "#D97706";
        readonly offline: "#D92D20";
    };
    readonly dark: {
        readonly online: "#32D583";
        readonly connecting: "#FDB022";
        readonly offline: "#F97066";
    };
};
/** 纯判定，便于单测。connectingSince = 这一轮「没连上」从什么时候开始（连上时为 null）。 */
export declare function linkLevel(input: {
    connected: boolean;
    link?: LinkState | undefined;
    connectingSince: number | null;
    now: number;
}): LinkLevel;
/** 顶栏用：跟着原生连接状态走；重连超过时限自己翻成「未连接」（到点重算一次，不轮询）。 */
export declare function useLinkLevel(connected: boolean, link: LinkState | undefined, clock?: () => number): LinkLevel;
