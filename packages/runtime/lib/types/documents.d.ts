/** 一次读取的结果。 */
export interface DocumentReadResult {
    /** 能否抽出文本；false 时 `text` 为空且 `reason` 说明原因。 */
    readonly ok: boolean;
    /** 文件类型（小写扩展名，去点）。 */
    readonly format: string;
    /** 抽到的正文；`ok` 为 false 时为空串。 */
    readonly text: string;
    /** 字符数，便于调用方判断是否需要分段。 */
    readonly chars: number;
    /** 读不出时的原因（面向用户，中文）。 */
    readonly reason?: string;
    /** PDF 没有文本层（扫描件）时为 true —— 这是"需要 OCR"的明确信号，不是普通失败。 */
    readonly scanned?: boolean;
    /** 结构提示：页数 / 工作表名 / 段落数等，供界面展示而不必解析正文。 */
    readonly outline?: readonly string[];
}
/** 默认大小上限：20MB。超过就不读——读一半再报错比直接说"太大"更糟。 */
export declare const MAX_BYTES: number;
/**
 * 读一份本地文档。
 * @param path - 绝对路径（调用方负责确保在 workspace 内；本函数不做权限判断）
 * @returns 读取结果；任何失败都以 `ok: false` 返回而不是抛异常——读文件失败是常见业务情况
 */
export declare function readDocument(path: string): Promise<DocumentReadResult>;
/**
 * 从**已读入的字节**解析文档。
 *
 * ▍为什么单独开一个入口
 * 原生上传的附件不在工作区文件系统里：它由 attachment 服务按内容寻址存到
 * `$DSH_HOME/attachments/v1/`，模型手上只有 `attachmentId` 与显示名。
 * 如果工具只会 `readFile(path)`，那么"用户上传了 PDF"和"模型能读到 PDF"之间
 * 就永远少一段——这正是把"上传成功"误当"已理解"的典型断点。
 * 所以解析逻辑只认字节，路径与附件两种来源共用同一套实现。
 * @param bytes - 文件字节
 * @param format - 小写扩展名（去点）
 * @returns 读取结果
 */
export declare function readDocumentBytes(bytes: Uint8Array, format: string): Promise<DocumentReadResult>;
