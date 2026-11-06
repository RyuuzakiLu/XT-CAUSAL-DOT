import type { MemoryEngine, MemoryEngineConfig } from './engine.ts';
import type { MemoryHit, MemoryWatchFrame } from './types.ts';
/** 服务配置 = 引擎配置 + 产品侧少量开关。 */
export interface MemoryServiceConfig extends MemoryEngineConfig {
    /** 检索默认条数（给模型工具与 Remote 共用的默认值）。 */
    readonly defaultTop?: number;
    /** 单条记忆写入时的默认重要度。 */
    readonly defaultImportance?: number;
    /**
     * 是否云端模式；不传则看 DOT_CLOUD_MODE（'1'/'true'）。
     * 显式传值是为了让测试与装配方不必污染进程环境。
     */
    readonly cloud?: boolean;
    /** 云端数据服务根地址（不含 /v1）；不传则读 DOT_DATA_URL。 */
    readonly dataUrl?: string;
    /** 云端单次请求超时（毫秒）；不传则 30s。 */
    readonly cloudTimeoutMs?: number;
}
/** 服务对外状态。 */
export interface MemoryServiceStatus {
    readonly available: boolean;
    readonly actor: string;
    readonly namespace: string;
    readonly reason?: string | undefined;
    readonly engineVersion?: string | undefined;
}
/**
 * 记忆服务。
 */
export declare class MemoryService {
    private readonly engine;
    private readonly config;
    private readonly cloudMode;
    /** 监听器 → 订阅时绑定的 actor（本地模式恒为 undefined）。 */
    private readonly listeners;
    private lastStatus;
    /** 云端状态缓存：按 actor 分桶，防串号。 */
    private readonly cloudStatus;
    /**
     * @param config - 本地：身份/域/库/路径配置；云端：只需 dataUrl（身份走工牌）
     * @param engine - 可替换的引擎（测试可注入替身；生产按模式自建）
     */
    constructor(config: MemoryServiceConfig, engine?: MemoryEngine);
    /** 是否云端装配（界面/装配方可据此改文案，不参与业务分支判断以外的用途）。 */
    get isCloud(): boolean;
    /**
     * 订阅变更（界面刷新用）；返回取消函数。
     * ⚠️ 云端模式按订阅时的身份绑定：之后即使"工牌"换了人，这条订阅也只听原来那个 actor 的帧。
     */
    subscribe(listener: (frame: MemoryWatchFrame) => void): () => void;
    /**
     * 广播变更。
     * @param frame - 变更帧
     * @param actor - 云端模式下"这次变更属于谁"；本地模式忽略
     */
    private emit;
    /**
     * 取当前身份；云端缺身份即拒（memory/rejected）。
     * @param action - 用于错误文案的动作名
     * @returns actor
     * @throws MemoryEngineError('memory/rejected') 云端无身份时
     */
    private currentActorOrThrow;
    /** 默认条数。 */
    get defaultTop(): number;
    /** 检索。 */
    search(query: string, options?: {
        top?: number;
        project?: string;
    }): Promise<{
        hits: readonly MemoryHit[];
        mode: string;
        verdict?: string | undefined;
    }>;
    /** 保存（引擎 operationId 幂等；成功后广播）。 */
    store(input: {
        text: string;
        operationId: string;
        project?: string;
        importance?: number;
        tags?: readonly string[];
    }): Promise<{
        id?: string | undefined;
        action: 'created' | 'idempotent' | 'skipped' | 'rejected';
        reason?: string | undefined;
    }>;
    /** 纠正（引擎：新条目 + 旧条目退役）。 */
    correct(input: {
        id: string;
        text: string;
        operationId: string;
        reason?: string;
    }): Promise<{
        id: string;
        supersededId: string;
        action: 'corrected';
    }>;
    /** 删除（未确认只预览；确认才真删）。 */
    forget(input: {
        id: string;
        confirmed: boolean;
    }): Promise<{
        removed: number;
        pending?: number | undefined;
        preview?: readonly string[] | undefined;
        tombstoneRegistered?: boolean | undefined;
    }>;
    /** 单条读取。 */
    get(id: string): Promise<MemoryHit | undefined>;
    /** 列表。 */
    list(options?: {
        query?: string;
        limit?: number;
        project?: string;
    }): Promise<readonly MemoryHit[]>;
    /**
     * 状态（本地：一次短缓存；云端：按 actor 分桶缓存）。
     * @param fresh - true 强制重新探测
     * @returns 状态
     */
    status(fresh?: boolean): Promise<MemoryServiceStatus>;
    /** 本端身份（只读展示用）。云端按当前工牌现读。 */
    get actor(): string;
    /**
     * 默认域（只读展示用）。
     * ⚠️ 返回**有效域**：缓存过 status 就用引擎回报值，否则按与引擎相同的收敛规则现算，
     *   保证"界面显示什么域 = 实际读写什么域"，绝不出现两个值。
     */
    get namespace(): string;
}
