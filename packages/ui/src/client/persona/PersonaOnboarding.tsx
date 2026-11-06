/* 新账号第一次登录的引导页：给 DOT 起名、定称呼、定性别、（可选）一段自由写的人设。
   只在后端说 needsOnboarding 时出现：上线前就有的账号、本地 DOT、接口读不到时都不出现。
   写了人设就先让模型按模板扩写（不保存），第二步给用户预览，可以重写或手改，满意了再一起保存。 */
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { loadPersona, previewPersona, savePersona, type PersonaGender, type PersonaView } from './persona-api.ts'
import { BriefField, Emblem, ExpandedField, GenderField, Spinner, TextField } from './PersonaFields.tsx'
import { usePersonaStyle } from './persona-style.ts'

function Onboarding({ initial, onDone }: { initial: PersonaView; onDone(): void }) {
  const [step, setStep] = useState<'basic' | 'review'>('basic')
  const [name, setName] = useState(initial.profile.name || initial.defaults.name)
  const [userName, setUserName] = useState(initial.profile.userName)
  const [gender, setGender] = useState<PersonaGender | ''>('')
  const [brief, setBrief] = useState(initial.profile.brief)
  const [expanded, setExpanded] = useState('')
  const [previewed, setPreviewed] = useState('')
  const [busy, setBusy] = useState<'' | 'save' | 'expand' | 'finish'>('')
  const [error, setError] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const limits = initial.limits
  const shownName = name.trim() || initial.defaults.name

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !root.current) return
      const items = Array.from(root.current.querySelectorAll<HTMLElement>('button,input,textarea')).filter(node => node.offsetParent !== null)
      const first = items[0], last = items.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', trap, true)
    return () => { document.removeEventListener('keydown', trap, true); if (previous?.isConnected) previous.focus() }
  }, [])
  useEffect(() => { root.current?.scrollTo({ top: 0 }) }, [step])

  const missing = userName.trim() === '' ? '写一下它该怎么称呼你' : gender === '' ? '选一下 DOT 的性别' : ''
  const draft = () => ({ name: shownName, userName: userName.trim(), gender: gender as PersonaGender, brief: brief.trim() })

  /* dot-persona-brief-2026-10-27：写了人设就先只扩写不保存，下一步给用户看；满意了才一起存。没写人设直接保存。 */
  const submit = async () => {
    if (busy) return
    if (missing) { setError(missing); return }
    setError('')
    if (brief.trim() === '') {
      setBusy('save')
      try { await savePersona({ ...draft(), onboarding: true }); onDone() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy('') }
      return
    }
    setBusy('expand')
    try {
      const text = await previewPersona(draft())
      setExpanded(text); setPreviewed(text); setStep('review')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy('') }
  }
  const regenerate = async () => {
    if (busy) return
    if (expanded.trim() !== previewed.trim() && !window.confirm('重新扩写会盖掉你刚才的修改，确定吗？')) return
    setError(''); setBusy('expand')
    try {
      const text = await previewPersona(draft())
      setExpanded(text); setPreviewed(text)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy('') }
  }
  const finish = async () => {
    if (busy) return
    if (expanded.trim() === '') { setError('完整人格是空的，可以点“重新扩写”，或者返回改人设'); return }
    setError(''); setBusy('finish')
    try {
      await savePersona({ ...draft(), expanded: expanded.trim(), expandedFromPreview: expanded.trim() === previewed.trim(), expand: false, onboarding: true })
      onDone()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy('') }
  }

  return <div className="dotp-onboard" data-dotp="onboard" ref={root} role="dialog" aria-modal="true" aria-labelledby="dotp-title">
    <form className="dotp-card" onSubmit={event => { event.preventDefault(); void (step === 'basic' ? submit() : finish()) }}>
      <Emblem />
      <p className="dotp-kicker">XTCAUSAL DOT</p>
      <div className="dotp-steps" aria-hidden="true"><i data-on="true" /><i data-on={step === 'review'} /></div>
      {step === 'basic' ? <>
        <h1 className="dotp-title" id="dotp-title">初次见面</h1>
        <p className="dotp-sub">先给你的 DOT 定几件事。只对你这个账号生效，以后在设置里随时能改。</p>
        <TextField label="DOT 的名字" note="默认叫 ASTRA" value={name} max={limits.name} placeholder={initial.defaults.name} onChange={setName} />
        <TextField label="它该怎么称呼你" value={userName} max={limits.userName} placeholder="比如：阿龙、老板、你的名字" onChange={setUserName} autoFocus />
        <GenderField value={gender} onChange={setGender} />
        <BriefField value={brief} onChange={setBrief} />
        <p className="dotp-hint">{brief.trim() ? '下一步先让模型按你写的扩写成完整人格给你看，满意了再保存，也可以重写或者手改。' : '人设不写也行，它会用默认的性格和你聊。'}</p>
        {error && <p className="dotp-error" role="alert">{error}</p>}
        <div className="dotp-actions">
          <button type="submit" className="dotp-btn" data-primary="true" aria-disabled={busy !== ''}>{busy ? <><Spinner />{busy === 'expand' ? '正在扩写…' : '正在保存…'}</> : brief.trim() ? '预览扩写' : '保存，开始'}</button>
        </div>
      </> : <>
        <h1 className="dotp-title" id="dotp-title">这是 {shownName}</h1>
        <span className="dotp-preview-tag">预览 · 还没保存</span>
        <p className="dotp-sub">按你写的人设扩写出来的完整人格。哪里不像就直接改，或者让它重写一版；点“就这样，保存”才会生效。</p>
        <ExpandedField name={shownName} value={expanded} onChange={setExpanded} />
        {error && <p className="dotp-error" role="alert">{error}</p>}
        <div className="dotp-actions">
          <button type="button" className="dotp-btn" aria-disabled={busy !== ''} onClick={() => { if (!busy) { setError(''); setStep('basic') } }}>返回改人设</button>
          <button type="button" className="dotp-btn" aria-disabled={busy !== ''} onClick={() => void regenerate()}>{busy === 'expand' ? <><Spinner />正在重写…</> : '重新扩写'}</button>
          <button type="submit" className="dotp-btn" data-primary="true" aria-disabled={busy !== ''}>{busy === 'finish' ? <><Spinner />正在保存…</> : '就这样，保存'}</button>
        </div>
      </>}
    </form>
  </div>
}

/** 由 client/index.ts 的 ctx.effect 调用；返回卸载函数。 */
export function installPersonaOnboarding(): () => void {
  let disposed = false
  let cleanup = () => {}
  void loadPersona().then(view => {
    if (disposed || !view?.needsOnboarding) return
    const releaseStyle = usePersonaStyle()
    const host = document.createElement('div')
    host.setAttribute('data-dot-persona-onboarding', '')
    document.body.appendChild(host)
    const reactRoot = createRoot(host)
    let closed = false
    const close = () => {
      if (closed) return
      closed = true
      reactRoot.unmount(); host.remove(); releaseStyle()
    }
    cleanup = close
    reactRoot.render(<Onboarding initial={view} onDone={close} />)
  }).catch(() => { /* 本地 DOT 或接口暂不可用：不弹引导，不挡住使用 */ })
  return () => { disposed = true; cleanup() }
}
