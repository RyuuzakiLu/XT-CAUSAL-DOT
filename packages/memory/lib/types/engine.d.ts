import type { MemoryHit } from './types.ts';
/** 引擎调用失败（区别于"没有命中"）。 */
export declare class MemoryEngineError extends Error {
    readonly code: 'memory/engine-unavailable' | 'memory/engine-failed' | 'memory/engine-timeout' | 'memory/rejected';
    constructor(code: 'memory/engine-unavailable' | 'memory/engine-failed' | 'memory/engine-timeout' | 'memory/rejected', message: string);
}
/** 适配器配置：身份/域/路径只在这里出现。 */
export interface MemoryEngineConfig {
    /** Python 解释器（默认 `python`）。 */
    readonly python?: string;
    /** 独立库文件路径；必填——绝不回落到引擎默认库（那可能是生产库）。 */
    readonly dbPath: string;
    /** 引擎工作目录（WAL 落 `<workspace>/.hermes/memory/wal`）。 */
    readonly workspaceDir: string;
    /** 本端身份（引擎的 actor）；写库与可见性过滤都用它。 */
    readonly actor: string;
    /** 默认域（引擎的 namespace）。 */
    readonly namespace: string;
    /** 单次调用超时（毫秒）。 */
    readonly timeoutMs?: number;
    /** 引擎源码根（`.../memory`）；不传则用包内 vendor。 */
    readonly engineRoot?: string;
    /** CLI 入口（`.../xtmem.py`）；不传则用包内 vendor。 */
    readonly cliPath?: string;
    /** 纠正桥脚本；不传则用包内 scripts/xtmem_correct.py。 */
    readonly correctScript?: string;
    /** 单次检索默认条数。 */
    readonly defaultTop?: number;
}
/** 引擎层的能力面（供 service 与测试共用；不含任何"任意路径"参数）。 */
export interface MemoryEngine {
    /** 语义检索。 */
    search(query: string, options?: {
        top?: number;
        project?: string;
    }): Promise<{
        hits: readonly MemoryHit[];
        mode: string;
        verdict?: string;
    }>;
    /** 写一条记忆（引擎 operationId 真幂等）。 */
    store(input: {
        text: string;
        operationId?: string;
        project?: string;
        importance?: number;
        tags?: readonly string[];
    }): Promise<{
        id?: string;
        action: 'created' | 'idempotent' | 'skipped' | 'rejected';
        reason?: string;
    }>;
    /** 纠正：新条目 + 旧条目退役（引擎真指针）。 */
    correct(input: {
        id: string;
        text: string;
        operationId?: string;
        reason?: string;
    }): Promise<{
        id: string;
        supersededId: string;
        action: 'corrected';
    }>;
    /** 删除：未确认只预览；确认才归档 + 登记存根。 */
    forget(input: {
        id: string;
        confirmed: boolean;
    }): Promise<{
        removed: number;
        pending?: number;
        preview?: readonly string[];
        tombstoneRegistered?: boolean;
    }>;
    /** 按 id 精确读取。 */
    get(id: string): Promise<MemoryHit | undefined>;
    /** 关键词/最近列表。 */
    list(options?: {
        query?: string;
        limit?: number;
        project?: string;
    }): Promise<readonly MemoryHit[]>;
    /**
     * 能力状态。
     * `namespace` 是**有效域**（实际读写的那个），不是配置里原样抄来的值——
     * 界面必须展示这个，否则会出现"配置说 dot-personal、实际写 dot-user"的错位。
     */
    status(): Promise<{
        available: boolean;
        namespace: string;
        reason?: string;
        engineVersion?: string;
    }>;
}
/**
 * 构造 XTMEM 适配器。
 * @param config - 身份/域/路径配置（唯一来源）
 * @returns 引擎接口实现
 */
export declare function createXtmemEngine(config: MemoryEngineConfig): MemoryEngine;
