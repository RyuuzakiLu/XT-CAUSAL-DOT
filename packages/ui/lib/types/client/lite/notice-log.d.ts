import type { DotNotice } from '../notify/notices.ts';
export declare const NOTICE_LOG_KEY = "xtcausal.dot.lite.notices.v1";
export type LoggedNotice = {
    readonly key: string;
    readonly at: number;
    readonly kind: DotNotice['kind'];
    readonly tone: DotNotice['tone'];
    readonly eyebrow: string;
    readonly title: string;
    readonly text?: string | undefined;
    readonly workId?: string | undefined;
    readonly postboxId?: string | undefined;
    readonly entryUrl?: string | undefined;
    readonly read: boolean;
};
export declare const noticeLog: {
    subscribe(listener: () => void): () => void;
    get(): readonly LoggedNotice[];
    unread(): number;
    record(notice: DotNotice, read?: boolean): void;
    markRead(key?: string): void;
    clear(): void;
};
