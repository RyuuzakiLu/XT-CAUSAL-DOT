/* ================================================================
   DOT 工作卡 · React 订阅入口
   ▍修改铁律
   1. 只用 useSyncExternalStore 读全局状态；组件里【不】各自拉接口。
   2. 没有 store（截图环境、旧测试）时返回空快照，调用方退回旧数据。
   ▍更新记录
   *更新：2026-10-24 · 建立*
================================================================ */
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { WorkCardStore, WorkCardsSnapshot } from './work-card-store.ts'

const EMPTY: WorkCardsSnapshot = { cards: {}, order: [], source: 'idle', notices: [], syncedAt: null, error: null }
const noSubscribe = () => () => {}
const emptySnapshot = () => EMPTY

export function useWorkCards(store: WorkCardStore | undefined): WorkCardsSnapshot {
  return useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.getSnapshot ?? emptySnapshot, store?.getSnapshot ?? emptySnapshot)
}

/** “3 分钟前”会自己走：每 30 秒刷新一次当前时间。 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(handle)
  }, [intervalMs])
  return now
}
