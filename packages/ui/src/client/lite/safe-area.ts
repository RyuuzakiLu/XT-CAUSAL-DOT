/* 2026-11-01 安全区：输入栏、底部按钮要躲开手机底部手势条。
   - 浏览器：meta viewport 加 viewport-fit=cover 后 env(safe-area-inset-*) 才有值（iOS Safari、Chrome 全面屏）。
   - 安卓壳（targetSdk 35 强制全面屏）：WebView 常报 0，壳按系统导航栏/状态栏实际压住的高度
     往 <html> 上写 --dot-inset-bottom / --dot-inset-top（CSS px）。
   - CSS 统一用 --safe-b / --safe-t = max(env(...), --dot-inset-*)，两边都有时取大的，不会叠加。 */

/** 给现有 meta viewport 补 viewport-fit=cover；已有就不动。返回最终 content。 */
export function ensureViewportFitCover(doc: Document = document): string {
  let meta = doc.querySelector('meta[name=viewport]')
  if (!meta) {
    meta = doc.createElement('meta')
    meta.setAttribute('name', 'viewport')
    meta.setAttribute('content', 'width=device-width, initial-scale=1')
    doc.head.append(meta)
  }
  const content = meta.getAttribute('content') ?? ''
  if (/viewport-fit\s*=/i.test(content)) return content
  const next = content.trim() ? `${content.replace(/[\s,]+$/, '')}, viewport-fit=cover` : 'viewport-fit=cover'
  meta.setAttribute('content', next)
  return next
}
