/* ================================================================
   上传文件 → 文字（给模型看的那一份）

   ▍这是什么
   用户在对话里传了一个普通文件（不是图片）。DSH 原生只把"只读路径"交给模型，
   模型得自己去读；云端模型没有读文件的工具，等于没看见。这里在上传落盘后
   立刻把文件转成文字（或文件列表），存一份旁注（sidecar），模型请求组装时
   由 dsh-llm 的 fileHandleText 补丁同步读旁注、接在文件说明后面。

   ▍支持什么
   - 文本与代码：按扩展名白名单；未知扩展名先嗅探（无 NUL、能按 UTF-8 解）
   - PDF（有文本层）、DOCX、XLSX：复用 documents.ts 的解析
   - PPTX、ODT/ODS/ODP、EPUB、RTF：本文件里的轻量解析
   - ZIP：文件列表 + 能读的文件内容；.tar / .tar.gz / .tgz / .gz 同理
   不支持的（如实写进旁注，模型会照实告诉用户）：旧版 .doc/.xls/.ppt、
   扫描版 PDF（没有文本层）、RAR/7z、音视频与其他二进制。

   ▍防解压炸弹
   先只读中央目录（不解压）核：条目数、单条与合计解压大小、压缩比；
   超限就只给列表、不解；解出来的实际字节再核一次（声明的大小可以造假）。
   套娃压缩包只列名字，不往下解。

   ▍修改铁律
   1. 【不】抛异常给调用方：任何失败都返回 ok:false + 原因，上传本身不能因此失败。
   2. 【不】放宽 LIMITS 而不改测试；炸弹用例必须继续过。
   3. 旁注只写本实例 DSH_HOME 下，按 attachmentId 命名——实例按账号分开，旁注天然按账号隔离。

   *更新：2026-11-01 · 首版（sesame，文件附件）*
   ================================================================ */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { unzipSync, gunzipSync, strFromU8 } from 'fflate'
import { readDocumentBytes } from './documents.ts'

/** 各种上限：都是"超了就降级成只给列表/只给开头"，不是报错。 */
export const LIMITS = Object.freeze({
  /** 交给模型的单个文件文字上限（字符）。超了截断并注明。 */
  textChars: 40_000,
  /** 压缩包条目数上限。 */
  archiveEntries: 2_000,
  /** 压缩包合计解压大小上限（字节）。 */
  archiveTotalBytes: 64 * 1024 * 1024,
  /** 压缩包单条解压大小上限（字节）。 */
  archiveEntryBytes: 16 * 1024 * 1024,
  /** 压缩比上限：单条解压/压缩超过这个倍数视为炸弹。 */
  archiveRatio: 120,
  /** 压缩包里最多读几份文件的内容（其余只列名字）。 */
  archiveReadFiles: 40,
  /** 文件列表最多列几行。 */
  listLines: 300,
  /** 原文件超过这个大小就不解析，只说明大小（上传上限另在路由层）。 */
  sourceBytes: 50 * 1024 * 1024,
})

/** 按扩展名直接当文本读的格式（含代码）。 */
const TEXT_EXT = new Set([
  'txt', 'text', 'md', 'markdown', 'mdx', 'rst', 'adoc', 'org', 'tex', 'log', 'out',
  'json', 'jsonl', 'ndjson', 'json5', 'geojson', 'ipynb', 'csv', 'tsv', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
  'env', 'properties', 'xml', 'html', 'htm', 'xhtml', 'svg', 'srt', 'vtt', 'sub', 'ass',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'vue', 'svelte', 'astro', 'css', 'scss', 'sass', 'less', 'styl',
  'py', 'pyi', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'scala', 'groovy', 'gradle', 'swift', 'm', 'mm',
  'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'cs', 'fs', 'vb', 'php', 'pl', 'pm', 'lua', 'r', 'jl', 'dart', 'ex', 'exs',
  'erl', 'hs', 'clj', 'cljs', 'elm', 'nim', 'zig', 'v', 'sol', 'sql', 'graphql', 'gql', 'proto', 'thrift',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'bat', 'cmd', 'makefile', 'mk', 'cmake', 'dockerfile', 'nix',
  'tf', 'hcl', 'lock', 'gitignore', 'editorconfig', 'diff', 'patch', 'bib', 'ics', 'vcf',
])

