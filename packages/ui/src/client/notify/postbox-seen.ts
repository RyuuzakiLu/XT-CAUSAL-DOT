/* ================================================================
   DOT · 星邮匣「看过了」水位（postbox-seen）· 总导游图

   ◍这是什么
   ① 干什么：记住“你上次打开星邮匣是什么时候”。精灵右上角的未读角标只数
      “没读、而且比这个时间更新”的信——点进星邮匣看一眼角标就清掉，不用再一封封按「已读」。
   ② 为什么不直接把信全标已读：已读是每封信自己的阅读状态（金点），点开那一封才算；
      角标只是“有没有你还没看过的新动态”，两件事分开。
   ③ 为什么用 localStorage + window 事件：壳（client.js）和星邮匣按需块各打包一份本模块，
      模块里的变量不共享；存储 + 事件是两份之间唯一可靠的通道。
   ◍更新记录
   *更新：2026-10-30 · postbox-todo：新建（角标不再必须手动点「已读」才消）。
   ================================================================ */
import { useEffect, useState } from 'react'

export const POSTBOX_SEEN_KEY = 'dot.postbox.seenAt'
export const POSTBOX_SEEN_EVENT = 'dot:postbox-seen'

/** 上次打开星邮匣的时间（ms）；没有记录就是 0。 */
export function readPostboxSeenAt(): number {
  try {
    const value = Number(globalThis.localStorage?.getItem(POSTBOX_SEEN_KEY))
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch { return 0 }
}

/** 记下“看过了”；只往后推，不往回拨。 */
export function markPostboxSeen(at: number): void {
  if (!Number.isFinite(at) || at <= readPostboxSeenAt()) return
  try { globalThis.localStorage?.setItem(POSTBOX_SEEN_KEY, String(Math.round(at))) } catch { /* 存不下就算了，角标退回按未读数 */ }
  try { globalThis.dispatchEvent?.(new Event(POSTBOX_SEEN_EVENT)) } catch { /* 非浏览器环境 */ }
}

/** 角标数：没归档、没读、而且在上次打开星邮匣之后才有新动态的条数。 */
export function unseenLetterCount(letters: readonly { read: boolean; archived: boolean; at?: number | undefined }[], seenAt: number): number {
  return letters.filter(row => !row.archived && !row.read && (row.at ?? Number.POSITIVE_INFINITY) > seenAt).length
}

/** 订阅水位：本页或别的标签页打开星邮匣后立刻刷新。 */
export function usePostboxSeenAt(): number {
  const [seenAt, setSeenAt] = useState(readPostboxSeenAt)
  useEffect(() => {
    const sync = () => setSeenAt(readPostboxSeenAt())
    globalThis.addEventListener?.(POSTBOX_SEEN_EVENT, sync)
    globalThis.addEventListener?.('storage', sync)
    return () => { globalThis.removeEventListener?.(POSTBOX_SEEN_EVENT, sync); globalThis.removeEventListener?.('storage', sync) }
  }, [])
  return seenAt
}
