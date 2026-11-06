import type { WorkSnapshot } from '@xtcausal/dot-contracts';
export type WorkCardStatus = 'queued' | 'running' | 'waiting-input' | 'waiting-approval' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
/** 界面配色与分组用的粗粒度语气。 */
export type WorkCardTone = 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'stopped';
export interface WorkCardStep {
    readonly index: number;
    readonly label: string;
    readonly status: 'pending' | 'running' | 'done' | 'failed';
}
export interface WorkCardArtifact {
    readonly id: string;
    readonly title: string;
    readonly mimeType?: string;
}
export interface WorkCard {
    readonly id: string;
    /** 工作目标原文。精简行（工具 meta）里没有目标时为空串。 */
    readonly title: string;
    readonly status: WorkCardStatus;
    readonly tone: WorkCardTone;
    /** 后端写的阶段文字；可能为空串。 */
    readonly stage: string;
    /** 当前在做什么：运行中的那一步，没有步骤时退回阶段文字。 */
    readonly doing: string;
    /** 已知步骤（后端没给就是空数组）。 */
    readonly steps: readonly WorkCardStep[];
    /** 只有已知步骤时才有：当前第几步 / 共几步。 */
    readonly position?: {
        readonly current: number;
        readonly total: number;
    };
    /** 0–100 整数；只在后端给了可靠进度时出现。 */
    readonly progress?: number;
    readonly createdAt?: string;
    readonly updatedAt: string;
    /** 全量快照的修订号；精简行没有修订号时为 -1。 */
    readonly revision: number;
    /** 待用户处理的事项（补充信息或确认）。 */
    readonly attention?: {
        readonly kind: 'input' | 'approval';
        readonly message: string;
        readonly code?: string;
        readonly risk?: string;
        /**
         * 用户可以点开的入口（保密表单 / 第三方授权页）。
         * ⚠️ 只来自后端 `blocked.action`，本层不拼地址也不猜；没有就只是普通文字说明。
         */
        readonly action?: {
            readonly kind: 'open-url';
            readonly label: string;
            readonly url: string;
            readonly requestId?: string;
        };
    };
    readonly artifacts: readonly WorkCardArtifact[];
    /** 产出数：全量快照里等于 artifacts.length；精简行只知道个数。 */
    readonly artifactCount: number;
    readonly error?: string;
    readonly queuedReason?: string;
    readonly sessionId?: string;
    /** true：只来自工具 meta 的精简行，缺目标、步骤、产出明细，等全量快照补齐。 */
    readonly partial: boolean;
}
export declare function isWorkCardStatus(value: unknown): value is WorkCardStatus;
export declare function toneOf(status: WorkCardStatus): WorkCardTone;
/** 终态：不会再变，不再需要盯推送。 */
export declare function isTerminal(status: WorkCardStatus): boolean;
/** 从已知步骤推出“当前第几步”。没有步骤就不推。 */
export declare function stepPosition(steps: readonly WorkCardStep[], status: WorkCardStatus): WorkCard['position'];
/** 全量快照 → 工作卡。 */
export declare function workCardFromSnapshot(work: WorkSnapshot): WorkCard;
/** 工具结果 meta 的一行（`{workId,status,stage?,updatedAt?,progress?,artifactCount?}`）→ 精简工作卡。
    meta 来自会话日志，可能是旧版本写的，所以逐字段校验，不合法返回 null。 */
export declare function workCardFromToolRow(row: unknown): WorkCard | null;
/** 读工具结果 meta：`{dot:'work', kind, works:[...] , candidates?:[...]}`。 */
export interface WorkToolMeta {
    readonly kind: 'work-progress' | 'work-created' | 'work-cancelled' | 'work-candidates';
    readonly works: readonly WorkCard[];
    readonly candidates: readonly {
        readonly id: string;
        readonly title: string;
        readonly status: WorkCardStatus;
        readonly stage: string;
        readonly ticket?: string;
    }[];
}
export declare function readWorkToolMeta(meta: unknown): WorkToolMeta | null;
export declare const statusText: Record<WorkCardStatus, string>;
/** “3 分钟前”这类相对时间；时间串不合法就返回空串（不猜）。 */
export declare function relativeTime(iso: string, now: number): string;
/** 一句话说清“具体做到哪”。只拼真实字段。 */
export declare function describeWorkCard(card: WorkCard, now?: number): string;
/** 合并：全量快照永远胜过精简行；同为全量时按修订号，同修订号按更新时间。 */
export declare function preferCard(current: WorkCard | undefined, next: WorkCard): WorkCard;
