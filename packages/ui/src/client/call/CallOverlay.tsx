/* ================================================================
   DOT 打电话 · 通话界面（微信语音通话式）
   ▍这是什么
   打电话时盖在整个 DOT 上的通话层，默认全屏：深色模糊底、顶部 logo、
   中间头像（随声音起伏的光圈）+ 名字 + 通话时长/状态，下面字幕，
   最下面三个大按钮：静音、挂断、小窗。左上角也能缩小。
   缩小后变成可拖动的悬浮小窗，松手吸附到左/右边，点一下回到全屏，电话照打。
   ▍铁律
   开车用：接通后不需要再碰任何按钮；按钮只用来挂断和静音，做得足够大。
   *更新：2026-10-27 · 新建*
   *更新：2026-11-03 · 改微信式全屏 + 悬浮小窗，顶部加 logo*
================================================================ */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import css, { cssText } from './call.module.css'
import { ensureChunkStyle } from '../chunks/styles.ts'
/* 2026-11-03：CSS Module 只导出文本不自动挂，之前通话层一直是无样式的文档流；这里自己挂上。 */
ensureChunkStyle('dot-call', cssText)
import type { CallEngine, CallPhase } from './engine.ts'
import { astra_avatar_small } from '../home-assets/astra_avatar_small.ts'
import { PhoneGlyph } from './PhoneGlyph.tsx'

export { PhoneGlyph }

const LOGO = '/_dot/assets/dot-logo-dark.webp?v=20261101'
const NAME = 'ASTRA'

const PHASE_TEXT: Record<CallPhase, string> = {
  idle: '', connecting: '正在接通…', listening: '在听，说吧', hearing: '正在听你说…', thinking: '在想…',
  speaking: '正在说（直接开口就能打断）', reconnecting: '网络断了一下，正在重连…', error: '电话中断了', ended: '已挂断',
}
const MINI_TEXT: Partial<Record<CallPhase, string>> = { connecting: '接通中', reconnecting: '重连中', thinking: '在想', speaking: '在说', hearing: '在听' }

function MicGlyph({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  )
}

function HangGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true" fill="currentColor">
      <path d="M12 9.2c-3.3 0-6.3 1-8.4 2.7-.6.5-.7 1.3-.3 2l1.2 1.9c.4.6 1.2.8 1.9.5l2.3-1c.6-.3.9-.9.8-1.5l-.2-1.6a12 12 0 0 1 5.4 0l-.2 1.6c-.1.6.2 1.2.8 1.5l2.3 1c.7.3 1.5.1 1.9-.5l1.2-1.9c.4-.7.3-1.5-.3-2-2.1-1.7-5.1-2.7-8.4-2.7z" />
    </svg>
  )
}

/** 微信式“缩小”：两个向内的箭头 */
function ShrinkGlyph({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 4v6H4" /><path d="M10 10L4 4" />
      <path d="M14 20v-6h6" /><path d="M14 14l6 6" />
    </svg>
  )
}

function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

const MINI_W = 84, MINI_H = 108, EDGE = 10

function clampMini(x: number, y: number) {
  const w = window.innerWidth, h = window.innerHeight
  return { x: Math.min(Math.max(EDGE, x), w - MINI_W - EDGE), y: Math.min(Math.max(EDGE + 30, y), h - MINI_H - EDGE - 30) }
}

