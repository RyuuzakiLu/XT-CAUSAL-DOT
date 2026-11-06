/* ================================================================
   DOT 按需进度卡 · 总导游图
   ▍这是什么
   只消费当前前台会话新追加的 work_query metadata，召唤临时浮层。
   ▍修改铁律
   1. 【不】重放旧历史就反复弹卡；只处理 append delta，首次绑定跳过已有窗口。
   2. 【不】扫全聊天找中文关键词；机器定位走稳定 meta.workId。
   3. 卡片是显示动作，不往会话日志新写一条消息。
   ▍更新记录
   *更新：2026-10-23 · 原生事件增量到临时工作卡*
================================================================ */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionEventSource } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkId } from '@xtcausal/dot-contracts'

/* 每个source只看最后一次delta，避免一问进度就把整本聊天翻一遍。 */
export function watchProgressCards(ctx: Context, open: (id: WorkId) => void): () => void {
  const { sessions } = ctx
  const watches = new Map<SessionEventSource, { stop: () => void; revision: number }>()
  const reconcile = () => {
    const active = new Set<SessionEventSource>()
    for (const id of sessions.list.getSnapshot().ids) {
      if ((sessions.retainInfo(id).getSnapshot().retainedBy.mainView ?? 0) <= 0) continue
      const binding = sessions.binding(id)
      if (!binding) continue
      const source = binding.eventSource; active.add(source)
      if (watches.has(source)) continue
      const watcher = { revision: source.getSnapshot().revision, stop: () => {} }
      watcher.stop = source.subscribe(() => {
        const snapshot = source.getSnapshot()
        if (snapshot.revision === watcher.revision) return
        watcher.revision = snapshot.revision
        if (snapshot.change.kind !== 'append') return
        for (const entry of snapshot.change.entries) {
          if (entry.type !== 'event' || entry.event.type !== 'tool/result') continue
          const meta = entry.event.data.meta
          if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) continue
          if (meta.dot !== 'work' || meta.kind !== 'work-progress' || !Array.isArray(meta.works)) continue
          const ids = meta.works.flatMap(item => typeof item === 'object' && item !== null && !Array.isArray(item) && typeof item.workId === 'string' ? [item.workId as WorkId] : [])
          if (ids.length === 1 && ids[0]) open(ids[0])
        }
      })
      watches.set(source, watcher)
    }
    for (const [source, watcher] of watches) if (!active.has(source)) { watcher.stop(); watches.delete(source) }
  }
  const stop = sessions.list.subscribe(reconcile)
  reconcile()
  return () => { stop(); for (const watcher of watches.values()) watcher.stop(); watches.clear() }
}
