/**
 * 界面上的 DOT 名字跟着账号走（dot-name-2026-10-27，Miles）。
 *
 * 界面里很多地方写死了 ASTRA：输入框“对 ASTRA 说点什么……”、精灵状态“ASTRA 有新信件”、
 * 精灵按钮“ASTRA 待机”“ASTRA 菜单入口”、页面标题等。它们散在十几个组件和 DSH 自己的语言包里，
 * 逐个改成传参改动太大，这里统一在显示层替换：
 *   - 属性：placeholder / aria-label / title / alt 里的 ASTRA → 账号的 DOT 名字；
 *   - 文字：只换“短标签”——整段文字就是“ASTRA”或“ASTRA + 十个字以内”的（状态牌、按钮小字），
 *     对话消息、输入中的文字、可编辑区域一律不动，免得把用户或助理说的话改掉；
 *   - 页面标题 XTCausal DOT · ASTRA → XTCausal DOT · 名字。
 * 没改过名字（仍是 ASTRA）的账号什么都不做。设置里改名后（persona-api 发 dot-persona:changed）立刻生效。
 * 改回 ASTRA 时刷新一次页面即可恢复（已替换的文字记得原文，也会就地换回去）。
 */
import { loadPersona } from './persona-api.ts'

const DEFAULT_NAME = 'ASTRA'
const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'] as const
const SHORT_LABEL = /^\s*ASTRA(\s*\S{0,10})?\s*$/
/* 对话流、消息正文、可编辑区域不碰。 */
/* [data-dot-name-keep]：简洁版顶栏标题自己显示本户助手名（2026-11-01），不让这里再换成 LITE_NAME。 */
const SKIP = '[data-dot-name-keep], [data-chat-flow-kind], [data-message-id], [contenteditable], textarea, input, pre, code, .markdown, [class*=markdown], [class*=Markdown]'

let current = DEFAULT_NAME
let previous = DEFAULT_NAME
const original = new WeakMap<Node, string>()
const originalAttr = new WeakMap<Element, Map<string, string>>()

export function currentDotName(): string { return current }

/* 输入框的占位和 aria-label 由 conversation 文案按本户助手名给出，这里不再改写（2026-11-01 sesame：
   简洁版固定名 LITE_NAME 曾把「和 ASTRA 说点什么……」的 aria-label 换成产品名）。 */
const KEEP_ATTR = '[data-composer-input], [data-composer-placeholder], [data-dot-name-keep]'

function fixAttr(el: Element, attr: string): void {
  if (el.closest(KEEP_ATTR)) return
  const value = el.getAttribute(attr)
  if (value === null) return
  let saved = originalAttr.get(el)
  const base = saved?.get(attr)
  /* 属性被组件重渲染成了新值时，以新值为原文。 */
  const source = base !== undefined && (value === base.split(DEFAULT_NAME).join(current) || value === base.split(DEFAULT_NAME).join(previous)) ? base : value
  if (!source.includes(DEFAULT_NAME)) return
  if (!saved) { saved = new Map(); originalAttr.set(el, saved) }
  saved.set(attr, source)
  const next = source.split(DEFAULT_NAME).join(current)
  if (value !== next) el.setAttribute(attr, next)
}

function fixText(node: Text): void {
  const value = node.nodeValue ?? ''
  const base = original.get(node)
  const source = base !== undefined && (value === base.replace(DEFAULT_NAME, current) || value === base.replace(DEFAULT_NAME, previous)) ? base : value
  if (!SHORT_LABEL.test(source)) return
  const parent = node.parentElement
  if (!parent || parent.closest(SKIP)) return
  original.set(node, source)
  const next = source.replace(DEFAULT_NAME, current)
  if (value !== next) node.nodeValue = next
}

function sweep(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) { fixText(root as Text); return }
  if (!(root instanceof Element)) return
  for (const attr of ATTRS) fixAttr(root, attr)
  for (const el of root.querySelectorAll(ATTRS.map(a => `[${a}*="${DEFAULT_NAME}"], [${a}*="${CSS.escape(current)}"], [${a}*="${CSS.escape(previous)}"]`).join(','))) for (const attr of ATTRS) fixAttr(el, attr)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) fixText(node as Text)
}

function fixTitle(): void {
  if (document.title.includes(DEFAULT_NAME) && current !== DEFAULT_NAME) document.title = document.title.split(DEFAULT_NAME).join(current)
}

/** fixedName：简洁版用——界面上一律显示这个名字，不跟后端人设名走（人设名改了也不影响它）。 */
export function installDotName(fixedName?: string): () => void {
  let observer: MutationObserver | null = null
  let stopped = false
  const apply = (name: string) => {
    const clean = String(name ?? '').trim() || DEFAULT_NAME
    if (clean === current && observer) return
    previous = current
    current = clean
    if (current === DEFAULT_NAME && !observer) return
    if (!observer) {
      observer = new MutationObserver(records => {
        for (const record of records) {
          if (record.type === 'attributes' && record.target instanceof Element && record.attributeName) fixAttr(record.target, record.attributeName)
          else if (record.type === 'characterData') fixText(record.target as Text)
          else for (const node of record.addedNodes) sweep(node)
        }
        fixTitle()
      })
      observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] })
      const titleEl = document.querySelector('title')
      if (titleEl) observer.observe(titleEl, { childList: true, characterData: true, subtree: true })
    }
    sweep(document.body)
    fixTitle()
  }
  if (fixedName) {
    apply(fixedName)
    return () => { stopped = true; observer?.disconnect(); observer = null }
  }
  const onChanged = (event: Event) => { const name = (event as CustomEvent).detail?.name; if (typeof name === 'string') apply(name) }
  window.addEventListener('dot-persona:changed', onChanged)
  loadPersona().then(view => { if (!stopped) apply(view.profile?.name ?? DEFAULT_NAME) }).catch(() => {})
  return () => { stopped = true; window.removeEventListener('dot-persona:changed', onChanged); observer?.disconnect(); observer = null }
}
