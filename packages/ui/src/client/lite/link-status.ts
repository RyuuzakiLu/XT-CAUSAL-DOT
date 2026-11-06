/* ================================================================
   简洁版顶栏 · 连接状态灯（2026-11-01 Hark 设计稿修正轮，用户定：在线 / 连接中 / 未连接 三态）
   ▍数据从哪来（不是假值）
   index.ts 把原生连接服务（@deepseek-ai/dsh-client-connection，ctx.connection）的两样东西写进 DataSnapshot：
     connected = connection.generation 有值（WebSocket 推送通道已就绪）
     link      = connection.state：'connected' | 'connecting' | 'disconnected'（还没出第一次结果时按 connecting）
   ▍三态怎么判
   · 推送通道就绪 → 在线（绿）
   · 原生判 disconnected（浏览器报离线，原生暂停重连）→ 未连接（红）
   · 原生在重连（connecting）：先显示连接中（黄）；连续 LINK_GRACE_MS 还没连上 → 未连接（红），原生仍在后台重试，
     连上就回到在线。原生断线后会一直以 connecting 退避重试，不加这个时限，服务真挂了也只会永远显示黄色。
   ▍颜色（WCAG 1.4.11 非文字对比 ≥ 3:1；状态同时有文字，不只靠颜色）
     浅色（底 #F8F9FC）：在线 #079455（3.7）· 连接中 #D97706（3.0）· 未连接 #D92D20（4.6，01 色卡红）
     深色（底 #0E1018）：在线 #32D583（9.9）· 连接中 #FDB022（10.3）· 未连接 #F97066（6.8，01 色卡红）
   ================================================================ */
import { useEffect, useRef, useState } from 'react'

export type LinkState = 'connected' | 'connecting' | 'disconnected'
export type LinkLevel = 'online' | 'connecting' | 'offline'

/** 连续重连多久还没成功就改报「未连接」。 */
export const LINK_GRACE_MS = 15_000

export const LINK_LABEL: Record<LinkLevel, string> = { online: '在线', connecting: '连接中', offline: '未连接' }

export const LINK_COLORS = {
  light: { online: '#079455', connecting: '#D97706', offline: '#D92D20' },
  dark: { online: '#32D583', connecting: '#FDB022', offline: '#F97066' },
} as const

/** 纯判定，便于单测。connectingSince = 这一轮「没连上」从什么时候开始（连上时为 null）。 */
export function linkLevel(input: { connected: boolean; link?: LinkState | undefined; connectingSince: number | null; now: number }): LinkLevel {
  if (input.connected) return 'online'
  if (input.link === 'disconnected') return 'offline'
  if (input.connectingSince !== null && input.now - input.connectingSince >= LINK_GRACE_MS) return 'offline'
  return 'connecting'
}

/** 顶栏用：跟着原生连接状态走；重连超过时限自己翻成「未连接」（到点重算一次，不轮询）。 */
export function useLinkLevel(connected: boolean, link: LinkState | undefined, clock: () => number = Date.now): LinkLevel {
  const since = useRef<number | null>(connected ? null : clock())
  if (connected) since.current = null
  else if (since.current === null) since.current = clock()
  const [, tick] = useState(0)
  useEffect(() => {
    if (connected || link === 'disconnected' || since.current === null) return
    const left = LINK_GRACE_MS - (clock() - since.current)
    if (left <= 0) return
    const timer = setTimeout(() => tick(n => n + 1), left + 50)
    return () => clearTimeout(timer)
  }, [connected, link])
  return linkLevel({ connected, link, connectingSince: since.current, now: clock() })
}
