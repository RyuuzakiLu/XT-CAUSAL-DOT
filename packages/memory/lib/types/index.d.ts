import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
/** Loader 诊断里显示的名字。 */
export declare const name = "dot-memory";
/** 硬依赖：工具注册表、提示词装配、Remote 注册面。 */
export declare const inject: string[];
/** 插件配置。 */
export interface Config {
    /** 独立 XTMEM 库文件路径（必填；生产绝不复用引擎默认库）。 */
    readonly dbPath: string;
    /** 引擎工作目录（WAL 落在其下 `.hermes/memory/wal`）。 */
    readonly workspaceDir: string;
    /** 本端身份（引擎 actor）；模型与前端不可覆盖。 */
    readonly actor: string;
    /** 默认域（引擎 namespace）；模型与前端不可覆盖。 */
    readonly namespace: string;
    /** Python 解释器。 */
    readonly python: string;
    /** 引擎源码根（`.../memory`）；留空=用包内 vendor。 */
    readonly engineRoot: string;
    /** CLI 入口（`.../xtmem.py`）；留空=用包内 vendor。 */
    readonly cliPath: string;
    /** 单次引擎调用超时（毫秒）。 */
    readonly timeoutMs: number;
    /** 每轮记忆注入条数；0=关闭注入（工具仍可用）。 */
    readonly contextTop: number;
    /** 单条注入最大字符数。 */
    readonly contextMaxChars: number;
    /** 是否注入记忆使用规则段。 */
    readonly injectUsageRules: boolean;
}
export declare const Config: z<Config>;
/** 服务键。 */
export declare const MEMORY_SERVICE_KEY: "dotMemory";
export { MemoryService } from './service.ts';
export type { MemoryServiceConfig, MemoryServiceStatus } from './service.ts';
export { MemoryRemote } from './remote.ts';
export type { MemoryCorrectValue, MemoryForgetValue, MemoryGetValue, MemoryListValue, MemorySearchValue, MemoryStatusValue, MemoryStoreValue, MemoryWatchFrame, } from './types.ts';
export { MemoryEngineError, createXtmemEngine } from './engine.ts';
export type { MemoryEngine, MemoryEngineConfig } from './engine.ts';
export { MemoryPromptInjector, MEMORY_CONTEXT_SECTION, MEMORY_USAGE_SECTION, } from './context.ts';
export type { MemoryContextConfig } from './context.ts';
export { registerMemoryTools, MEMORY_TOOL_NAMES } from './tools.ts';
export type * from './types.ts';
/**
 * 装配记忆适配。
 * @param ctx - Host 上下文
 * @param config - 已由 schemastery 补齐的配置
 */
export declare function apply(ctx: Context, config: Config): void;
