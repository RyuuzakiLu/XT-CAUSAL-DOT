/* 设置中心「人格与称呼」分组：随时改 DOT 的名字、对用户的称呼、性别和人格。
   人设是一个自由写的输入框（dot-persona-brief-2026-10-27）：先预览扩写，满意了（可重写、可手改）再保存；扩写结果在下面直接可改。
   css 由 SettingsOverlay 传入，沿用设置中心的 cSection/cGlass/cHint 等玻璃卡样式。 */
import { useEffect, useState } from 'react'
import { loadPersona, previewPersona, savePersona, type PersonaGender, type PersonaView } from './persona-api.ts'
import { BriefField, ExpandedField, GenderField, Spinner, TextField } from './PersonaFields.tsx'
import { usePersonaStyle } from './persona-style.ts'

type Css = Record<string, string>

export function PersonaSettings({ css }: { css: Css }) {
  useEffect(() => usePersonaStyle(), [])
  const [view, setView] = useState<PersonaView | null>(null)
  const [loadError, setLoadError] = useState('')
  const [name, setName] = useState('')
  const [userName, setUserName] = useState('')
  const [gender, setGender] = useState<PersonaGender>('unset')
  const [brief, setBrief] = useState('')
  const [expanded, setExpanded] = useState('')
  const [busy, setBusy] = useState<'' | 'basic' | 'expand' | 'text'>('')
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [previewBase, setPreviewBase] = useState('')
  const [previewFor, setPreviewFor] = useState('')

  const adopt = (next: PersonaView) => {
    setView(next)
    setName(next.profile.name); setUserName(next.profile.userName); setGender(next.profile.gender)
    setBrief(next.profile.brief); setExpanded(next.profile.expanded)
    setPreview(null)
  }
  useEffect(() => { loadPersona().then(adopt).catch(cause => setLoadError(cause instanceof Error ? cause.message : String(cause))) }, [])

  if (loadError) return <p className={css.cHint}>人格设定只在云端 DOT 里可用，这里暂时读不到：{loadError}</p>
  if (!view) return <p className={css.cHint}><Spinner /> 正在读取…</p>

  const p = view.profile
  const basicDirty = name.trim() !== p.name || userName.trim() !== p.userName || gender !== p.gender
  const briefDirty = brief.trim() !== p.brief
  const textDirty = expanded.trim() !== p.expanded
  const run = async (kind: 'basic' | 'expand' | 'text', patch: Parameters<typeof savePersona>[0], done: string) => {
    if (busy) return
    setBusy(kind); setError(''); setOk('')
    try {
      const next = await savePersona(patch)
      adopt(next)
      if (next.expandError) setError(next.expandError)
      else setOk(done)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy('') }
  }
  const shownName = name.trim() || view.defaults.name
  const askPreview = async () => {
    if (busy) return
    if (preview !== null && preview.trim() !== previewBase.trim() && !window.confirm('重新扩写会盖掉你对预览的修改，确定吗？')) return
    const text = brief.trim()
    setBusy('expand'); setError(''); setOk('')
    try {
      const out = await previewPersona({ name: shownName, userName: userName.trim(), gender, brief: text })
      setPreview(out); setPreviewBase(out); setPreviewFor(text)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy('') }
  }
  const savePreview = () => preview !== null && preview.trim() !== '' && void run('text', { name: shownName, userName: userName.trim(), gender, brief: previewFor, expanded: preview.trim(), expandedFromPreview: preview.trim() === previewBase.trim(), expand: false }, '已保存这一版人格，下一句回复起生效。')

  return <div data-dotp="settings">
    <section className={css.cSection}><h2 className={css.cCaption}>名字与称呼</h2><div className={css.cGlass}>
      <TextField label="DOT 的名字" note="默认叫 ASTRA" value={name} max={view.limits.name} placeholder={view.defaults.name} onChange={setName} />
      <TextField label="它怎么称呼你" note={userName.trim() ? undefined : '不填就叫“你”'} value={userName} max={view.limits.userName} placeholder="比如：阿龙、老板" onChange={setUserName} />
      <GenderField value={gender} onChange={setGender} />
    </div></section>
    <div className="dotp-actions"><button type="button" className="dotp-btn" data-primary={basicDirty} aria-disabled={busy !== '' || !basicDirty} onClick={() => basicDirty && void run('basic', { name: shownName, userName: userName.trim(), gender }, '已保存，下一句回复起生效。')}>{busy === 'basic' ? <><Spinner />保存中…</> : '保存'}</button></div>

    <section className={css.cSection}><h2 className={css.cCaption}>人设</h2><div className={css.cGlass}>
      <BriefField label="人设" note="想写什么写什么" value={brief} onChange={setBrief} />
    </div></section>
    {preview === null && <div className="dotp-actions">
      {brief.trim() !== '' && <button type="button" className="dotp-btn" data-primary={briefDirty} aria-disabled={busy !== ''} onClick={() => void askPreview()}>{busy === 'expand' ? <><Spinner />扩写中…</> : briefDirty ? '预览扩写' : '重新扩写'}</button>}
      {brief.trim() === '' && <button type="button" className="dotp-btn" data-primary={briefDirty} aria-disabled={busy !== '' || !briefDirty} onClick={() => briefDirty && void run('expand', { brief: '' }, '已清空人设，恢复默认性格。')}>{busy === 'expand' ? <><Spinner />保存中…</> : '保存'}</button>}
    </div>}
    {preview === null && briefDirty && brief.trim() !== '' && <p className={css.cHint}>改了人设要先点“预览扩写”看一眼，满意了再保存。</p>}

    {preview !== null && <>
      <section className={css.cSection}><h2 className={css.cCaption}>扩写预览 · 还没保存</h2><div className={css.cGlass}>
        <ExpandedField name={shownName} note="满意了再保存，也可以直接改" value={preview} onChange={setPreview} />
        {brief.trim() !== previewFor && <p className="dotp-thin">上面的人设在预览之后又改过了，点“重新扩写”按新的来；直接保存的话，存的是预览时的人设。</p>}
      </div></section>
      <div className="dotp-actions">
        <button type="button" className="dotp-btn" aria-disabled={busy !== ''} onClick={() => { if (!busy) { setPreview(null); setError('') } }}>不要这版</button>
        <button type="button" className="dotp-btn" aria-disabled={busy !== ''} onClick={() => void askPreview()}>{busy === 'expand' ? <><Spinner />扩写中…</> : '重新扩写'}</button>
        <button type="button" className="dotp-btn" data-primary="true" aria-disabled={busy !== '' || preview.trim() === ''} onClick={savePreview}>{busy === 'text' ? <><Spinner />保存中…</> : '保存这一版'}</button>
      </div>
    </>}

    {preview === null && p.expanded !== '' && <>
      <section className={css.cSection}><h2 className={css.cCaption}>现在用的完整人格</h2><div className={css.cGlass}>
        <ExpandedField name={shownName} value={expanded} onChange={setExpanded} />
      </div></section>
      <div className="dotp-actions">
        {textDirty && <button type="button" className="dotp-btn" aria-disabled={busy !== ''} onClick={() => setExpanded(p.expanded)}>撤销修改</button>}
        <button type="button" className="dotp-btn" data-primary={textDirty} aria-disabled={busy !== '' || !textDirty} onClick={() => textDirty && void run('text', { expanded: expanded.trim() }, '修改已保存，下一句回复起生效。')}>{busy === 'text' ? <><Spinner />保存中…</> : '保存修改'}</button>
      </div>
    </>}

    {error && <p className="dotp-error" role="alert">{error}</p>}
    {ok && <p className={css.cHint} role="status"><span className="dotp-ok">{ok}</span></p>}
    <p className={css.cHint}>这些只对你这个账号生效。人设写好后先预览扩写，满意了再保存；完整人格可以直接改，{p.expandedEdited ? '现在用的是你改过的版本。' : '改完点“保存修改”就会用新的。'}</p>
  </div>
}