/** 文件结果：给旁注与模型用。 */
export interface FileTextResult {
  readonly ok: boolean
  /** 人读的类型名，如 "PDF"、"ZIP 压缩包"、"文本"。 */
  readonly kind: string
  /** 正文（可能已截断）；ok:false 时为空。 */
  readonly text: string
  /** 说明：截断、跳过、读不了的原因。 */
  readonly notes: readonly string[]
}

/** 取小写扩展名；Makefile/Dockerfile 这类无扩展名的按全名。 */
export function extOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name
  const lower = base.toLowerCase()
  if (lower.endsWith('.tar.gz')) return 'tar.gz'
  const dot = lower.lastIndexOf('.')
  if (dot <= 0) return lower
  return lower.slice(dot + 1)
}

/** 嗅探：前 8KB 无 NUL、能按 UTF-8 严格解码，就当文本。 */
export function looksLikeText(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, Math.min(bytes.byteLength, 8192))
  if (head.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head.byteLength < bytes.byteLength ? trimPartialUtf8(head) : head)
    return true
  } catch {
    return false
  }
}

/** 截掉末尾被切断的半个 UTF-8 字符，避免嗅探误判。 */
function trimPartialUtf8(bytes: Uint8Array): Uint8Array {
  let end = bytes.byteLength
  for (let i = 1; i <= 3 && end - i >= 0; i++) {
    const byte = bytes[end - i]!
    if ((byte & 0xc0) === 0x80) continue
    if ((byte & 0xc0) === 0xc0) end -= i
    break
  }
  return bytes.subarray(0, end)
}

