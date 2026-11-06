/* ================================================================
   分块样式挂载 · 总导游图
   ▍这是什么
   场景/设置块的 CSS Module 文本随块到达后再挂 <style>；块没到就不占样式，
   也不把别的房间的规则塞进首屏。
   ▍为什么不由 index.ts 一次挂完
   那样等于首开仍背所有房间的样式文本（虽然比图小，但没有理由）。样式跟块走，
   房间没进过就没有它的规则；类名映射在块的 JS 里，不会出现"有类名没规则"。
   ▍为什么挂上后不随组件卸载
   房间来回切换是常态，每次卸载再挂会闪一下；这些规则属于插件生命周期，
   统一由 index.ts 在插件卸载时 releaseChunkStyles() 清掉。
   ▍修改铁律
   1. 【不】模块求值时插标签：块被重复求值/插件重挂会叠样式（血泪见 tsdown.client.ts）。
   2. 同一个 key 只挂一次；重复调用是空操作。
   ▍更新记录
   2026-10-25 · 建立：按需块的样式随块挂载、随插件卸载清理。
   ================================================================ */

/**
 * 已挂的样式标签。
 * ⚠️ 页面单例：壳与各按需块各打包一份本模块；如果各记一份，插件卸载时壳只清得掉
 * 自己那张表，块挂的样式会永远留在 document 里（下次重挂就叠两层）。
 */
const STYLE_KEY = Symbol.for('xtcausal.dot.chunk-styles')
const styleHost = globalThis as unknown as { [STYLE_KEY]?: Map<string, HTMLStyleElement> }
const mounted: Map<string, HTMLStyleElement> = styleHost[STYLE_KEY] ?? (styleHost[STYLE_KEY] = new Map())

/**
 * 挂一块的样式（幂等）。
 * @param key - 稳定身份（块 id），用于去重与清理定位
 * @param cssText - 块内 CSS Module 的编译后文本
 */
export function ensureChunkStyle(key: string, cssText: string | undefined): void {
  if (typeof document === 'undefined' || cssText === undefined || cssText.length === 0) return
  if (mounted.has(key)) return
  const tag = document.createElement('style')
  tag.dataset.dotCss = `chunk:${key}`
  tag.textContent = cssText
  document.head.appendChild(tag)
  mounted.set(key, tag)
}

/** 插件卸载时清掉所有分块样式（房间没打开的块本来就没有标签）。 */
export function releaseChunkStyles(): void {
  for (const tag of mounted.values()) tag.remove()
  mounted.clear()
}