export function CallOverlay({ engine }: { engine: CallEngine }) {
  const snap = useSyncExternalStore(engine.subscribe, engine.getSnapshot)
  const [folded, setFolded] = useState(false)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ id: number; dx: number; dy: number; sx: number; sy: number; moved: boolean } | null>(null)
  const ring = useRef<HTMLDivElement>(null)
  const miniRing = useRef<HTMLSpanElement>(null)
  const visible = snap.phase !== 'idle' && snap.mode === 'call'

  useEffect(() => {
    if (!visible) { setFolded(false); setVoiceOpen(false); return }
    const timer = setInterval(() => setNow(Date.now()), 1000)
    let raf = 0
    const tick = () => {
      const level = Math.min(1, engine.getLevel() * 9).toFixed(3)
      ring.current?.style.setProperty('--level', level)
      miniRing.current?.style.setProperty('--level', level)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { clearInterval(timer); cancelAnimationFrame(raf) }
  }, [visible, engine])

  // 通话中保持屏幕常亮（浏览器支持时）；安卓壳里由原生前台服务负责
  useEffect(() => {
    if (!visible || !engine.active) return
    let lock: { release(): Promise<void> } | undefined
    const nav = navigator as unknown as { wakeLock?: { request(kind: 'screen'): Promise<{ release(): Promise<void> }> } }
    nav.wakeLock?.request('screen').then(l => { lock = l }, () => {})
    return () => { void lock?.release().catch(() => {}) }
  }, [visible, engine, snap.phase === 'error' || snap.phase === 'ended'])

  // 窗口大小变了（转屏、折叠屏）把小窗拉回屏内
  useEffect(() => {
    if (!folded) return
    const fit = () => setPos(p => (p ? clampMini(p.x, p.y) : p))
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [folded])

  if (!visible) return null
  const live = engine.active
  const status = snap.muted && live ? '已静音，对方听不到你' : PHASE_TEXT[snap.phase]
  const elapsed = snap.startedAt ? clock(now - snap.startedAt) : '00:00'

  const shrink = () => { setVoiceOpen(false); setFolded(true); setPos(p => p ?? clampMini(window.innerWidth - MINI_W - EDGE, 96)) }

  if (folded && live) {
    const p = pos ?? clampMini(window.innerWidth - MINI_W - EDGE, 96)
    const onDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
      drag.current = { id: e.pointerId, dx: e.clientX - p.x, dy: e.clientY - p.y, sx: e.clientX, sy: e.clientY, moved: false }
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    const onMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
      const d = drag.current
      if (!d || d.id !== e.pointerId) return
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 6) return
      if (!d.moved) { d.moved = true; setDragging(true) }
      setPos(clampMini(e.clientX - d.dx, e.clientY - d.dy))
    }
    const onUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
      const d = drag.current
      if (!d || d.id !== e.pointerId) return
      drag.current = null
      setDragging(false)
      if (!d.moved) { setFolded(false); return }
      // 松手吸边：离哪边近贴哪边
      setPos(cur => {
        const c = cur ?? p
        const left = c.x + MINI_W / 2 < window.innerWidth / 2
        return clampMini(left ? EDGE : window.innerWidth - MINI_W - EDGE, c.y)
      })
    }
    return (
      <button type="button" className={css.mini} data-phase={snap.phase} data-dragging={dragging || undefined}
        style={{ left: p.x, top: p.y }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        aria-label={`通话中 ${elapsed}，点一下回到通话界面`}>
        <span ref={miniRing} className={css.miniAvatar} data-muted={snap.muted || undefined}>
          <img src={astra_avatar_small} alt="" draggable={false} />
        </span>
        <span className={css.miniPhone}><PhoneGlyph size={13} /></span>
        <span className={css.miniTime}>{MINI_TEXT[snap.phase] && snap.phase !== 'listening' ? MINI_TEXT[snap.phase] : elapsed}</span>
      </button>
    )
  }

  return (
    <div className={css.overlay} data-phase={snap.phase} role="dialog" aria-label="语音通话">
      <div className={css.backdrop} style={{ backgroundImage: `url(${astra_avatar_small})` }} aria-hidden="true" />
      <header className={css.top}>
        {live ? (
          <button type="button" className={css.shrink} onClick={shrink} aria-label="缩小成小窗"><ShrinkGlyph /></button>
        ) : <span className={css.shrinkSpacer} />}
        <div className={css.brand}>
          <img src={LOGO} alt="" draggable={false} />
          <span>XT CAUSAL DOT</span>
        </div>
        <div className={css.voiceBox}>
          <button type="button" className={css.voiceChip} onClick={() => setVoiceOpen(v => !v)} aria-expanded={voiceOpen} aria-label={`声音：${snap.voice}`}>{snap.voice}</button>
          {voiceOpen && (
            <div className={css.voiceMenu} role="menu">
              {snap.voices.map(v => (
                <button key={v} type="button" role="menuitemradio" aria-checked={v === snap.voice} className={css.voiceItem} data-on={v === snap.voice || undefined}
                  onClick={() => { engine.setVoice(v); setVoiceOpen(false); if (live) engine.previewVoice() }}>{v}</button>
              ))}
              <span className={css.voiceHint}>选一个，会用它说一句试听</span>
            </div>
          )}
        </div>
      </header>

      <main className={css.stage}>
        <div ref={ring} className={css.who} data-phase={snap.phase} data-muted={snap.muted || undefined}>
          <span className={css.pulse} />
          <img className={css.avatar} src={astra_avatar_small} alt="" draggable={false} />
        </div>
        <h2 className={css.name}>{NAME}</h2>
        <p className={css.time}>{live && snap.startedAt ? elapsed : ''}</p>
        <p className={css.status} aria-live="polite">{status}</p>
        <div className={css.captions}>
          {snap.you && <p className={css.you}><span>你</span>{snap.you}</p>}
          {snap.dot && <p className={css.dot}><span>{NAME}</span>{snap.dot}</p>}
          {snap.error && <p className={css.error}>{snap.error}</p>}
          {!snap.error && snap.notice && <p className={css.notice}>{snap.notice}</p>}
        </div>
      </main>

      <footer className={css.controls}>
        {live ? (
          <>
            <button type="button" className={css.side} data-on={snap.muted || undefined} onClick={() => engine.toggleMute()} aria-label={snap.muted ? '取消静音' : '静音'}>
              <MicGlyph off={snap.muted} /><em>{snap.muted ? '麦克风已关' : '麦克风已开'}</em>
            </button>
            <button type="button" className={css.hang} onClick={() => engine.hangup()} aria-label="挂断"><HangGlyph /><em>挂断</em></button>
            <button type="button" className={css.side} onClick={shrink} aria-label="缩小成小窗"><ShrinkGlyph size={28} /><em>小窗</em></button>
          </>
        ) : snap.phase === 'error' ? (
          <>
            <button type="button" className={css.side} onClick={() => engine.dismiss()} aria-label="关闭"><ShrinkGlyph size={28} /><em>关闭</em></button>
            <button type="button" className={css.redial} onClick={() => void engine.start()} aria-label="重新拨打"><PhoneGlyph size={30} /><em>重新拨打</em></button>
          </>
        ) : null}
      </footer>
    </div>
  )
}
