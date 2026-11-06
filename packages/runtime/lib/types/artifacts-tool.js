/* ================================================================
   DOT 成果工具 · 总导游图

   ▍这是什么
   两个面向模型的工具，补上"关掉宿主终端后还能真办事"：
   - `dot_write_artifact`：把成果写成文件（只落在成果目录）；
   - `dot_compute_table`：读 CSV/TSV 做聚合（求和/均值/极值/计数/分组）。

   ▍为什么不是"让模型调 bash"
   宿主终端在 ASTRA preset 里默认关着（SPEC F10）。即便打开，它也没有路径边界、
   不进审批面、命令正文也不进会话日志。成果生成与表格计算是**输入输出明确**的操作，
   用两个窄工具表达，比放开一个通用执行器安全得多、也更容易解释"它刚才做了什么"。

   ▍修改铁律
   1. 【不】让模型传"写到哪"的绝对路径；写入根来自部署配置。
   2. 【不】对算不出的列编造结果；列不存在就报可选列名。
   ================================================================ */
import { basename, join } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { MAX_ARTIFACT_CHARS, computeTableFile, writeArtifact } from "./artifacts.js";
/** 工具名常量：供测试与能力页引用，避免各处拼字符串。 */
export const WRITE_ARTIFACT_TOOL = 'dot_write_artifact';
export const COMPUTE_TABLE_TOOL = 'dot_compute_table';
/**
 * 注册成果工具。
 * @param ctx - Host 上下文
 * @param artifactsRoot - 成果根目录（绝对路径，来自部署配置）
 * @returns 注册的清理函数
 */
