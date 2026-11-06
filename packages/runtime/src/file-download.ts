/* ================================================================
   对话里的文件卡片 → 下载 / 预览

   ▍这是什么
   GET /api/dotFiles/download?id=sha256:…&name=…[&inline=1]
   按 attachmentId + 文件名从本实例的附件库读出文件原样返回。
   inline=1 且类型可预览（PDF、图片、纯文本）时按预览给，其余一律按下载给。

   ▍安全
   - 账号门：由 dot-cloud-runtime 的路由检查放行（只有单账号实例的本人）；
     实例按账号分开、附件库在实例自己的 DSH_HOME，所以读得到的只有本账号的文件。
   - id 必须是 sha256:<64 位十六进制>；name 不许带路径分隔符；
     附件库自己还会再校验一遍引用。
   - 文本类一律 text/plain（HTML/SVG 也是），加 nosniff 和 sandbox，
     不会在 DOT 的域名下执行用户传来的脚本。

   *更新：2026-11-01 · 首版（sesame，文件附件）*
   ================================================================ */
import { createReadStream, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { extOf } from './file-extract.ts'

export const FILE_DOWNLOAD_PATH = '/api/dotFiles/download'

const PREVIEW_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm',
}
const TEXT_PREVIEW = new Set([
  'txt', 'md', 'markdown', 'log', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'ini', 'xml', 'html', 'htm', 'svg',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'rb', 'sh',
  'sql', 'css', 'scss', 'vue', 'swift', 'lua', 'r', 'srt', 'vtt', 'conf', 'cfg', 'env', 'diff', 'patch',
])

/** 附件服务里用到的方法。 */
export interface DownloadAttachments { fileHostPath?: (ref: { kind: 'file', attachmentId: string, name: string, bytes: number }) => string | undefined }

const textResponse = (status: number, message: string) => new Response(message, {
  status,
  headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
})

/**
 * 处理一次下载请求。
 * @param request - 入站请求
 * @param attachments - 本实例附件服务
 */
export function handleFileDownload(request: Request, attachments: DownloadAttachments | undefined): Response {
  const url = new URL(request.url, 'http://dot.local')
  const id = url.searchParams.get('id') ?? ''
  const name = url.searchParams.get('name') ?? ''
  const inline = url.searchParams.get('inline') === '1'
  if (!/^sha256:[0-9a-f]{64}$/.test(id)) return textResponse(400, '文件编号不对')
  if (name === '' || name.length > 255 || /[\\/\0]/.test(name) || name === '.' || name === '..') return textResponse(400, '文件名不对')
  let hostPath: string | undefined
  let size: number
  try {
    hostPath = attachments?.fileHostPath?.({ kind: 'file', attachmentId: id, name, bytes: 0 })
    if (typeof hostPath !== 'string') return textResponse(404, '找不到这个文件')
    const stat = statSync(hostPath)
    if (!stat.isFile()) return textResponse(404, '找不到这个文件')
    size = stat.size
  } catch {
    return textResponse(404, '找不到这个文件')
  }
  const ext = extOf(name)
  const previewType = PREVIEW_TYPES[ext] ?? (TEXT_PREVIEW.has(ext) ? 'text/plain; charset=utf-8' : undefined)
  const disposition = inline && previewType !== undefined ? 'inline' : 'attachment'
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  const body = Readable.toWeb(createReadStream(hostPath)) as unknown as ReadableStream<Uint8Array>
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': disposition === 'inline' ? previewType! : 'application/octet-stream',
      'content-length': String(size),
      'content-disposition': `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'x-content-type-options': 'nosniff',
      /* PDF 不加 sandbox：浏览器自带的 PDF 阅读器在 sandbox 下会拒绝打开；PDF 不会在 DOT 的域名下跑脚本。 */
      'content-security-policy': `${disposition === 'inline' && previewType === 'application/pdf' ? '' : 'sandbox; '}default-src 'none'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'unsafe-inline'; object-src 'self'`,
      'cache-control': 'private, max-age=300',
    },
  })
}
