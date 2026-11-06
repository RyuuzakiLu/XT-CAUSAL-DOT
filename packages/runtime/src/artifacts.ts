/* ================================================================
   DOT 成果写入与表格计算 · 总导游图

   ▍这是什么
   关掉宿主终端之后（ASTRA preset 里 tool-bash/tool-pwsh 默认 disabled），
   "办事"能力不能只剩"读文档"。这里补上两件真正能产出东西的事：
   1. `writeArtifact` —— 把文本/表格写成文件，**只落在成果目录内**；
   2. `computeTable` —— 读 CSV/TSV 做求和/均值/极值/计数/分组聚合，纯计算不出进程。

   ▍为什么不用 shell 兜底
   "模型随手 shell 一下" 等于把整台机器交出去：没有审批面、没有路径边界、
   命令内容也不进会话日志。成果生成是**有明确输入输出**的操作，值得用两个
   边界清楚的工具表达，而不是借一个通用执行器。

   ▍边界怎么定
   - 写入根目录由配置给（`documentsRoot/artifacts`），不接受调用方传任意路径；
   - 路径穿越（`..`、绝对路径、盘符）一律拒绝，不用 `startsWith` 判前缀（会被
     `/w/artifacts-evil` 骗过）；
   - 单文件大小上限，超过直接拒绝，不静默截断；
   - 同名文件追加序号而不是覆盖——覆盖用户已有成果是不可逆的破坏。

   ▍修改铁律
   1. 【不】把写入根做成可配置参数：配置来自部署，不能来自模型。
   2. 【不】为"算不出来"编结果；列不存在、非数值就如实报错。
   3. 【不】在这里开子进程或调外部服务。
   ================================================================ */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

/** 单个成果文件的大小上限（字符）：5MB 纯文本足够长报告，再大应改成分片。 */
export const MAX_ARTIFACT_CHARS = 5 * 1024 * 1024

/** 一次写入的结果。 */
export interface ArtifactWriteResult {
  readonly ok: boolean
  /** 落盘绝对路径；失败时为空。 */
  readonly path: string
  readonly bytes: number
  readonly reason?: string
}

/**
 * 判断相对路径是否安全（不逃出根目录）。
 * 为什么用 `relative` 而不是字符串前缀：`/root/artifacts-evil` 会骗过
 * `startsWith('/root/artifacts')`；`relative` 会返回 `../artifacts-evil`。
 * @param root - 根目录绝对路径
 * @param target - 待检查的绝对路径
 * @returns 在根内为 true
 */
function insideRoot(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target))
  return rel.length > 0 ? !rel.startsWith('..') && !isAbsolute(rel) : true
}

/**
 * 把成果写进成果目录。
 * @param root - 成果根目录（绝对路径，来自部署配置）
 * @param name - 文件名（可含子目录，但不得逃出根）
 * @param text - 正文
 * @returns 写入结果
 */
