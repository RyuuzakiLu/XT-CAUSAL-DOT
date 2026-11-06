/** 单个成果文件的大小上限（字符）：5MB 纯文本足够长报告，再大应改成分片。 */
export declare const MAX_ARTIFACT_CHARS: number;
/** 一次写入的结果。 */
export interface ArtifactWriteResult {
    readonly ok: boolean;
    /** 落盘绝对路径；失败时为空。 */
    readonly path: string;
    readonly bytes: number;
    readonly reason?: string;
}
/**
 * 把成果写进成果目录。
 * @param root - 成果根目录（绝对路径，来自部署配置）
 * @param name - 文件名（可含子目录，但不得逃出根）
 * @param text - 正文
 * @returns 写入结果
 */
export declare function writeArtifact(root: string, name: string, text: string): Promise<ArtifactWriteResult>;
/** 表格一列的聚合结果。 */
export interface ColumnStats {
    readonly column: string;
    /** 参与计算的数值个数（非数值单元格被跳过并计数）。 */
    readonly numbers: number;
    readonly skipped: number;
    readonly sum?: number;
    readonly mean?: number;
    readonly min?: number;
    readonly max?: number;
}
/** 一次表格计算的结果。 */
export interface TableComputeResult {
    readonly ok: boolean;
    /** 表头；没有表头行时为第一行的占位名。 */
    readonly header: readonly string[];
    readonly rows: number;
    readonly columns: readonly ColumnStats[];
    /** 按某列分组后的计数（请求了 groupBy 才有）。 */
    readonly groups?: readonly {
        readonly key: string;
        readonly count: number;
    }[];
    readonly reason?: string;
}
/**
 * 读一份表格并做聚合。
 * @param text - CSV/TSV 文本（调用方负责取内容；路径来源不同但算法同一份）
 * @param options.delimiter - 分隔符，默认按首行猜（有制表符用制表符）
 * @param options.hasHeader - 首行是否表头，默认 true
 * @param options.groupBy - 按该列名分组计数
 * @returns 计算结果
 */
export declare function computeTable(text: string, options?: {
    readonly delimiter?: string;
    readonly hasHeader?: boolean;
    readonly groupBy?: string;
}): TableComputeResult;
/**
 * 读文件并计算表格（便利入口，用于工具）。
 * @param path - 文件绝对路径
 * @param options - 同 {@link computeTable}
 * @returns 计算结果
 */
export declare function computeTableFile(path: string, options?: {
    readonly delimiter?: string;
    readonly hasHeader?: boolean;
    readonly groupBy?: string;
}): Promise<TableComputeResult>;
