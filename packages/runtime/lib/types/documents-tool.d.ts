import type { Context } from '@deepseek-ai/cordis';
/** 工具名：dot_ 前缀避免与官方工具撞名。 */
export declare const READ_DOCUMENT_TOOL = "dot_read_document";
/**
 * 注册文档读取工具。
 * @param ctx - Host 上下文
 * @param workspaceRoot - 允许读取的根目录（通常是配置里的工作区）
 * @returns 注册的清理函数
 */
export declare function registerDocumentTool(ctx: Context, workspaceRoot: string): () => void;
