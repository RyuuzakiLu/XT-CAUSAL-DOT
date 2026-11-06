/* ================================================================
   DOT 运行装配 · 总导游图

   ▍这是什么
   DOT 自己的 Host 面装配插件。它不做业务（工作/记忆/邮匣各有主人），只做两件
   现在就能做真的、且没有别人能替的事：
   1. 提供 `dotCapabilities` Remote 服务：从**真实注册表**里读出当前可调用的工具，
      浏览器通过生成的 `ctx.remote.dotCapabilities.list()` 读同一份事实。
   2. 注册一个面向模型的 `dot_capabilities` 工具：让 ASTRA 被问"你能干什么"时
      回答的是注册表事实，而不是照抄设计文档。

   ▍为什么能力目录必须来自注册表
   设计稿里的能力卡片一旦和真实注册表脱钩，就会出现"界面说有搜索、模型其实调不到"
   的双份真相——用户点了没反应，还会以为是模型笨。注册表是唯一事实；目录只是它的投影。

   ▍为什么启停不在这里实现
   官方 `dsh-plugin-manager` 已经拥有"启停 profile 里的插件行"的全部规则与持久化。
   再造一个开关，就会出现两个地方都能改同一件事、且互相不知道对方改过。

   ▍结构
   src/index.ts        插件入口：name/inject/apply
   src/capabilities.ts 目录服务 + Remote 出口（namespace dotCapabilities）
   src/tool.ts         模型可见的 dot_capabilities 工具

   ▍修改铁律
   1. 【不】在这里写死工具名清单；一切从 ctx.tools 读。
   2. 【不】把"可用"判成"注册了就行"——注册但当前 scope 不可见的工具不算可用。
   3. 【不】在模块顶层建单例、定时器或注册；一切交给 apply + ctx.effect。

   ▍更新记录
   2026-10-23 · 建立：真实能力目录服务 + 模型可见目录工具；
                同日补 Remote（浏览器读同一份事实）。
   ================================================================ */
import { join } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { CapabilityDirectory, DotCapabilitiesController } from "./capabilities.js";
import { registerCapabilityTool } from "./tool.js";
import { registerDocumentTool } from "./documents-tool.js";
import { registerArtifactTools } from "./artifacts-tool.js";
import { installFileTextHooks } from "./file-extract.js";
import { FILE_DOWNLOAD_PATH, handleFileDownload } from "./file-download.js";
// ⚠️ 必须把 Remote owner 类**从包入口再导出**：Typert 只分析入口可达的公开导出，
// 只在 index 里 import 而不 export，生成器会认为这个包"没有 Remote 方法"，
// 于是 ./remote 产物永远生不出来（实测报 "publishes Remote artifacts but has no Remote methods"）。
export { CapabilityDirectory, DotCapabilitiesController } from "./capabilities.js";
export { readDocument, readDocumentBytes } from "./documents.js";
export { registerDocumentTool } from "./documents-tool.js";
export { registerArtifactTools, WRITE_ARTIFACT_TOOL, COMPUTE_TABLE_TOOL } from "./artifacts-tool.js";
export { computeTable, computeTableFile, writeArtifact } from "./artifacts.js";
/** 配置 schema：只有一个字段，缺省跟随启动目录（并在日志里明示）。 */
export const Config = z.object({
    documentsRoot: z.string(),
});
/** Loader 诊断里显示的名字。 */
export const name = 'dot-runtime';
/** 需要工具注册表与 Typert：没有它们就没有目录、也没有 Remote 出口。 */
export const inject = ['tools', 'typert'];
/**
 * 装配 DOT 的 Host 面。
 * @param ctx - Host 侧 Cordis 上下文
 */
export function apply(ctx, config) {
    const directory = new CapabilityDirectory(ctx, ctx.tools);
    ctx.effect(() => () => directory.dispose(), 'dot-runtime: 能力目录释放');
    // Remote 出口与目录共用同一个实例：界面读到的就是模型工具读到的。
    // Service 的生命周期挂在 ctx 上，fiber 释放时自带回收，不需要再手动 destroy。
    const controller = new DotCapabilitiesController(ctx);
    controller.bind(directory);
    ctx.effect(() => registerCapabilityTool(ctx, directory), 'dot-runtime: 目录工具');
    // 文档读取：SPEC F04/F10 承诺的"真读懂 PDF/DOCX/XLSX"落在 Host 侧。
    // 读取边界来自配置，不跟随 process.cwd()——后者可能是工程根（含 .dsh 配置与会话）。
    const documentsRoot = config.documentsRoot ?? process.cwd();
    if (config.documentsRoot === undefined) {
        ctx.logger('dot-runtime').warn('documentsRoot 未配置，文档读取回退到启动目录 %s；该目录可能包含配置与会话，部署时应显式指定用户资料目录', process.cwd());
    }
    // 上传文件转文字 + 文件卡片下载（云端、本地都开）：
    // 旁注写在本实例 DSH_HOME 下，实例按账号分开，旁注与附件库天然按账号隔离。
    const dshHome = process.env.DSH_HOME;
    if (dshHome !== undefined && dshHome !== '') {
        ctx.effect(() => installFileTextHooks(join(dshHome, 'dot-file-text')), 'dot-runtime: 上传文件转文字');
    }
    const injectable = ctx;
    injectable.inject?.(['connection', 'attachments'], (sub) => {
        const scoped = sub;
        scoped.effect(() => scoped.connection.fetch.register({
            path: FILE_DOWNLOAD_PATH,
            methods: ['GET'],
            requestBody: 'buffered',
            fetch: request => handleFileDownload(request, scoped.attachments),
        }), 'dot-runtime: 文件下载与预览');
    });
    /* 云端先只开放已按账号接线的能力；共享资料目录的工具不能绕过数据网关。 */
    if (process.env.DOT_CLOUD_MODE === '1')
        return;
    ctx.effect(() => registerDocumentTool(ctx, documentsRoot), 'dot-runtime: 文档读取工具');
    // 成果写入与表格计算：关掉宿主终端后，"办事"不能只剩"读文档"。
    // 写入根固定为 documentsRoot/artifacts，不接受模型传任意路径。
    ctx.effect(() => registerArtifactTools(ctx, join(documentsRoot, 'artifacts')), 'dot-runtime: 成果与计算工具');
}
export { extractFileText, writeFileSidecar, readFileSidecarBlock, LIMITS as FILE_TEXT_LIMITS, extOf, zipBombReason, installFileTextHooks, FILE_EXTRACT_SYMBOL, FILE_TEXT_SYMBOL } from "./file-extract.js";
export { handleFileDownload, FILE_DOWNLOAD_PATH } from "./file-download.js";
