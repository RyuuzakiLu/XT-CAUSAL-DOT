async function copy(button: HTMLButtonElement, text: string) {
  if (!text.trim()) return
  const win = button.ownerDocument.defaultView
  if (!win) return
  const nav = win.navigator
  try {
    await nav.clipboard.writeText(text)
    button.title = '已复制'
    const notice = button.ownerDocument.createElement('span')
    notice.setAttribute('role', 'status')
    notice.textContent = button.title
    button.after(notice)
    win.setTimeout(() => notice.remove(), 1800)
  } catch (error) {
    if ((error as Error)?.name !== 'AbortError') win.prompt('复制这条消息', text)
  }
}

export function historyActions(doc: Document, text: string): HTMLElement {
  const strip = doc.createElement('div')
  strip.setAttribute('data-dot-chain-actions', '')
  const button = doc.createElement('button')
  button.type = 'button'
  button.setAttribute('aria-label', '复制')
  button.setAttribute('data-dot-reply-action', '')
  const svg = doc.createElementNS('http://www.w3.org/2000/svg','svg')
  svg.setAttribute('viewBox','0 0 24 24')
  svg.setAttribute('fill','none')
  svg.setAttribute('stroke','currentColor')
  svg.setAttribute('stroke-width','1.6')
  const path = doc.createElementNS(svg.namespaceURI, 'path')
  path.setAttribute('d', 'M8 8h12v13H8z M4 16V4h12')
  svg.appendChild(path)
  button.appendChild(svg)
  button.onclick = () => { void copy(button, text) }
  strip.appendChild(button)
  return strip
}
