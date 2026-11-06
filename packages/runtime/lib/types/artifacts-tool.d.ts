import type { Context } from '@deepseek-ai/cordis';
/** 工具名常量：供测试与能力页引用，避免各处拼字符串。 */
export declare const WRITE_ARTIFACT_TOOL = "dot_write_artifact";
export declare const COMPUTE_TABLE_TOOL = "dot_compute_table";
/**
 * 注册成果工具。
 * @param ctx - Host 上下文
 * @param artifactsRoot - 成果根目录（绝对路径，来自部署配置）
 * @returns 注册的清理函数
 */
export declare function registerArtifactTools(ctx: Context, artifactsRoot: string): () => void;
