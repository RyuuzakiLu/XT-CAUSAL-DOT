/* ================================================================
   简洁版图集 · 同一条用户消息里的多张图合成一组（2026-11-01 S3 修）。
   原生 UserContent 把用户消息的每个图片附件单独渲染一次 conversation.chat.user.images 槽，
   每次只给一张（images: [one]，多张时 compact: true），槽组件看不到同一条消息里的其它图。
   这里按 DOM 容器（[data-message-attachments]）把同一行里的槽实例登记到一起：
   排在最前的那个实例画整组堆叠，其余实例只留一个不占位的锚点。
================================================================ */
import type { StackImage, StackLoader } from './ImageStack.tsx'

export interface GroupMember { anchor: Element; image: StackImage; loadImage: StackLoader }

export interface ImageGroup {
  members: Map<symbol, GroupMember>
  version: number
  listeners: Set<() => void>
}

const groups = new WeakMap<Element, ImageGroup>()

/** 锚点所在的那一行附件容器；找不到时退回父元素（测试或别的槽主）。 */
export function groupRoot(anchor: Element): Element | null {
  return anchor.closest('[data-message-attachments]') ?? anchor.parentElement
}

export function groupOf(root: Element): ImageGroup {
  let g = groups.get(root)
  if (!g) { g = { members: new Map(), version: 0, listeners: new Set() }; groups.set(root, g) }
  return g
}

function bump(g: ImageGroup) {
  g.version++
  for (const l of [...g.listeners]) l()
}

export function joinGroup(g: ImageGroup, id: symbol, member: GroupMember): () => void {
  const prev = g.members.get(id)
  g.members.set(id, member)
  if (!prev || prev.image !== member.image || prev.anchor !== member.anchor) bump(g)
  return () => { if (g.members.get(id) === member) { g.members.delete(id); bump(g) } }
}

/** 按锚点在文档里的先后排成一组。 */
export function orderedMembers(g: ImageGroup): Array<[symbol, GroupMember]> {
  return [...g.members.entries()].filter(([, m]) => m.anchor.isConnected).sort(([, a], [, b]) => {
    if (a.anchor === b.anchor) return 0
    return a.anchor.compareDocumentPosition(b.anchor) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  })
}
