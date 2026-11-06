/* ================================================================
   简洁版 · 消息列表（2026-10-31）
   ◍ 精灵气泡没了以后，提醒只在顶部露几秒；错过的要能回头找。这里把露出来过的每条提醒
     （同一个气泡队列，加上「你不在时」汇总）记下来，顶栏铃铛和抽屉「消息」读它。
   ◍ 本次页面会话最多保留 60 条；持久消息来自服务端邮匣，旧无账号归属记录不加载。
   ================================================================ */
import type { DotNotice } from '../notify/notices.ts'

export const NOTICE_LOG_KEY = 'xtcausal.dot.lite.notices.v1'
const LIMIT = 60

export type LoggedNotice = {
  readonly key: string
  readonly at: number
  readonly kind: DotNotice['kind']
  readonly tone: DotNotice['tone']
  readonly eyebrow: string
  readonly title: string
  readonly text?: string | undefined
  readonly workId?: string | undefined
  readonly postboxId?: string | undefined
  readonly entryUrl?: string | undefined
  readonly read: boolean
}

/* 旧 localStorage 缺账号归属，不能跨账号读取。持久消息以服务端邮匣为准；
   尚未入邮匣的临时通知只保存在当前页面内存。旧数据保留原样，不做迁移或删除。 */
let items: LoggedNotice[] = []
const listeners = new Set<() => void>()
function save(next: LoggedNotice[]): void {
  items = next.slice(0, LIMIT)
  for (const listener of listeners) listener()
}

export const noticeLog = {
  subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } },
  get(): readonly LoggedNotice[] { return items },
  unread(): number { return items.reduce((count, item) => count + (item.read ? 0 : 1), 0) },
  record(notice: DotNotice, read = false): void {
    const previous = items.find(item => item.key === notice.key)
    const entry: LoggedNotice = {
      key: notice.key, at: previous?.at ?? notice.at ?? Date.now(), kind: notice.kind, tone: notice.tone,
      eyebrow: notice.eyebrow, title: notice.title, text: notice.text, workId: notice.workId, postboxId: notice.postboxId,
      entryUrl: notice.entryUrl, read: previous ? previous.read || read : read,
    }
    if (previous && previous.title === entry.title && previous.text === entry.text && previous.read === entry.read) return
    save([entry, ...items.filter(item => item.key !== notice.key)])
  },
  markRead(key?: string): void {
    if (!items.some(item => !item.read && (key === undefined || item.key === key))) return
    save(items.map(item => key === undefined || item.key === key ? { ...item, read: true } : item))
  },
  clear(): void { save([]) },
}
