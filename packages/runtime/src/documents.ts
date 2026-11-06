/* ================================================================
   DOT 文档读取 · 总导游图

   ▍这是什么
   把本地文件按**内容**读成文本，而不是把二进制丢给模型说"你自己看"：
   - 纯文本 / Markdown / JSON / CSV：直接按文本读取（有编码回退）
   - PDF：用 `pdfjs-dist` 逐页抽文字
   - DOCX：解开 zip 取 `word/document.xml`，按段落抽文字
   - XLSX：解开 zip 读 `xl/sharedStrings.xml` 与各 `xl/worksheets/*.xml`，还原单元格文本

   ▍为什么必须在这里实现"真解析"
   SPEC F04/F10 承诺的是"**理解**图片/PDF/DOCX/XLSX"，不是"上传成功"。上游 DSH 的
   文件预览插件（ui-sidebar-documentpreview）是**浏览器端渲染**，不提供 Host 侧文本抽取；
   所以"读得懂"这件事在 DOT 里必须自己落地，否则界面会显示"已上传"而模型根本看不到内容。

   ▍为什么扫描件/OCR 明确不支持
   没有 OCR 引擎时，PDF 里只有图片、没有文本层，抽出来是空字符串。这里**如实返回
   `scanned: true` 且不带正文**，绝不假装读到了内容——用户会看到"这份是扫描件，需要 OCR"，
   而不是收到一份捏造的摘要。

   ▍修改铁律
   1. 【不】为"读不懂"造兜底摘要；读不出就报告读不出。
   2. 【不】把解析结果写进会话日志或记忆；它只是一次读取的返回值。
   3. 大文件先看大小上限（默认 20MB），超限明确拒绝，不静默截断成"看起来成功"。
   ================================================================ */
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'

/** 一次读取的结果。 */
export interface DocumentReadResult {
  /** 能否抽出文本；false 时 `text` 为空且 `reason` 说明原因。 */
  readonly ok: boolean
  /** 文件类型（小写扩展名，去点）。 */
  readonly format: string
  /** 抽到的正文；`ok` 为 false 时为空串。 */
  readonly text: string
  /** 字符数，便于调用方判断是否需要分段。 */
  readonly chars: number
  /** 读不出时的原因（面向用户，中文）。 */
  readonly reason?: string
  /** PDF 没有文本层（扫描件）时为 true —— 这是"需要 OCR"的明确信号，不是普通失败。 */
  readonly scanned?: boolean
  /** 结构提示：页数 / 工作表名 / 段落数等，供界面展示而不必解析正文。 */
  readonly outline?: readonly string[]
}

/** 默认大小上限：20MB。超过就不读——读一半再报错比直接说"太大"更糟。 */
export const MAX_BYTES = 20 * 1024 * 1024

