import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export { CapabilityDirectory, DotCapabilitiesController } from './capabilities.ts';
export type { CapabilityRow, CapabilitySnapshot } from './capabilities.ts';
export { readDocument, readDocumentBytes } from './documents.ts';
export type { DocumentReadResult } from './documents.ts';
export { registerDocumentTool } from './documents-tool.ts';
export { registerArtifactTools, WRITE_ARTIFACT_TOOL, COMPUTE_TABLE_TOOL } from './artifacts-tool.ts';
export { computeTable, computeTableFile, writeArtifact } from './artifacts.ts';
export type { ArtifactWriteResult, TableComputeResult, ColumnStats } from './artifacts.ts';
/**
 * 部署配置。
 *
 * `documentsRoot` 是文档读取工具允许访问的根目录。**必须显式给**，理由：
 * 插件进程的 `process.cwd()` 是"从哪启动"的结果，不是"用户的资料在哪"。
 * 在独立 DOT 实例里它通常就是工程根——那里面有 `.dsh/`（配置、会话、凭据），
 * 让模型能按路径读那里，等于把配置和凭据递进模型上下文。
 * 缺省值取启动目录只是"没配就不崩"，真正的部署应在 patch 里写死用户资料目录。
 */
export interface Config {
    /** 文档读取允许的根目录（绝对路径，通常是会话工作区）。 */
    readonly documentsRoot?: string;
}
/** 配置 schema：只有一个字段，缺省跟随启动目录（并在日志里明示）。 */
export declare const Config: z<Config>;
/** Loader 诊断里显示的名字。 */
export declare const name = "dot-runtime";
/** 需要工具注册表与 Typert：没有它们就没有目录、也没有 Remote 出口。 */
export declare const inject: string[];
/**
 * 装配 DOT 的 Host 面。
 * @param ctx - Host 侧 Cordis 上下文
 */
export declare function apply(ctx: Context, config: Config): void;
export { extractFileText, writeFileSidecar, readFileSidecarBlock, LIMITS as FILE_TEXT_LIMITS, extOf, zipBombReason, installFileTextHooks, FILE_EXTRACT_SYMBOL, FILE_TEXT_SYMBOL } from './file-extract.ts';
export { handleFileDownload, FILE_DOWNLOAD_PATH } from './file-download.ts';