/** UTF-8 解码（宽松；带 BOM 去掉）。 */
function decodeText(bytes: Uint8Array): string {
  const text = new TextDecoder('utf-8').decode(bytes)
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** XML/HTML → 纯文字（够模型读，不追求排版）。 */
export function xmlToText(xml: string): string {
  return xml
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|br|text:p|text:h|a:p)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 压缩包条目（只读中央目录得到的声明值）。 */
interface ZipEntry { readonly name: string, readonly size: number, readonly originalSize: number }

/** 只读中央目录列条目，不解压。坏包抛错由调用方接住。 */
export function listZip(bytes: Uint8Array): ZipEntry[] {
  const entries: ZipEntry[] = []
  unzipSync(bytes, {
    filter(file) {
      entries.push({ name: file.name, size: file.size, originalSize: file.originalSize })
      return false
    },
  })
  return entries
}

/** 炸弹检查：返回不通过的原因；通过返回 undefined。 */
export function zipBombReason(entries: readonly ZipEntry[]): string | undefined {
  if (entries.length > LIMITS.archiveEntries) return `条目 ${entries.length} 个，超过 ${LIMITS.archiveEntries} 个上限`
  let total = 0
  for (const entry of entries) {
    total += entry.originalSize
    if (entry.originalSize > LIMITS.archiveTotalBytes) return `"${entry.name}" 解压后 ${mb(entry.originalSize)}，超过上限`
    if (entry.size > 0 && entry.originalSize / entry.size > LIMITS.archiveRatio && entry.originalSize > 1024 * 1024) {
      return `"${entry.name}" 压缩比异常（疑似解压炸弹）`
    }
  }
  if (total > LIMITS.archiveTotalBytes) return `解压后合计 ${mb(total)}，超过 ${mb(LIMITS.archiveTotalBytes)} 上限`
  return undefined
}

/** 安全解出 zip 里选中的条目；每条实际字节再核一次。 */
function unzipSelected(bytes: Uint8Array, wanted: Set<string>): Record<string, Uint8Array> {
  const out = unzipSync(bytes, { filter: file => wanted.has(file.name) && file.originalSize <= LIMITS.archiveEntryBytes })
  for (const [name, data] of Object.entries(out)) {
    if (data.byteLength > LIMITS.archiveEntryBytes) delete out[name]
  }
  return out
}

const mb = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`

/** OOXML/ODF/EPUB 这类"zip 外壳"文档：先过炸弹检查再解。 */
function guardedContainer(bytes: Uint8Array): { entries: ZipEntry[], reason?: string } {
  let entries: ZipEntry[]
  try {
    entries = listZip(bytes)
  } catch {
    return { entries: [], reason: '文件已损坏，或不是有效的压缩格式' }
  }
  const reason = zipBombReason(entries)
  return reason === undefined ? { entries } : { entries, reason }
}

/** PPTX：按幻灯片顺序抽 <a:t>。 */
function readPptx(bytes: Uint8Array): FileTextResult {
  const { entries, reason } = guardedContainer(bytes)
  if (reason !== undefined) return { ok: false, kind: 'PPT 演示文稿', text: '', notes: [reason] }
  const slides = entries.map(e => e.name).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
  const files = unzipSelected(bytes, new Set(slides))
  const parts = slides.map((name, index) => {
    const xml = files[name] === undefined ? '' : strFromU8(files[name]!)
    const runs = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => xmlToText(m[1]!)).filter(Boolean)
    return `【第 ${index + 1} 页】\n${runs.join('\n')}`
  })
  return { ok: true, kind: 'PPT 演示文稿', text: parts.join('\n\n'), notes: [`共 ${slides.length} 页`] }
}

/** ODT/ODS/ODP：content.xml 去标签。 */
function readOdf(bytes: Uint8Array, ext: string): FileTextResult {
  const kind = ext === 'ods' ? 'OpenDocument 表格' : ext === 'odp' ? 'OpenDocument 演示文稿' : 'OpenDocument 文档'
  const { reason } = guardedContainer(bytes)
  if (reason !== undefined) return { ok: false, kind, text: '', notes: [reason] }
  const files = unzipSelected(bytes, new Set(['content.xml']))
  if (files['content.xml'] === undefined) return { ok: false, kind, text: '', notes: ['文件里找不到正文（content.xml）'] }
  const xml = strFromU8(files['content.xml']).replace(/<\/table:table-cell>/g, '\t').replace(/<\/table:table-row>/g, '\n')
  return { ok: true, kind, text: xmlToText(xml), notes: [] }
}

/** EPUB：按文件名顺序把 xhtml 去标签。 */
function readEpub(bytes: Uint8Array): FileTextResult {
  const { entries, reason } = guardedContainer(bytes)
  if (reason !== undefined) return { ok: false, kind: 'EPUB 电子书', text: '', notes: [reason] }
  const pages = entries.map(e => e.name).filter(n => /\.(x?html?)$/i.test(n)).sort()
  const files = unzipSelected(bytes, new Set(pages))
  const text = pages.map(name => files[name] === undefined ? '' : xmlToText(strFromU8(files[name]!))).filter(Boolean).join('\n\n')
  return { ok: true, kind: 'EPUB 电子书', text, notes: [`共 ${pages.length} 个章节文件`] }
}

/** RTF：去控制字（粗读，够看内容）。 */
function readRtf(bytes: Uint8Array): FileTextResult {
  const raw = decodeText(bytes)
  const text = raw
    .replace(/\\'([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\u(-?\d+)\??/g, (_, code) => String.fromCharCode((Number(code) + 65536) % 65536))
    .replace(/\\par[d]?/g, '\n')
    .replace(/\{\\\*[^{}]*\}/g, '')
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/[{}]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { ok: true, kind: 'RTF 文档', text, notes: ['RTF 为粗略提取，格式已去掉'] }
}

/** tar：512 字节块，ustar 头。 */
export function listTar(bytes: Uint8Array): { name: string, size: number, offset: number }[] {
  const out: { name: string, size: number, offset: number }[] = []
  let offset = 0
  while (offset + 512 <= bytes.byteLength && out.length <= LIMITS.archiveEntries) {
    const header = bytes.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const field = (start: number, len: number) => strFromU8(header.subarray(start, start + len)).replace(/\0[\s\S]*$/, '')
    const prefix = field(345, 155)
    const name = (prefix ? `${prefix}/` : '') + field(0, 100)
    const size = parseInt(field(124, 12).trim() || '0', 8) || 0
    const type = field(156, 1)
    if (type === '0' || type === '' ) out.push({ name, size, offset: offset + 512 })
    else if (type === '5') out.push({ name: name.endsWith('/') ? name : `${name}/`, size: 0, offset: offset + 512 })
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return out
}

/** gzip 声明的解压大小（ISIZE，mod 2^32）。 */
function gzipDeclaredSize(bytes: Uint8Array): number {
  if (bytes.byteLength < 18) return 0
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return v.getUint32(bytes.byteLength - 4, true)
}

/** 压缩包里的一份文件：读得懂就给内容。 */
async function readInner(name: string, data: Uint8Array): Promise<FileTextResult | undefined> {
  const ext = extOf(name)
  if (['zip', 'jar', 'rar', '7z', 'tar', 'gz', 'tgz', 'tar.gz', 'bz2', 'xz'].includes(ext)) return undefined // 套娃只列名字
  const result = await extractFileText(data, name, { nested: true })
  return result.ok && result.text.trim().length > 0 ? result : undefined
}

/** 把"列表 + 内容"拼成一份给模型的文字。 */
async function archiveText(
  kind: string,
  list: readonly { name: string, size: number }[],
  read: (names: Set<string>) => Record<string, Uint8Array>,
): Promise<FileTextResult> {
  const notes: string[] = []
  const files = list.filter(e => !e.name.endsWith('/'))
  const lines = files.slice(0, LIMITS.listLines).map(e => `- ${e.name}（${mb(e.size)}）`)
  if (files.length > LIMITS.listLines) lines.push(`- ……另有 ${files.length - LIMITS.listLines} 个文件未列出`)
  const candidates = files.filter(e => e.size > 0 && e.size <= LIMITS.archiveEntryBytes && !/(^|\/)(__MACOSX|\.git|node_modules)\//.test(e.name) && !/(^|\/)\._/.test(e.name))
  const chosen = candidates.slice(0, LIMITS.archiveReadFiles)
  const data = read(new Set(chosen.map(e => e.name)))
  const bodies: string[] = []
  let skipped = 0
  for (const entry of chosen) {
    const bytes = data[entry.name]
    if (bytes === undefined) { skipped++; continue }
    const inner = await readInner(entry.name, bytes)
    if (inner === undefined) { skipped++; continue }
    bodies.push(`===== ${entry.name} =====\n${inner.text}`)
  }
  if (candidates.length > chosen.length) notes.push(`文件太多，只读了前 ${chosen.length} 个的内容`)
  if (skipped > 0) notes.push(`${skipped} 个文件是二进制或读不出文字，只列了名字`)
  const text = `文件列表（共 ${files.length} 个）：\n${lines.join('\n')}${bodies.length > 0 ? `\n\n文件内容：\n${bodies.join('\n\n')}` : ''}`
  return { ok: true, kind, text, notes }
}

/** 选项：nested 表示压缩包里的文件（不再展开套娃）。 */
export interface ExtractOptions { readonly nested?: boolean }

/**
 * 把一份文件转成给模型读的文字。
 * @param bytes - 文件字节
 * @param name - 原文件名（用扩展名判断类型）
 * @returns 结果；从不抛异常
 */
export async function extractFileText(bytes: Uint8Array, name: string, options: ExtractOptions = {}): Promise<FileTextResult> {
  try {
    return await extractInner(bytes, name, options)
  } catch (error) {
    return { ok: false, kind: '文件', text: '', notes: [`解析出错：${error instanceof Error ? error.message : String(error)}`] }
  }
}

async function extractInner(bytes: Uint8Array, name: string, options: ExtractOptions): Promise<FileTextResult> {
  const ext = extOf(name)
  if (bytes.byteLength > LIMITS.sourceBytes) return { ok: false, kind: '文件', text: '', notes: [`文件 ${mb(bytes.byteLength)}，超过 ${mb(LIMITS.sourceBytes)} 的解析上限`] }
  if (ext === 'pdf' || ext === 'docx' || ext === 'xlsx' || ext === 'xlsm') {
    if (ext !== 'pdf') {
      const { reason } = guardedContainer(bytes)
      if (reason !== undefined) return { ok: false, kind: ext === 'docx' ? 'Word 文档' : 'Excel 表格', text: '', notes: [reason] }
    }
    const result = await readDocumentBytes(bytes, ext === 'xlsm' ? 'xlsx' : ext)
    const kind = ext === 'pdf' ? 'PDF' : ext === 'docx' ? 'Word 文档' : 'Excel 表格'
    if (!result.ok) return { ok: false, kind, text: '', notes: [result.scanned ? '这是扫描版 PDF，没有文字层，需要 OCR 才能读' : (result.reason ?? '读不出文字')] }
    return { ok: true, kind, text: result.text, notes: result.outline === undefined ? [] : [result.outline.join('；')] }
  }
  if (ext === 'pptx') return readPptx(bytes)
  if (ext === 'odt' || ext === 'ods' || ext === 'odp') return readOdf(bytes, ext)
  if (ext === 'epub') return readEpub(bytes)
  if (ext === 'rtf') return readRtf(bytes)
  if (ext === 'doc' || ext === 'xls' || ext === 'ppt') {
    return { ok: false, kind: '旧版 Office 文件', text: '', notes: ['旧版 .doc/.xls/.ppt 是老的二进制格式，读不了；另存为 .docx/.xlsx/.pptx 或 PDF 再传'] }
  }
  if (ext === 'zip' && !options.nested) {
    let entries: ZipEntry[]
    try {
      entries = listZip(bytes)
    } catch {
      return { ok: false, kind: 'ZIP 压缩包', text: '', notes: ['压缩包已损坏或加了密码，解不开'] }
    }
    const reason = zipBombReason(entries)
    const list = entries.map(e => ({ name: e.name, size: e.originalSize }))
    if (reason !== undefined) {
      const lines = list.slice(0, LIMITS.listLines).map(e => `- ${e.name}（${mb(e.size)}）`)
      return { ok: true, kind: 'ZIP 压缩包', text: `文件列表（共 ${list.length} 个）：\n${lines.join('\n')}`, notes: [`没有解压：${reason}`] }
    }
    return archiveText('ZIP 压缩包', list, names => unzipSelected(bytes, names))
  }
  if ((ext === 'tar' || ext === 'tgz' || ext === 'tar.gz' || ext === 'gz') && !options.nested) {
    let tar = bytes
    if (ext !== 'tar') {
      const declared = gzipDeclaredSize(bytes)
      if (declared > LIMITS.archiveTotalBytes || (declared / Math.max(1, bytes.byteLength) > LIMITS.archiveRatio && declared > 1024 * 1024)) {
        return { ok: false, kind: 'GZ 压缩包', text: '', notes: ['解压后过大或压缩比异常（疑似解压炸弹），没有解压'] }
      }
      tar = gunzipSync(bytes)
      if (tar.byteLength > LIMITS.archiveTotalBytes) return { ok: false, kind: 'GZ 压缩包', text: '', notes: ['解压后过大，已丢弃'] }
      if (ext === 'gz') {
        const innerName = name.replace(/\.gz$/i, '')
        if (!/\.tar$/i.test(innerName)) return extractInner(tar, innerName, { nested: true })
      }
    }
    const entries = listTar(tar)
    if (entries.length > LIMITS.archiveEntries) return { ok: false, kind: 'TAR 压缩包', text: '', notes: [`条目超过 ${LIMITS.archiveEntries} 个上限`] }
    return archiveText(ext === 'tar' ? 'TAR 压缩包' : 'TAR.GZ 压缩包', entries, names => {
      const out: Record<string, Uint8Array> = {}
      for (const entry of entries) if (names.has(entry.name)) out[entry.name] = tar.subarray(entry.offset, entry.offset + entry.size)
      return out
    })
  }
  if (['rar', '7z', 'bz2', 'xz'].includes(ext)) {
    return { ok: false, kind: `${ext.toUpperCase()} 压缩包`, text: '', notes: [`.${ext} 格式这边没有解压工具，读不了；换成 .zip 再传`] }
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic', 'heif', 'tif', 'tiff', 'ico'].includes(ext)) {
    return { ok: false, kind: '图片文件', text: '', notes: ['图片要按图片发送，模型才能看图'] }
  }
  if (['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) {
    return { ok: false, kind: '音视频文件', text: '', notes: ['音视频读不了内容，只能看到文件名和大小'] }
  }
  if (TEXT_EXT.has(ext) || looksLikeText(bytes)) {
    const text = decodeText(bytes)
    const kind = ext === 'csv' || ext === 'tsv' ? '表格文本' : TEXT_EXT.has(ext) && !['txt', 'text', 'md', 'markdown', 'log'].includes(ext) ? '代码/文本' : '文本'
    if (/\.(html?|xhtml)$/i.test(name)) return { ok: true, kind: '网页', text: xmlToText(text), notes: [] }
    return { ok: true, kind, text, notes: [] }
  }
  return { ok: false, kind: '二进制文件', text: '', notes: [`.${ext || '无扩展名'} 是二进制文件，读不出文字`] }
}

/** 旁注里存的东西。 */
interface Sidecar { readonly v: 1, readonly name: string, readonly bytes: number, readonly kind: string, readonly ok: boolean, readonly text: string, readonly notes: readonly string[], readonly truncated: boolean }

/** attachmentId（sha256:…）→ 安全文件名。 */
function sidecarName(attachmentId: unknown): string | undefined {
  const id = String(attachmentId ?? '')
  return /^sha256:[0-9a-f]{64}$/.test(id) ? `${id.replace(':', '_')}.json` : undefined
}

/** 文件引用的最小形状（DSH FileRef）。 */
interface FileRefLike { readonly attachmentId: unknown, readonly name?: unknown, readonly bytes?: unknown }
/** 附件服务里本模块用到的两个方法。 */
interface AttachmentsLike { fileHostPath?: (ref: FileRefLike) => string | undefined }

/**
 * 上传落盘后调用：抽文字、写旁注。从不抛异常。
 * @returns 写好的旁注路径；没写返回 undefined
 */
export async function writeFileSidecar(dir: string, file: FileRefLike, attachments: AttachmentsLike | undefined): Promise<string | undefined> {
  try {
    const fileName = sidecarName(file.attachmentId)
    if (fileName === undefined) return undefined
    const target = join(dir, fileName)
    if (existsSync(target)) return target // 同一份内容（同 sha）已经抽过
    const hostPath = attachments?.fileHostPath?.(file)
    if (typeof hostPath !== 'string') return undefined
    const bytes = await readFile(hostPath)
    const name = typeof file.name === 'string' ? file.name : 'file'
    const result = await extractFileText(bytes, name)
    const truncated = result.text.length > LIMITS.textChars
    const sidecar: Sidecar = {
      v: 1, name, bytes: bytes.byteLength, kind: result.kind, ok: result.ok,
      text: truncated ? result.text.slice(0, LIMITS.textChars) : result.text,
      notes: truncated ? [...result.notes, `内容很长，只给了前 ${LIMITS.textChars} 个字`] : result.notes,
      truncated,
    }
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const temp = `${target}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(sidecar), { mode: 0o600 })
    renameSync(temp, target)
    return target
  } catch {
    return undefined
  }
}

