/* ================================================================
   房间占位与失败重试 · 总导游图
   ▍这是什么
   分块还没到 / 取块失败时，房间位置显示的东西。它只负责"告诉你正在搬、搬失败可重来"，
   不冒充房间内容，也不挡导航与精灵。
   ▍为什么用行内样式
   这段占位要在任何房间 CSS 都还没到、甚至模块样式本身失败时也能看清，
   所以不引用任何 CSS Module 类名，避免"有类名没规则"时变成整块透明。
   ▍修改铁律
   1. 【不】无限转圈：超过等待阈值就显示"仍在加载 + 重试"，给用户出口。
   2. 失败必须同时给「重试」和「回书房」两个出口；回书房走既有 navigate，不新建路由。
   ▍更新记录
   2026-10-25 · 建立：按需块占位、慢网提示与两条回退出口。
   ================================================================ */
import { useEffect, useState, type CSSProperties } from 'react'

export interface ChunkFrameProps {
  /** 房间给人看的名字，例如「工作」。 */
  readonly label: string
  /** 取块失败原因；null 表示还在取。 */
  readonly error: Error | null
  /** 重试入口。 */
  readonly retry: () => void
  /** 回退出口（通常是回书房）。 */
  readonly fallback: () => void
  /** 覆盖层形态：设置/精灵块失败时不顶掉底下房间。 */
  readonly overlay?: boolean
}

/** 转圈多久之后开始显示"仍在加载"，避免慢网看起来像卡死。 */
const SLOW_MS = 4000

const box = (overlay: boolean | undefined): CSSProperties => ({
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  minHeight: overlay ? undefined : 200,
  padding: overlay ? '18px 20px' : '48px 24px',
  color: '#f3e3c3',
  background: overlay ? 'rgba(8, 14, 26, .92)' : 'transparent',
  border: overlay ? '1px solid rgba(214, 178, 108, .45)' : 'none',
  borderRadius: overlay ? 14 : 0,
  position: overlay ? 'fixed' : undefined,
  left: overlay ? '50%' : undefined,
  bottom: overlay ? 24 : undefined,
  transform: overlay ? 'translateX(-50%)' : undefined,
  maxWidth: overlay ? 420 : undefined,
  zIndex: overlay ? 40 : undefined,
  textAlign: 'center',
  font: '14px/1.7 system-ui, sans-serif',
})

const button: CSSProperties = {
  padding: '8px 16px',
  borderRadius: 999,
  border: '1px solid rgba(214, 178, 108, .7)',
  background: 'rgba(214, 178, 108, .12)',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
}

export function ChunkFrame({ label, error, retry, fallback, overlay }: ChunkFrameProps) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (error) return
    const timer = setTimeout(() => setSlow(true), SLOW_MS)
    return () => clearTimeout(timer)
  }, [error])
  if (error) {
    return <section role="alert" data-chunk-error="" style={box(overlay)}>
      <p style={{ margin: 0 }}>{label}没有加载成功：{error.message}</p>
      <p style={{ margin: 0, opacity: .8 }}>其他房间和已保存的草稿都还在，可以重试，也可以先回书房。</p>
      <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button type="button" style={button} onClick={retry}>重新加载{label}</button>
        <button type="button" style={button} onClick={fallback}>{overlay ? '先关掉' : '回书房'}</button>
      </span>
    </section>
  }
  return <section role="status" data-chunk-loading="" aria-busy="true" style={box(overlay)}>
    <p style={{ margin: 0 }}>正在准备{label}…</p>
    {slow && <>
      <p style={{ margin: 0, opacity: .8 }}>网络有点慢，还在取这一间的素材。</p>
      <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button type="button" style={button} onClick={retry}>重新加载{label}</button>
        <button type="button" style={button} onClick={fallback}>{overlay ? '先关掉' : '先回书房'}</button>
      </span>
    </>}
  </section>
}
