import type { Context } from '@deepseek-ai/cordis';
import type { MemoryService } from './service.ts';
/** 注入段落名（固定；先按名剔除再加，防止热重载后叠加两份）。 */
export declare const MEMORY_CONTEXT_SECTION = "dot-memory:context";
export declare const MEMORY_USAGE_SECTION = "dot-memory:usage";
/** 上下文注入配置。 */
export interface MemoryContextConfig {
    /** 每轮现捞条数（默认 5）。 */
    readonly top?: number;
    /** 触发检索的最短问题长度（太短的寒暄不必检索，默认 8）。 */
    readonly minQueryChars?: number;
    /** 单条注入正文的最大字符数（防止一条巨文撑爆提示词，默认 400）。 */
    readonly maxCharsPerHit?: number;
    /** 是否注入使用规则段（默认 true）。 */
    readonly injectUsageRules?: boolean;
}
/**
 * 记忆注入器：持有会话级缓存与事件订阅。
 */
export declare class MemoryPromptInjector {
    private readonly service;
    private readonly freeze;
    private readonly turns;
    private readonly pending;
    private readonly offs;
    private readonly top;
    private readonly minQueryChars;
    private readonly maxCharsPerHit;
    private readonly injectUsageRules;
    /**
     * @param ctx - Host 上下文（订阅 session/event 与 system-prompt/assemble）
     * @param service - 记忆服务
     * @param config - 注入配置
     */
    constructor(ctx: Context, service: MemoryService, config?: MemoryContextConfig);
    /** 释放订阅（由插件 effect 持有）。 */
    dispose(): void;
    /**
     * 生成（或复用）本轮上下文段。
     * @param agentId - 会话/Agent id；取不到时按"不缓存"处理（宁可不冻结，也不串会话）
     * @returns 段落文本；空串表示本轮不加
     */
    private buildSection;
}
