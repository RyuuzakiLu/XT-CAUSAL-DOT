/* ================================================================
   DOT 文档读取工具 · 总导游图

   ▍这是什么
   面向模型的一个只读工具 `dot_read_document`：给它一个**工作区内**的文件路径，
   它返回抽好的正文（PDF/DOCX/XLSX/纯文本），读不出时返回明确原因。

   ▍为什么不直接给 tool-fs 的 read
   `read` 只按行读文本文件；PDF/DOCX/XLSX 是压缩包或二进制，按文本读出来是乱码。
   SPEC 承诺的是"理解"，所以这里做真实解析，并让模型拿到可直接引用的正文。

   ▍路径边界
   只接受 workspace 根目录内的绝对路径。为什么在工具里也判一次（沙箱已经限制写入）：
   读取没有写入那样强的系统拦截，模型不该被允许把整台机器的文件读进对话。
   这是"个人助理读自己的资料"，不是"通用文件浏览器"。

   ▍修改铁律
   1. 【不】把解析失败包成"空文档"；如实返回 ok:false + reason。
   2. 【不】在这里做 OCR/联网；扫描件就报告需要 OCR。
   ================================================================ */
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { AttachmentId } from '@deepseek-ai/dsh-attachment';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { MAX_BYTES, readDocument, readDocumentBytes } from "./documents.js";
/** 工具名：dot_ 前缀避免与官方工具撞名。 */
export const READ_DOCUMENT_TOOL = 'dot_read_document';
/**
 * 判断一个路径是否落在允许的根目录内。
 * 为什么用 relative 而不是 startsWith：`/w/workspace-evil` 会误通过 `startsWith('/w/workspace')`。
 * @param root - 允许的根目录（绝对路径）
 * @param target - 待检查路径（绝对路径）
 * @returns 在根内为 true
 */
function insideRoot(root, target) {
    const rel = relative(resolve(root), resolve(target));
    return rel.length > 0 ? !rel.startsWith('..') && !isAbsolute(rel) : true;
}
/**
 * 注册文档读取工具。
 * @param ctx - Host 上下文
 * @param workspaceRoot - 允许读取的根目录（通常是配置里的工作区）
 * @returns 注册的清理函数
 */
export function registerDocumentTool(ctx, workspaceRoot) {
    return ctx.tools.register(defineTool({
        name: READ_DOCUMENT_TOOL,
        description: '读取工作区内一份文档的正文。支持纯文本/Markdown/JSON/CSV、PDF（需有文本层）、DOCX、XLSX。读不出时会说明原因（例如扫描件需要 OCR、旧版 .doc 不支持）。',
        parameters: {
            path: { type: 'string', description: '工作区内的绝对路径' },
            attachmentId: { type: 'string', description: '会话里上传附件的 attachmentId（形如 sha256:...，与 path 二选一）' },
            bytes: { type: 'number', description: '附件字节数，必须与上传回执一致（附件服务会用它做完整性校验）' },
            name: { type: 'string', description: '附件原始文件名，用于判断格式（传 attachmentId 时建议一起给）' },
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    ok: { type: 'boolean', required: true },
                    format: { type: 'string', required: true },
                    text: { type: 'string', required: true },
                    chars: { type: 'number', required: true },
                    reason: { type: 'string' },
                    scanned: { type: 'boolean' },
                },
                additionalProperties: false,
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: value.ok
                        ? `已读取 ${value.format}（${value.chars} 字）：\n\n${value.text}`
                        : `读取失败（${value.format}）：${value.reason ?? '未知原因'}`,
                }],
        },
        async execute(args) {
            // ② 附件来源：用户上传的文件不在工作区里，而是由 attachment 服务按内容寻址存到
            // `$DSH_HOME/attachments/v1/`。模型手上只有 attachmentId，所以必须走这里把它
            // 换成真实字节，否则"上传了 PDF"和"模型读到 PDF"之间永远缺一段。
            if (args.attachmentId !== undefined) {
                const attachments = ctx.get('attachments');
                if (attachments === undefined) {
                    return { ok: false, format: '', text: '', chars: 0, reason: '附件服务未挂载，无法读取上传的文件' };
                }
                // ⚠️ `bytes` 不是可选项：附件服务读完会对**字节数与 sha256 双双校验**，
                // 传错了（例如 0）会在末尾抛 ATTACHMENT_CORRUPT——文件明明读到了却被判损坏。
                // 所以这里要求调用方带上上传回执里的真实字节数。
                if (args.bytes === undefined) {
                    return { ok: false, format: '', text: '', chars: 0, reason: '读取上传附件需要同时提供 bytes（上传回执里的字节数），否则附件服务无法做完整性校验' };
                }
                const format = extname(args.name ?? '').replace('.', '').toLowerCase();
                const ref = { attachmentId: AttachmentId(args.attachmentId), name: args.name ?? 'file', bytes: args.bytes };
                const controller = new AbortController();
                try {
                    const chunks = [];
                    let total = 0;
                    // ⚠️ 边读边判上限：先收完再判，等于允许一次 500MB 的附件把内存打满后才说"太大"。
                    for await (const chunk of attachments.readFileStream(ref, controller.signal)) {
                        total += chunk.byteLength;
                        if (total > MAX_BYTES) {
                            controller.abort();
                            return { ok: false, format, text: '', chars: 0, reason: `附件超过 ${MAX_BYTES / 1024 / 1024}MB 读取上限，已停止读取` };
                        }
                        chunks.push(chunk);
                    }
                    const joined = new Uint8Array(total);
                    let offset = 0;
                    for (const chunk of chunks) {
                        joined.set(chunk, offset);
                        offset += chunk.byteLength;
                    }
                    const result = await readDocumentBytes(joined, format);
                    return {
                        ok: result.ok,
                        format: result.format,
                        text: result.text,
                        chars: result.chars,
                        ...(result.reason === undefined ? {} : { reason: result.reason }),
                        ...(result.scanned === undefined ? {} : { scanned: result.scanned }),
                    };
                }
                catch (error) {
                    return { ok: false, format, text: '', chars: 0, reason: `读取附件失败：${error instanceof Error ? error.message : String(error)}` };
                }
            }
            if (args.path === undefined) {
                return { ok: false, format: '', text: '', chars: 0, reason: '请给 path（工作区文件）或 attachmentId（会话上传附件）' };
            }
            if (!isAbsolute(args.path)) {
                return { ok: false, format: '', text: '', chars: 0, reason: 'path 必须是绝对路径' };
            }
            if (!insideRoot(workspaceRoot, args.path)) {
                return { ok: false, format: '', text: '', chars: 0, reason: `只允许读取工作区内的文件：${workspaceRoot}` };
            }
            const result = await readDocument(args.path);
            return {
                ok: result.ok,
                format: result.format,
                text: result.text,
                chars: result.chars,
                ...(result.reason === undefined ? {} : { reason: result.reason }),
                ...(result.scanned === undefined ? {} : { scanned: result.scanned }),
            };
        },
    }));
}