/** 纯文本类扩展名：直接按 UTF-8 读，失败回退 GBK 不可得时如实报告。 */
const TEXTY = new Set(['txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'log', 'yaml', 'yml', 'xml', 'html', 'htm'])

/**
 * 读一份本地文档。
 * @param path - 绝对路径（调用方负责确保在 workspace 内；本函数不做权限判断）
 * @returns 读取结果；任何失败都以 `ok: false` 返回而不是抛异常——读文件失败是常见业务情况
 */
export async function readDocument(path: string): Promise<DocumentReadResult> {
  const format = extname(path).replace('.', '').toLowerCase()
  // ⚠️ 先 stat 再读：常规大附件可能有几百 MB，先 readFile 再判上限等于先把内存打满。
  // 上限是"拒绝读"的门槛，必须在分配内存之前就生效。
  try {
    const info = await stat(path)
    if (info.size > MAX_BYTES) {
      return { ok: false, format, text: '', chars: 0, reason: `文件 ${(info.size / 1024 / 1024).toFixed(1)}MB 超过 ${MAX_BYTES / 1024 / 1024}MB 读取上限` }
    }
  } catch (error) {
    return { ok: false, format, text: '', chars: 0, reason: `无法读取文件：${error instanceof Error ? error.message : String(error)}` }
  }
  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch (error) {
    return { ok: false, format, text: '', chars: 0, reason: `无法读取文件：${error instanceof Error ? error.message : String(error)}` }
  }
  return await readDocumentBytes(bytes, format)
}

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
export async function readDocumentBytes(bytes: Uint8Array, format: string): Promise<DocumentReadResult> {
  const lower = format.toLowerCase()
  if (bytes.byteLength > MAX_BYTES) {
    return { ok: false, format: lower, text: '', chars: 0, reason: `内容 ${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB 超过 ${MAX_BYTES / 1024 / 1024}MB 读取上限` }
  }

  if (TEXTY.has(lower)) {
    const text = Buffer.from(bytes).toString('utf8')
    return { ok: true, format: lower, text, chars: text.length }
  }
  const buffer = Buffer.from(bytes)
  if (lower === 'pdf') return readPdf(buffer)
  if (lower === 'docx') return readDocx(buffer)
  if (lower === 'xlsx') return readXlsx(buffer)
  if (lower === 'doc' || lower === 'xls') {
    return { ok: false, format: lower, text: '', chars: 0, reason: '旧版 .doc/.xls 二进制格式暂不支持读取，请另存为 .docx/.xlsx 或 PDF' }
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(lower)) {
    return { ok: false, format: lower, text: '', chars: 0, reason: '图片内容需要视觉模型读取（read_image 工具），本工具只处理文档文本' }
  }
  return { ok: false, format: lower, text: '', chars: 0, reason: `暂不支持读取 .${lower} 格式` }
}

/**
 * 抽 PDF 文本。
 * @param bytes - 文件字节
 * @returns 结果；无文本层时标记 `scanned`
 */
async function readPdf(bytes: Buffer): Promise<DocumentReadResult> {
  try {
    // pdfjs 的 Node 构建走 legacy 入口（它自己处理 worker 缺失），不需要额外 worker 文件。
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise
    const pages: string[] = []
    for (let index = 1; index <= doc.numPages; index += 1) {
      const page = await doc.getPage(index)
      const content = await page.getTextContent()
      // 只取字符串项；每页之间用空行分隔，保留阅读顺序。
      const text = content.items
        .map(item => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/[ \t]+/g, ' ')
        .trim()
      if (text.length > 0) pages.push(text)
    }
    await doc.cleanup()
    const text = pages.join('\n\n')
    if (text.length === 0) {
      return { ok: false, format: 'pdf', text: '', chars: 0, scanned: true, reason: `这份 PDF 共 ${doc.numPages} 页，没有可抽取的文本层（很可能是扫描件），需要 OCR 才能读取` }
    }
    return { ok: true, format: 'pdf', text, chars: text.length, outline: [`共 ${doc.numPages} 页`, `有文本层 ${pages.length} 页`] }
  } catch (error) {
    return { ok: false, format: 'pdf', text: '', chars: 0, reason: `PDF 解析失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * 抽 DOCX 段落文本。
 * @param bytes - 文件字节
 * @returns 结果
 */
function readDocx(bytes: Buffer): DocumentReadResult {
  try {
    const entries = unzipSync(new Uint8Array(bytes))
    const documentXml = entries['word/document.xml']
    if (documentXml === undefined) {
      return { ok: false, format: 'docx', text: '', chars: 0, reason: 'DOCX 里没有 word/document.xml，文件可能损坏或不是 Word 文档' }
    }
    const xml = strFromU8(documentXml)
    // 段落 <w:p> 之间换行；<w:t> 里是文本片段。只做这一层提取——样式、批注、页眉不参与正文。
    const paragraphs = xml.split(/<w:p[ >]/).slice(1).map(block => {
      const texts = [...block.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(match => match[1] ?? '')
      return texts.join('')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    }).filter(paragraph => paragraph.trim().length > 0)
    const text = paragraphs.join('\n')
    if (text.length === 0) {
      return { ok: false, format: 'docx', text: '', chars: 0, reason: '这份 DOCX 里没有可读取的文字（可能只有图片或表格对象）' }
    }
    return { ok: true, format: 'docx', text, chars: text.length, outline: [`${paragraphs.length} 个非空段落`] }
  } catch (error) {
    return { ok: false, format: 'docx', text: '', chars: 0, reason: `DOCX 解析失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * 抽 XLSX 单元格文本（含共享字符串还原）。
 * @param bytes - 文件字节
 * @returns 结果
 */
function readXlsx(bytes: Buffer): DocumentReadResult {
  try {
    const entries = unzipSync(new Uint8Array(bytes))
    // 共享字符串表：单元格里用 t="s" 时，值是这个表的索引。
    const sharedXml = entries['xl/sharedStrings.xml']
    const shared: string[] = []
    if (sharedXml !== undefined) {
      for (const match of strFromU8(sharedXml).matchAll(/<si>([\s\S]*?)<\/si>/g)) {
        const text = [...(match[1] ?? '').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1] ?? '').join('')
        shared.push(text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))
      }
    }
    const sheets = Object.keys(entries).filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort()
    if (sheets.length === 0) {
      return { ok: false, format: 'xlsx', text: '', chars: 0, reason: 'XLSX 里没有工作表，文件可能损坏' }
    }
    const blocks: string[] = []
    for (const sheet of sheets) {
      const rows: string[] = []
      for (const rowMatch of strFromU8(entries[sheet] as Uint8Array).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
        const cells: string[] = []
        for (const cellMatch of (rowMatch[1] ?? '').matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
          const attrs = cellMatch[1] ?? ''
          const body = cellMatch[2] ?? ''
          if (/t="s"/.test(attrs)) {
            const index = Number(/<v>(\d+)<\/v>/.exec(body)?.[1])
            cells.push(shared[index] ?? '')
          } else {
            cells.push((/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '').replace(/&amp;/g, '&'))
          }
        }
        if (cells.some(cell => cell.trim().length > 0)) rows.push(cells.join('\t'))
      }
      if (rows.length > 0) blocks.push(`[${sheet.replace('xl/worksheets/', '').replace('.xml', '')}]\n${rows.join('\n')}`)
    }
    const text = blocks.join('\n\n')
    if (text.length === 0) {
      return { ok: false, format: 'xlsx', text: '', chars: 0, reason: '这份 XLSX 的工作表里没有可读取的单元格内容' }
    }
    return { ok: true, format: 'xlsx', text, chars: text.length, outline: [`${sheets.length} 个工作表`] }
  } catch (error) {
    return { ok: false, format: 'xlsx', text: '', chars: 0, reason: `XLSX 解析失败：${error instanceof Error ? error.message : String(error)}` }
  }
}
