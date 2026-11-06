const groups = new WeakMap();
/** 锚点所在的那一行附件容器；找不到时退回父元素（测试或别的槽主）。 */
export function groupRoot(anchor) {
    return anchor.closest('[data-message-attachments]') ?? anchor.parentElement;
}
export function groupOf(root) {
    let g = groups.get(root);
    if (!g) {
        g = { members: new Map(), version: 0, listeners: new Set() };
        groups.set(root, g);
    }
    return g;
}
function bump(g) {
    g.version++;
    for (const l of [...g.listeners])
        l();
}
export function joinGroup(g, id, member) {
    const prev = g.members.get(id);
    g.members.set(id, member);
    if (!prev || prev.image !== member.image || prev.anchor !== member.anchor)
        bump(g);
    return () => { if (g.members.get(id) === member) {
        g.members.delete(id);
        bump(g);
    } };
}
/** 按锚点在文档里的先后排成一组。 */
export function orderedMembers(g) {
    return [...g.members.entries()].filter(([, m]) => m.anchor.isConnected).sort(([, a], [, b]) => {
        if (a.anchor === b.anchor)
            return 0;
        return a.anchor.compareDocumentPosition(b.anchor) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
}
