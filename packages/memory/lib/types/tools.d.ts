import type { ToolRuntime } from '@deepseek-ai/dsh-tools';
import type { MemoryService } from './service.ts';
/** 工具名常量（供能力目录/文档引用，避免各处手写字符串）。 */
export declare const MEMORY_TOOL_NAMES: {
    readonly search: "dot_memory_search";
    readonly store: "dot_memory_store";
    readonly correct: "dot_memory_correct";
    readonly forget: "dot_memory_forget";
};
/**
 * 注册全部记忆工具。
 * @param tools - 工具注册表
 * @param service - 记忆服务
 * @returns 一个总的注销函数（各 register 也各自返回 disposer，这里合并）
 */
export declare function registerMemoryTools(tools: ToolRuntime, service: MemoryService): () => void;
