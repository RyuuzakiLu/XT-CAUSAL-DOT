/**
 * 对话进度状态行（2026-10-27）。
 *
 * 对话里只显示最终回答（见 answer-only.ts），但 ASTRA 做到哪一步要让人看得见：
 * - 对话空间顶栏“对话空间”下面那行小字（平时是 Conversation），回合进行中换成“正在翻记忆”这样的状态；
 * - 对话里 DSH 自带的那一行运行提示（[data-chat-running]，原文是“深度求索中，用时 N秒”）改成同一句状态 + 用时。
 *
 * 做法参考 dsh-status-rotator：盯住当前对话会话的 eventSource，从 turn/start、tool/call、tool/result、
 * turn/end 事件和 assistant/live-chunk 里的 reasoning-delta / tool-call-delta / text-delta 判断阶段，
 * 再改写运行行的文字。不动 DSH 的数据，只改显示；工具名一律翻成口语，不露英文。
 */
export declare function toolPhrase(name: string | undefined): string;
export declare const turnStatus: {
    get: () => string | null;
    subscribe(listener: () => void): () => void;
};
interface Observable<T> {
    getSnapshot(): T;
    subscribe(listener: () => void): () => void;
}
interface Deps {
    sessions: {
        binding(id: any): {
            eventSource?: Observable<any>;
        } | null | undefined;
        retainInfo(id: any): Observable<{
            retainedBy: Record<string, number | undefined>;
        }>;
    };
    uiSession: {
        sessionStatus: Observable<any>;
        pendingInteractions?: Observable<any>;
    };
}
/** 盯住主对话会话，算出当前阶段，写进 turnStatus。 */
export declare function watchTurnStatus({ sessions, uiSession }: Deps): () => void;
export declare const TURN_STATUS_CSS = "\n[data-dot-turn-status=\"live\"] { font-style: normal !important; letter-spacing: .02em; opacity: .92; }\n";
/** dots=false（简洁版）：运行行末尾不加「 ···」，在干活由样式里的呼吸点表示。 */
export declare function installTurnStatusDisplay(root?: Document, options?: {
    dots?: boolean;
}): () => void;
export {};