export function registerArtifactTools(ctx, artifactsRoot) {
    const disposeWrite = ctx.tools.register(defineTool({
        name: WRITE_ARTIFACT_TOOL,
        description: `把成果写成文件（只写入本机成果目录，不覆盖已有文件）。适合长报告、清单、表格导出的文本。单文件上限 ${MAX_ARTIFACT_CHARS / 1024 / 1024}M 字符。`,
        parameters: {
            name: { type: 'string', required: true, description: '文件名（相对成果目录，可含子目录，例如 report.md）' },
            text: { type: 'string', required: true, description: '文件正文' },
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    ok: { type: 'boolean', required: true },
                    path: { type: 'string', required: true },
                    bytes: { type: 'number', required: true },
                    reason: { type: 'string' },
                },
                additionalProperties: false,
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: value.ok ? `已写入 ${value.path}（${value.bytes} 字节）` : `写入失败：${value.reason ?? '未知原因'}`,
                }],
            /**
             * 可回放的成果元数据。
             *
             * ▍为什么必须有
             * 工作插件原本只在模型**主动调用 `present`** 时才登记成果；模型忘了 present，
             * 文件就写在了盘上却没人知道它属于哪件工作——"办完了但成果丢了"。
             * 这份 meta 落在 `tool/result` 上，工作插件可以直接读它做文件候选，不依赖模型自觉。
             *
             * ▍为什么是稳定 JSON 而不是自然语言
             * 消费方要按字段判断（`dot`/`kind`），不能解析中文句子。字段名一旦改动，
             * 工作插件那边的登记逻辑就会静默失效，所以这里只增不改。
             * ▍只在成功时给
             * 失败没有路径可登记；给一个空路径只会让上层多一条脏候选。
             * @param _args - 调用参数（未使用）
             * @param value - 工具返回的规范值
             * @returns 成果事件形状的 JSON
             */
            presentationMeta: (_args, value) => value.ok
                ? {
                    dot: 'artifact',
                    kind: 'file-created',
                    path: value.path,
                    title: basename(value.path),
                    bytes: value.bytes,
                    mimeType: value.path.endsWith('.md') ? 'text/markdown'
                        : value.path.endsWith('.csv') ? 'text/csv'
                            : value.path.endsWith('.json') ? 'application/json'
                                : 'text/plain',
                }
                : { dot: 'artifact', kind: 'failed' },
        },
        async execute(args) {
            const result = await writeArtifact(artifactsRoot, args.name, args.text);
            return {
                ok: result.ok,
                path: result.path,
                bytes: result.bytes,
                ...(result.reason === undefined ? {} : { reason: result.reason }),
            };
        },
    }));
    const disposeCompute = ctx.tools.register(defineTool({
        name: COMPUTE_TABLE_TOOL,
        description: '读取成果目录内的一份 CSV/TSV，按列统计（数值列给求和/均值/最小值/最大值/计数），可按某列分组计数。只做计算，不改文件。',
        parameters: {
            name: { type: 'string', required: true, description: '成果目录内的文件名（例如 sales.csv）' },
            groupBy: { type: 'string', description: '按这一列的取值分组计数（用表头名）' },
            delimiter: { type: 'string', description: '分隔符，默认按内容猜（有制表符用制表符，否则逗号）' },
            hasHeader: { type: 'boolean', description: '首行是否为表头，默认 true' },
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    ok: { type: 'boolean', required: true },
                    header: { type: 'array', items: { type: 'string' }, required: true },
                    rows: { type: 'number', required: true },
                    columns: {
                        type: 'array',
                        required: true,
                        items: {
                            type: 'object',
                            properties: {
                                column: { type: 'string', required: true },
                                numbers: { type: 'number', required: true },
                                skipped: { type: 'number', required: true },
                                sum: { type: 'number' },
                                mean: { type: 'number' },
                                min: { type: 'number' },
                                max: { type: 'number' },
                            },
                            additionalProperties: false,
                        },
                    },
                    groups: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                key: { type: 'string', required: true },
                                count: { type: 'number', required: true },
                            },
                            additionalProperties: false,
                        },
                    },
                    reason: { type: 'string' },
                },
                additionalProperties: false,
            },
            render: (_args, value) => {
                if (!value.ok)
                    return [{ type: 'text', text: `计算失败：${value.reason ?? '未知原因'}` }];
                const lines = [`共 ${value.rows} 行，${value.header.length} 列（${value.header.join(' / ')}）`];
                for (const column of value.columns) {
                    lines.push(column.numbers === 0
                        ? `- ${column.column}：无可用数值（跳过 ${column.skipped} 个非数值）`
                        : `- ${column.column}：${column.numbers} 个数值，合计 ${column.sum}，均值 ${column.mean?.toFixed(2)}，范围 ${column.min}~${column.max}（跳过 ${column.skipped}）`);
                }
                if (value.groups !== undefined) {
                    lines.push('分组计数：');
                    for (const group of value.groups)
                        lines.push(`  ${group.key || '(空)'}: ${group.count}`);
                }
                return [{ type: 'text', text: lines.join('\n') }];
            },
        },
        async execute(args) {
            const result = await computeTableFile(join(artifactsRoot, args.name), {
                ...(args.groupBy === undefined ? {} : { groupBy: args.groupBy }),
                ...(args.delimiter === undefined ? {} : { delimiter: args.delimiter }),
                ...(args.hasHeader === undefined ? {} : { hasHeader: args.hasHeader }),
            });
            return {
                ok: result.ok,
                header: [...result.header],
                rows: result.rows,
                columns: result.columns.map(column => ({
                    column: column.column,
                    numbers: column.numbers,
                    skipped: column.skipped,
                    ...(column.sum === undefined ? {} : { sum: column.sum }),
                    ...(column.mean === undefined ? {} : { mean: column.mean }),
                    ...(column.min === undefined ? {} : { min: column.min }),
                    ...(column.max === undefined ? {} : { max: column.max }),
                })),
                ...(result.groups === undefined ? {} : { groups: result.groups.map(group => ({ key: group.key, count: group.count })) }),
                ...(result.reason === undefined ? {} : { reason: result.reason }),
            };
        },
    }));
    return () => { disposeWrite(); disposeCompute(); };
}
