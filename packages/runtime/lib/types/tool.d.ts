import type { Context } from '@deepseek-ai/cordis';
import type { CapabilityDirectory } from './capabilities.ts';
/** 工具名：带 dot_ 前缀，避免与官方工具撞名。 */
export declare const CAPABILITY_TOOL_NAME = "dot_capabilities";
/**
 * 注册目录工具。
 * @param ctx - Host 上下文（提供 ctx.tools）
 * @param directory - 目录服务
 * @returns 注册的清理函数（交给 ctx.effect 持有）
 */
export declare function registerCapabilityTool(ctx: Context, directory: CapabilityDirectory): () => void;
