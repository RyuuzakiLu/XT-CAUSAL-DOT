import { type WorkToolMeta } from './work-cards/work-card.ts';
import type { FollowState } from './session-follow.ts';
export declare const ROLLOVER_TITLE = "\u63A5\u7740\u4E0A\u6B21\u804A";
export declare const MAX_ROWS = 300;
/** 会话记录里的持久图片引用（原生 ImageAttachmentRef 的子集）。 */
export interface ChainImage {
    readonly attachmentId: string;
    readonly mediaType?: string;
    readonly width?: number;
    readonly height?: number;
    readonly bytes?: number;
    readonly name?: string;
}
export interface ChainRow {
    readonly key: string;
    readonly sessionId: string;
    readonly role: 'user' | 'assistant' | 'work';
    readonly work?: WorkToolMeta;
    readonly text: string;
    /** 用户消息里能取回的图片（来源会话 sessionId 授权）。 */
    readonly images?: readonly ChainImage[];
    readonly at?: number;
}
export interface HistoryRow {
    readonly id: string;
    readonly title: string;
    readonly blank?: boolean;
}
export interface SessionBrief {
    readonly id: string;
    readonly updatedAt?: number;
    readonly blank?: boolean;
}
/** 简洁版这次该打开的那一个会话；一个会话都没有时是 undefined（原生输入栏发第一句时会建）。 */
export declare function pickSingleSession(rows: readonly SessionBrief[], state: FollowState | null): string | undefined;
/** 简洁版里 sessionId 上方要拼的会话：其余有消息的主会话，按最后活动时间从早到晚。 */
export declare function singleSessionBefore(sessionId: string, rows: readonly SessionBrief[]): string[];
/** 几个会话的原话合成一条时间线：有时间的按时间排；没有时间的跟在同会话上一条后面（稳定排序）。 */
export declare function mergeByTime(parts: readonly (readonly ChainRow[])[]): ChainRow[];
/** id 之前的整条链，从最早到最近（不含 id 自己）；防环、限长。 */
export declare function chainBefore(id: string | undefined, state: FollowState | null, limit?: number): string[];
/** 历史列表合并：链上有后继（且后继也在列表里）的旧会话不单列；留下的那条用链上最早的真标题。顺序沿用原生目录。
    另外：作废换会话留下的空会话（标题「接着上次聊」、没有前任、一句话没有）不单列——里面什么都没有，服务端下次换会话会复用它。 */
export declare function mergeChainRows(rows: readonly HistoryRow[], state: FollowState | null): HistoryRow[];
type Json = unknown;
/** 正文 + 图片：有附件引用的图片收进 refs；没有引用（取不回来）的只计数，留给占位。 */
export declare function textBlocks(content: Json): {
    text: string;
    images: number;
    refs: ChainImage[];
};
/** 一个会话的可见原话：真用户消息 + 助手正文（同一回合里多步的正文并成一条）。不含推理、工具、接续块、时间行。 */
export declare function visibleRows(sessionId: string, records: readonly Json[]): ChainRow[];
export type PageResult = {
    ok: true;
    value: {
        records: readonly Json[];
        hasMore: boolean;
    };
} | {
    ok: false;
    error: {
        code?: string;
        message?: string;
    };
};
export type PageFn = (request: {
    address: {
        kind: 'session';
        sessionId: string;
    };
    throughSeq: number;
    beforeSeq?: number;
    maxMessages?: number;
}) => Promise<PageResult>;
/** 读一个旧会话的可见原话（最近 maxRows 条）。先探出日志末尾（原生要求 throughSeq 不超过末尾），再往回翻页。 */
export declare function loadSessionRows(sessionId: string, page: PageFn, maxRows?: number): Promise<ChainRow[]>;
export interface ChainSource {
    /** 当前会话之前要拼的原话（从早到晚）；没有链就是空数组。 */
    rowsFor(sessionId: string): Promise<ChainRow[]>;
    /** 换会话链信息变了（新换会话）：让缓存的链失效。 */
    setState(state: FollowState | null): void;
    state(): FollowState | null;
}
/** 前文来源：链来自跟随接口，原话来自 session/page；每个旧会话的原话缓存 5 分钟。 */
export declare function createChainSource(deps: {
    page: PageFn;
    load(): Promise<FollowState | null>;
    now?(): number;
    ttlMs?: number;
    /** 简洁版：换掉「拼哪些会话」的规则（其余所有主会话），并按时间合成一条。不给就是经典版的换会话链。 */
    before?(sessionId: string, state: FollowState | null): string[];
}): ChainSource;
/** 极简、安全的 Markdown → DOM（只用 textContent，不拼 HTML）：段落、换行、列表、标题、代码块、行内代码、粗体、http(s) 链接。 */
export declare function renderMarkdown(doc: Document, text: string): DocumentFragment;
/** 前文里的图片挂载器：把 images 画进 host，返回卸载函数。来源会话 sessionId 用来授权取图。 */
export type MountImages = (host: HTMLElement, images: readonly ChainImage[], sessionId: string) => () => void;
/** 一条前文的 DOM：结构对齐原生（data-chat-flow-kind=user / assistant-step），好让对话空间现有皮肤直接套上。
    用户消息带图片时：有 mountImages 就在气泡上方挂图集（原生也是图在上、字在下）；没有就退回〔图片〕占位。 */
export declare function renderRow(doc: Document, row: ChainRow, mountImages?: MountImages, mounts?: Map<HTMLElement, () => void>): HTMLElement;
export interface ChainMountDeps {
    /** 当前会话之前要拼的原话。 */
    rowsFor(sessionId: string): Promise<ChainRow[]>;
    mountWork?(host: HTMLElement, meta: WorkToolMeta): () => void;
    /** 用户消息里的图片（简洁版图集）；不给就显示〔图片〕占位。 */
    mountImages?: MountImages;
    doc?: Document;
    /** 只挂 DOT 对话空间里的原生滚动区。 */
    scrollSelector?: string;
    /** 诊断（只有编号和条数，不含内容）。 */
    trace?(info: {
        at: number;
        session?: string;
        rows?: number;
        reason: string;
    }): void;
}
/** 把前文挂到原生滚动区最前面；会话换了就换内容；原生重绘挤掉了就重挂。 */
export declare function installChainHistory(deps: ChainMountDeps): {
    refresh(): void;
    stop(): void;
};
export {};
