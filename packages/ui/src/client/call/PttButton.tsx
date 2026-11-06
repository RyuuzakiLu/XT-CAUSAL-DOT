/* ================================================================
   按键说话按钮（对话输入栏）
   按住说、松开发；或者点一下开始、再点一下发。识别出的文字带“〔语音〕”发进当前对话，
   DOT 照常出字，同时边生成边念。DOT 正在念或正在想时再按，直接打断、不弹确认。
   *更新：2026-10-27 · 新建*
================================================================ */
import { useRef, useSyncExternalStore, type PointerEvent } from 'react'
import { currentCallEngine, type CallSnapshot } from './engine.ts'

const TAP_MS = 350
const noSub = () => () => {}
const noSnap = () => undefined

export function PttButton() {
  const engine = currentCallEngine()
  const snap: CallSnapshot | undefined = useSyncExternalStore(engine ? engine.subscribe : noSub, engine ? engine.getSnapshot : noSnap)
  const pressAt = useRef(0)
  const latched = useRef(false)
  if (!engine || !snap) return null
  if (snap.mode === 'call' && snap.phase !== 'idle') return null // 打电话时不用按键
  const ptt = snap.mode === 'ptt' && snap.phase !== 'idle'
  const recording = ptt && engine.recording
  const busy = ptt && !recording && (snap.phase === 'thinking' || snap.phase === 'connecting')
  const speaking = ptt && !recording && snap.phase === 'speaking'
  const label = recording ? '松开发送（点一下也可以）' : speaking ? '正在朗读，按住插话' : busy ? 'DOT 正在想，按住插话' : '按住说话，DOT 会念出回复'

  const down = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* 有些浏览器不支持 */ }
    if (latched.current) { latched.current = false; engine.pttUp(); return } // 点一下模式的第二下：发送
    pressAt.current = Date.now()
    void engine.pttDown()
  }
  const up = () => {
    if (!pressAt.current) return
    const held = Date.now() - pressAt.current
    pressAt.current = 0
    if (held < TAP_MS) { latched.current = true; return } // 很快松开：当作“点一下开始”，继续录
    engine.pttUp()
  }

  return (
    <button type="button" data-dot-ptt={recording ? 'recording' : speaking ? 'speaking' : busy ? 'thinking' : 'idle'} aria-label={label} title={label}
      onPointerDown={down} onPointerUp={up} onPointerCancel={up} onContextMenu={event => event.preventDefault()}
      style={{
        touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none',
        ...(recording ? { color: '#fff', background: 'radial-gradient(circle at 35% 25%, #e0675a, #a3302a)', boxShadow: '0 0 0 3px #e0675a40, 0 0 14px #e0675a80' } : {}),
        ...(speaking ? { color: '#10192c', background: '#f1d9a6' } : {}),
      }}>
      {speaking ? <SpeakerGlyph /> : <TalkGlyph active={recording} />}
    </button>
  )
}

function TalkGlyph({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="8.5" y="3" width="7" height="11" rx="3.5" fill={active ? 'currentColor' : 'none'} />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
      <path d="M2.6 8.2v5.6M21.4 8.2v5.6" opacity=".7" />
    </svg>
  )
}

function SpeakerGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </svg>
  )
}