/**
 * 模型请求组装时同步调用：有旁注就返回接在文件说明后面的文字块。
 * @returns 文字块；没有旁注返回 undefined（模型照旧只看到路径说明）
 */
export function readFileSidecarBlock(dir: string, ref: FileRefLike): string | undefined {
  try {
    const fileName = sidecarName(ref.attachmentId)
    if (fileName === undefined) return undefined
    const target = join(dir, fileName)
    if (!existsSync(target)) return undefined
    const sidecar = JSON.parse(readFileSync(target, 'utf8')) as Sidecar
    const notes = sidecar.notes.length > 0 ? `（${sidecar.notes.join('；')}）` : ''
    if (!sidecar.ok) return `[DOT 已尝试读取这个${sidecar.kind}，读不出内容${notes}。如实告诉用户这个文件读不了，不要编造内容。]`
    return `[DOT 已把这个${sidecar.kind}转成文字，下面就是它的内容${notes}：]\n<file-content name=${JSON.stringify(sidecar.name)}>\n${sidecar.text}\n</file-content>`
  } catch {
    return undefined
  }
}

/** 全局钩子符号（补丁里用同名 Symbol.for）。 */
export const FILE_EXTRACT_SYMBOL = Symbol.for('dot.cloud.fileExtract')
export const FILE_TEXT_SYMBOL = Symbol.for('dot.cloud.fileText')

/**
 * 装钩子：上传补丁调 fileExtract，dsh-llm 补丁调 fileText。
 * @param dir - 旁注目录（本实例 DSH_HOME/dot-file-text）
 * @returns 卸载函数
 */
export function installFileTextHooks(dir: string): () => void {
  const store = globalThis as Record<symbol, unknown>
  const extract = (file: FileRefLike, attachments: AttachmentsLike) => writeFileSidecar(dir, file, attachments)
  const text = (ref: FileRefLike) => readFileSidecarBlock(dir, ref)
  store[FILE_EXTRACT_SYMBOL] = extract
  store[FILE_TEXT_SYMBOL] = text
  return () => {
    if (store[FILE_EXTRACT_SYMBOL] === extract) delete store[FILE_EXTRACT_SYMBOL]
    if (store[FILE_TEXT_SYMBOL] === text) delete store[FILE_TEXT_SYMBOL]
  }
}
