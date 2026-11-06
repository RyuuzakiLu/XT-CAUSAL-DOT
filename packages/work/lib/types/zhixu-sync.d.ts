import type { WorkRecord } from './types.ts';
/** 知序调用：工具名 + 参数 + 账号，返回 body.data；失败抛错。 */
export type ZhixuInvoke = (tool: string, args: Record<string, unknown>, actor: string) => Promise<any>;
/** 一件工作对应的知序待办。 */
export interface ZhixuLink {
    readonly taskId: string;
    readonly version: number;
    /** 上次写进知序的内容指纹；没变就不写，避免星邮匣刷屏。 */
    readonly key: string;
    /** 关联来源：astra = 接管 ASTRA 建的那条；created = 我们新建的。 */
    readonly source: 'astra' | 'created';
    /** 接管 ASTRA 那条时它原来的说明；我们的状态块接在它后面，不覆盖。 */
    readonly base?: string;
}
export interface ZhixuSyncOptions {
    readonly invoke?: ZhixuInvoke;
    readonly file?: string;
    readonly timeZone?: string;
    readonly logger?: {
        info(message: string): void;
        warn(message: string): void;
    };
    /** 是否启用；默认：有 DOT_ZHIXU_URL 和 DOT_ZHIXU_KEY 才启用。 */
    readonly enabled?: boolean;
}
/** 知序待办状态 + 说明块。 */
export interface ZhixuTarget {
    readonly status: 'pending' | 'in_progress' | 'done' | 'canceled';
    readonly block: string;
}
/**
 * 工作记录 → 知序目标状态；undefined 表示这个状态不用同步。
 * @param record - 工作记录
 */
export declare function zhixuTargetOf(record: WorkRecord): ZhixuTarget | undefined;
/** 标题规范化：去空白和常见标点、转小写。 */
export declare function normalizeTitle(title: string): string;
/** 标题是否算同一件事：规范化后相等，或较短的一边（≥4 字）被较长的一边包含。 */
export declare function titlesMatch(a: string, b: string): boolean;
/** 默认知序调用：跟 @xtcausal/dot-zhixu/lib/client.js 同一个协议，单独实现以免包互相依赖。 */
export declare const defaultZhixuInvoke: ZhixuInvoke;
/**
 * 工作 → 知序同步器。每件工作串行，状态指纹没变就不写。
 */
export declare class WorkZhixuSync {
    private readonly invoke;
    private readonly file;
    private readonly timeZone;
    private readonly logger;
    readonly enabled: boolean;
    private links;
    private loading;
    private readonly chains;
    private saving;
    constructor(options?: ZhixuSyncOptions);
    /** 收到一次工作发布；排进这件工作自己的队列。 */
    notify(record: WorkRecord): void;
    /** 等所有排队的同步做完（测试和关停用）。 */
    idle(): Promise<void>;
    /** 读当前链接（测试用）。 */
    linkOf(workId: string): Promise<ZhixuLink | undefined>;
    private actorOf;
    private load;
    private save;
    private describe;
    private sync;
    /** 找到或新建这件工作对应的知序待办。 */
    private attach;
    private update;
}
