/** 各种上限：都是"超了就降级成只给列表/只给开头"，不是报错。 */
export declare const LIMITS: Readonly<{
    /** 交给模型的单个文件文字上限（字符）。超了截断并注明。 */
    textChars: 40000;
    /** 压缩包条目数上限。 */
    archiveEntries: 2000;
    /** 压缩包合计解压大小上限（字节）。 */
    archiveTotalBytes: number;
    /** 压缩包单条解压大小上限（字节）。 */
    archiveEntryBytes: number;
    /** 压缩比上限：单条解压/压缩超过这个倍数视为炸弹。 */
    archiveRatio: 120;
    /** 压缩包里最多读几份文件的内容（其余只列名字）。 */
    archiveReadFiles: 40;
    /** 文件列表最多列几行。 */
    listLines: 300;
    /** 原文件超过这个大小就不解析，只说明大小（上传上限另在路由层）。 */
    sourceBytes: number;
}>;
/** 文件结果：给旁注与模型用。 */
export interface FileTextResult {
    readonly ok: boolean;
    /** 人读的类型名，如 "PDF"、"ZIP 压缩包"、"文本"。 */
    readonly kind: string;
    /** 正文（可能已截断）；ok:false 时为空。 */
    readonly text: string;
    /** 说明：截断、跳过、读不了的原因。 */
    readonly notes: readonly string[];
}
/** 取小写扩展名；Makefile/Dockerfile 这类无扩展名的按全名。 */
export declare function extOf(name: string): string;
/** 嗅探：前 8KB 无 NUL、能按 UTF-8 严格解码，就当文本。 */
export declare function looksLikeText(bytes: Uint8Array): boolean;
/** XML/HTML → 纯文字（够模型读，不追求排版）。 */
export declare function xmlToText(xml: string): string;
/** 压缩包条目（只读中央目录得到的声明值）。 */
interface ZipEntry {
    readonly name: string;
    readonly size: number;
    readonly originalSize: number;
}
/** 只读中央目录列条目，不解压。坏包抛错由调用方接住。 */
export declare function listZip(bytes: Uint8Array): ZipEntry[];
/** 炸弹检查：返回不通过的原因；通过返回 undefined。 */
export declare function zipBombReason(entries: readonly ZipEntry[]): string | undefined;
/** tar：512 字节块，ustar 头。 */
export declare function listTar(bytes: Uint8Array): {
    name: string;
    size: number;
    offset: number;
}[];
/** 选项：nested 表示压缩包里的文件（不再展开套娃）。 */
export interface ExtractOptions {
    readonly nested?: boolean;
}
/**
 * 把一份文件转成给模型读的文字。
 * @param bytes - 文件字节
 * @param name - 原文件名（用扩展名判断类型）
 * @returns 结果；从不抛异常
 */
export declare function extractFileText(bytes: Uint8Array, name: string, options?: ExtractOptions): Promise<FileTextResult>;
/** 文件引用的最小形状（DSH FileRef）。 */
interface FileRefLike {
    readonly attachmentId: unknown;
    readonly name?: unknown;
    readonly bytes?: unknown;
}
/** 附件服务里本模块用到的两个方法。 */
interface AttachmentsLike {
    fileHostPath?: (ref: FileRefLike) => string | undefined;
}
/**
 * 上传落盘后调用：抽文字、写旁注。从不抛异常。
 * @returns 写好的旁注路径；没写返回 undefined
 */
export declare function writeFileSidecar(dir: string, file: FileRefLike, attachments: AttachmentsLike | undefined): Promise<string | undefined>;
/**
 * 模型请求组装时同步调用：有旁注就返回接在文件说明后面的文字块。
 * @returns 文字块；没有旁注返回 undefined（模型照旧只看到路径说明）
 */
export declare function readFileSidecarBlock(dir: string, ref: FileRefLike): string | undefined;
/** 全局钩子符号（补丁里用同名 Symbol.for）。 */
export declare const FILE_EXTRACT_SYMBOL: unique symbol;
export declare const FILE_TEXT_SYMBOL: unique symbol;
/**
 * 装钩子：上传补丁调 fileExtract，dsh-llm 补丁调 fileText。
 * @param dir - 旁注目录（本实例 DSH_HOME/dot-file-text）
 * @returns 卸载函数
 */
export declare function installFileTextHooks(dir: string): () => void;
export {};
