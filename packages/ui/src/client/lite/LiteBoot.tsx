import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { consumeLoginBoot } from './login-boot.ts'
import css from './lite.module.css'

/** Login-only decoration. The real shell keeps loading behind it; failures never block access. */
export function LiteBoot({ ready, reducedMotion, onStart }: { ready: boolean; reducedMotion: boolean; onStart?(): void }): ReactElement | null {
  const [active, setActive] = useState(false)
  const [finalFrame, setFinalFrame] = useState(false)
  const [finished, setFinished] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [systemReduced, setSystemReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  const checked = useRef(false)
  const video = useRef<HTMLVideoElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const still = reducedMotion || systemReduced

  // Effect (not a state initializer) so React StrictMode's double render cannot eat the hint.
  useLayoutEffect(() => {
    if (checked.current) return
    checked.current = true
    if (window.__dotLoginBoot) {
      if (window.__dotLoginBoot.claim()) onStart?.()
      return
    }
    const pending = consumeLoginBoot()
    setActive(pending)
    if (pending) onStart?.()
  }, [])
  useEffect(() => { window.__dotLoginBoot?.update(ready, still) }, [ready, still])
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)')
    const changed = () => setSystemReduced(query.matches)
    query.addEventListener('change', changed)
    return () => query.removeEventListener('change', changed)
  }, [])
  useEffect(() => {
    if (!active) return
    const previous = document.activeElement
    button.current?.focus({ preventScroll: true })
    // Independent of media events and readiness: network/media errors must not trap the app.
    const watchdog = setTimeout(() => setLeaving(true), 10_000)
    const hideOnHistory = () => { setActive(false) }
    window.addEventListener('pagehide', hideOnHistory)
    return () => {
      clearTimeout(watchdog)
      window.removeEventListener('pagehide', hideOnHistory)
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
    }
  }, [active])
  useEffect(() => {
    if (!active || !still) return
    const media = video.current
    media?.pause()
    if (media && Number.isFinite(media.duration)) media.currentTime = Math.max(0, media.duration - .05)
    setFinalFrame(true)
    const timer = setTimeout(() => setFinished(true), 600)
    return () => clearTimeout(timer)
  }, [active, still])
  useEffect(() => {
    if (!active || still) return
    const element = video.current
    if (!element) return
    // A rejected autoplay promise (including Safari restrictions) uses the static ending instead.
    void element.play()?.catch(() => { setFinalFrame(true); setFinished(true) })
    return () => { element.pause() }
  }, [active, still])
  useEffect(() => { if (active && finished && ready) setLeaving(true) }, [active, finished, ready])
  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => setActive(false), still ? 0 : 280)
    return () => clearTimeout(timer)
  }, [leaving, still])

  if (!active) return null
  return <button type="button" ref={button} className={css.loginBoot}
    data-final={finalFrame || still} data-leaving={leaving} data-still={still}
    aria-label="正在进入你的空间，点击跳过启动动画" onClick={() => setLeaving(true)}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); setLeaving(true) }
      if (event.key === 'Tab') event.preventDefault()
    }}>
    <video ref={video} className={css.loginBootVideo} src="/_dot/assets/boot.mp4"
      muted playsInline preload="auto" aria-hidden="true" tabIndex={-1}
      onLoadedMetadata={event => {
        if (still && Number.isFinite(event.currentTarget.duration)) {
          // Seek without playing: reduced motion shows only the existing video's final frame.
          event.currentTarget.currentTime = Math.max(0, event.currentTarget.duration - .05)
        }
      }}
      onTimeUpdate={event => {
        const media = event.currentTarget
        if (media.currentTime >= (Number.isFinite(media.duration) ? media.duration : 5) - .6) setFinalFrame(true)
      }}
      onEnded={() => { setFinalFrame(true); setFinished(true) }}
      onError={() => { setFinalFrame(true); setFinished(true) }} />
    <span className={css.loginBootEnd} aria-hidden="true">
      <img src="/_dot/assets/dot-logo-dark.webp" alt="" />
      <strong>XT CAUSAL DOT</strong>
      <span>正在进入你的空间…</span>
      <i className={css.loginBootProgress} />
    </span>
    <span className={css.loginBootSkip} aria-hidden="true">点击跳过</span>
  </button>
}
