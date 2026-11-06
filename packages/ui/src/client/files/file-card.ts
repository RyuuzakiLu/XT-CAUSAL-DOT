/* ================================================================
   对话里的文件卡片（2026-11-01 sesame，文件附件）

   - 这是什么
   原生聊天把用户发的普通文件画成一个不能点的 <span>（图标 + 文件名 + 类型大小）。
   dot-cloud-runtime 的补丁 chat.file-card-open 给它加了 data-dot-file-id / -name / -bytes
   和 role=button。这里：
   · installFileCardOpen：在 document 上委托点击和回车/空格，能预览的（PDF、图片、纯文本）
     新开标签页预览，其余直接下载。经典版、简洁版都装。
   · FILE_CARD_CSS：简洁版的新色卡样式（白卡 + 浅色图标底），跟图片缩略图框区分开。

   - 下载地址
   api/dotFiles/download?id=…&name=…[&inline=1]，按页面相对路径拼（跟原生上传路由一样）。
   账号门在 dot-cloud-runtime：只有单账号实例的本人能读，读到的只有本账号附件库。
   ================================================================ */

const PREVIEW_EXT = new Set([
  'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp',
  'txt', 'md', 'markdown', 'log', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'ini', 'xml', 'html', 'htm', 'svg',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'rb', 'sh',
  'sql', 'css', 'scss', 'vue', 'swift', 'lua', 'r', 'srt', 'vtt', 'conf', 'cfg', 'env', 'diff', 'patch',
])

const extOf = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** 这个文件点开是预览还是下载。 */
export function fileOpenMode(name: string): 'preview' | 'download' {
  return PREVIEW_EXT.has(extOf(name)) ? 'preview' : 'download'
}

/**
 * 拼下载地址；编号或文件名不对返回 undefined（不发请求）。
 * @param base - 页面地址（document.baseURI）
 */
export function fileDownloadUrl(id: string, name: string, base: string, inline: boolean): string | undefined {
  if (!/^sha256:[0-9a-f]{64}$/.test(id)) return undefined
  if (name === '' || name.length > 255 || /[\\/\0]/.test(name)) return undefined
  const url = new URL('api/dotFiles/download', base)
  url.searchParams.set('id', id)
  url.searchParams.set('name', name)
  if (inline) url.searchParams.set('inline', '1')
  return url.toString()
}

/** 打开一张文件卡片。返回是否处理了。 */
export function openFileCard(card: Element, doc: Document = document): boolean {
  const id = card.getAttribute('data-dot-file-id') ?? ''
  const name = card.getAttribute('data-dot-file-name') ?? ''
  const mode = fileOpenMode(name)
  const url = fileDownloadUrl(id, name, doc.baseURI, mode === 'preview')
  if (url === undefined) return false
  const view = doc.defaultView
  if (mode === 'preview' && view !== null) {
    view.open(url, '_blank', 'noopener')
    return true
  }
  const link = doc.createElement('a')
  link.href = url
  link.download = name
  link.rel = 'noopener'
  link.style.display = 'none'
  doc.body.appendChild(link)
  link.click()
  link.remove()
  return true
}

/** 在 document 上委托：点击、回车、空格打开文件卡片。返回卸载函数。 */
export function installFileCardOpen(doc: Document = document): () => void {
  const cardOf = (target: EventTarget | null) => (target instanceof Element ? target.closest('[data-dot-file-id]') : null)
  const onClick = (event: MouseEvent) => {
    const card = cardOf(event.target)
    if (card === null) return
    if (openFileCard(card, doc)) event.preventDefault()
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const card = cardOf(event.target)
    if (card === null || card !== event.target) return
    if (openFileCard(card, doc)) event.preventDefault()
  }
  doc.addEventListener('click', onClick)
  doc.addEventListener('keydown', onKey)
  return () => {
    doc.removeEventListener('click', onClick)
    doc.removeEventListener('keydown', onKey)
  }
}

/* 新色卡：浅色底 #F8F9FC、卡片 #FFFFFF、次要灰 #667085、蓝 #3B5BDB；深色 #0E1018、#171A24、#98A0B3。
   选择器带 [role=button] 压过原生的哈希类名；子元素按结构定位（图标 / 文字列 > 文件名、类型大小）。 */
export const FILE_CARD_CSS = `
span[data-dot-file-id][role="button"] {
  display: inline-flex; align-items: center; gap: 10px; box-sizing: border-box;
  min-width: 196px; max-width: min(320px, 100%); min-height: 56px; padding: 9px 14px 9px 9px;
  border-radius: 14px; border: 1px solid rgba(102, 112, 133, .22); background: #FFFFFF; color: #101828;
  box-shadow: 0 1px 2px rgba(16, 24, 40, .05), 0 2px 8px rgba(16, 24, 40, .04);
  cursor: pointer; text-align: left; outline: none; -webkit-tap-highlight-color: transparent;
  transition: border-color .2s cubic-bezier(.2, .7, .2, 1), box-shadow .2s cubic-bezier(.2, .7, .2, 1);
}
span[data-dot-file-id][role="button"]:hover { border-color: rgba(59, 91, 219, .45); }
span[data-dot-file-id][role="button"]:active { background: #F8F9FC; }
span[data-dot-file-id][role="button"]:focus-visible { box-shadow: 0 0 0 2px #F8F9FC, 0 0 0 4px #3B5BDB; }
span[data-dot-file-id][role="button"] > :first-child {
  flex: none; width: 38px; height: 38px; padding: 9px; box-sizing: border-box; border-radius: 10px;
  background: #F8F9FC; border: 1px solid rgba(102, 112, 133, .14);
}
span[data-dot-file-id][role="button"] > :last-child { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
span[data-dot-file-id][role="button"] > :last-child > :first-child {
  display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 14px; line-height: 20px; font-weight: 500; color: #101828;
}
span[data-dot-file-id][role="button"] > :last-child > :last-child {
  display: block; font-size: 12px; line-height: 16px; color: #667085; letter-spacing: .01em;
}
[data-theme="dark"] span[data-dot-file-id][role="button"] {
  background: #171A24; border-color: rgba(152, 160, 179, .24); color: #E7EAF2;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .3), 0 4px 12px rgba(0, 0, 0, .28);
}
[data-theme="dark"] span[data-dot-file-id][role="button"]:hover { border-color: rgba(123, 147, 240, .55); }
[data-theme="dark"] span[data-dot-file-id][role="button"]:active { background: #0E1018; }
[data-theme="dark"] span[data-dot-file-id][role="button"]:focus-visible { box-shadow: 0 0 0 2px #0E1018, 0 0 0 4px #7B93F0; }
[data-theme="dark"] span[data-dot-file-id][role="button"] > :first-child { background: #0E1018; border-color: rgba(152, 160, 179, .18); }
[data-theme="dark"] span[data-dot-file-id][role="button"] > :last-child > :first-child { color: #E7EAF2; }
[data-theme="dark"] span[data-dot-file-id][role="button"] > :last-child > :last-child { color: #98A0B3; }
@media (prefers-reduced-motion: reduce) { span[data-dot-file-id][role="button"] { transition: none; } }
`