export async function writeArtifact(root: string, name: string, text: string): Promise<ArtifactWriteResult> {
  if (name.trim() === '') return { ok: false, path: '', bytes: 0, reason: '文件名不能为空' }
  // ⚠️ 显式拒绝绝对路径与盘符：`join` 在 Windows 上会把 `/etc/passwd` 悄悄改写成
  // `<root>\etc\passwd`——它没逃出根目录，但"传绝对路径→落到别处"这种静默改义
  // 会让调用方以为自己在写系统文件。语义上就要求传相对路径，不猜。
  if (isAbsolute(name) || (name.length > 1 && name[1] === ':' && /[A-Za-z]/.test(name[0] ?? ''))) {
    return { ok: false, path: '', bytes: 0, reason: '文件名必须是成果目录内的相对路径（不接受绝对路径或盘符）' }
  }
  if (text.length > MAX_ARTIFACT_CHARS) {
    return { ok: false, path: '', bytes: 0, reason: `正文 ${(text.length / 1024 / 1024).toFixed(1)}M 字符超过 ${MAX_ARTIFACT_CHARS / 1024 / 1024}M 上限` }
  }
  const base = resolve(root)
  let target = resolve(join(base, name))
  if (!insideRoot(base, target) || target === base) {
    return { ok: false, path: '', bytes: 0, reason: `文件名必须是成果目录内的相对路径：${base}` }
  }
  // 同名不覆盖：用户已有的成果是既有事实，不能被一次新写入悄悄替换。
  // 追加 `-2`、`-3`… 直到空位；不动原文件。
  if (existsSync(target)) {
    const dot = target.lastIndexOf('.')
    const stem = dot > 0 ? target.slice(0, dot) : target
    const ext = dot > 0 ? target.slice(dot) : ''
    let index = 2
    while (existsSync(`${stem}-${index}${ext}`)) index += 1
    target = `${stem}-${index}${ext}`
  }
  try {
    await mkdir(resolve(target, '..'), { recursive: true })
    await writeFile(target, text, 'utf8')
    return { ok: true, path: target, bytes: Buffer.byteLength(text, 'utf8') }
  } catch (error) {
    return { ok: false, path: '', bytes: 0, reason: `写入失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

/** 表格一列的聚合结果。 */
export interface ColumnStats {
  readonly column: string
  /** 参与计算的数值个数（非数值单元格被跳过并计数）。 */
  readonly numbers: number
  readonly skipped: number
  readonly sum?: number
  readonly mean?: number
  readonly min?: number
  readonly max?: number
}

/** 一次表格计算的结果。 */
export interface TableComputeResult {
  readonly ok: boolean
  /** 表头；没有表头行时为第一行的占位名。 */
  readonly header: readonly string[]
  readonly rows: number
  readonly columns: readonly ColumnStats[]
  /** 按某列分组后的计数（请求了 groupBy 才有）。 */
  readonly groups?: readonly { readonly key: string; readonly count: number }[]
  readonly reason?: string
}

/**
 * 把 CSV/TSV 文本切成行与单元格。
 * 为什么手写而不是拉 CSV 库：本工具只处理**本地生成的规整表格**，需要支持的最小集是
 * 引号包裹与逗号转义；引入依赖反而会在"引号里有换行"这类边缘上与库的行为不一致。
 * @param text - 表格文本
 * @param delimiter - 分隔符
 * @returns 行数组（每行是单元格数组）
 */
function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { cell += '"'; index += 1 }
        else quoted = false
      } else cell += char
      continue
    }
    if (char === '"') { quoted = true; continue }
    if (char === delimiter) { row.push(cell); cell = ''; continue }
    if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue }
    if (char === '\r') continue
    cell += char
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row) }
  return rows.filter(cells => cells.some(value => value.trim() !== ''))
}

/**
 * 读一份表格并做聚合。
 * @param text - CSV/TSV 文本（调用方负责取内容；路径来源不同但算法同一份）
 * @param options.delimiter - 分隔符，默认按首行猜（有制表符用制表符）
 * @param options.hasHeader - 首行是否表头，默认 true
 * @param options.groupBy - 按该列名分组计数
 * @returns 计算结果
 */
export function computeTable(
  text: string,
  options: { readonly delimiter?: string; readonly hasHeader?: boolean; readonly groupBy?: string } = {},
): TableComputeResult {
  const guessed = options.delimiter ?? (text.includes('\t') ? '\t' : ',')
  const rows = parseDelimited(text, guessed)
  if (rows.length === 0) return { ok: false, header: [], rows: 0, columns: [], reason: '表格是空的' }
  const hasHeader = options.hasHeader ?? true
  const header = hasHeader
    ? (rows[0] as string[]).map(value => value.trim())
    : (rows[0] as string[]).map((_, index) => `列${index + 1}`)
  const body = hasHeader ? rows.slice(1) : rows
  if (header.length === 0) return { ok: false, header: [], rows: 0, columns: [], reason: '没有可识别的列' }

  const columns: ColumnStats[] = header.map((column, columnIndex) => {
    let numbers = 0
    let skipped = 0
    let sum = 0
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (const row of body) {
      const raw = (row[columnIndex] ?? '').trim()
      if (raw === '') { skipped += 1; continue }
      const value = Number(raw.replace(/,/g, ''))
      if (!Number.isFinite(value)) { skipped += 1; continue }
      numbers += 1
      sum += value
      if (value < min) min = value
      if (value > max) max = value
    }
    if (numbers === 0) return { column, numbers, skipped }
    return { column, numbers, skipped, sum, mean: sum / numbers, min, max }
  })

  let groups: TableComputeResult['groups']
  if (options.groupBy !== undefined) {
    const index = header.indexOf(options.groupBy)
    if (index < 0) {
      return { ok: false, header, rows: body.length, columns, reason: `没有这一列：${options.groupBy}（可选：${header.join('、')}）` }
    }
    const counts = new Map<string, number>()
    for (const row of body) {
      const key = (row[index] ?? '').trim()
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    groups = [...counts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key))
  }

  return { ok: true, header, rows: body.length, columns, ...(groups === undefined ? {} : { groups }) }
}

/**
 * 读文件并计算表格（便利入口，用于工具）。
 * @param path - 文件绝对路径
 * @param options - 同 {@link computeTable}
 * @returns 计算结果
 */
export async function computeTableFile(
  path: string,
  options: { readonly delimiter?: string; readonly hasHeader?: boolean; readonly groupBy?: string } = {},
): Promise<TableComputeResult> {
  try {
    return computeTable(await readFile(path, 'utf8'), options)
  } catch (error) {
    return { ok: false, header: [], rows: 0, columns: [], reason: `读取失败：${error instanceof Error ? error.message : String(error)}` }
  }
}
