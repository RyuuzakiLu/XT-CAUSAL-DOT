/* ================================================================
   个人 DOT 设置覆盖层 · 总导游图
   ▍这是什么
   本人手机/电脑的快捷与完整设置；React 消费同一设备偏好和原生提醒状态。
   ▍结构
   焦点/遮罩契约 → 通用控件 → 六组设置 → 原生配置内层。
   ▍修改铁律
   1. 【不】替换 main 场景，覆盖层关闭后草稿与轮播必须还在。
   2. 【不】渲染精灵隐藏、账号或假健康值；菜单入口必须可找回。
   3. 服务保存成功才显示回执；自有API表单复用原生配置/凭据服务，插件设置不复制。
   ▍更新记录
   *更新：2026-10-24 · 个人版共享设置与能力原生配置覆盖层*
   *更新：2026-10-24 · 快捷设置换成底座原画面板（QuickPanel），控件仍是同一份本机偏好与免打扰接口*
   *更新：2026-10-24 · 设置中心（一级分组页与六个二级页）换成 settings_bg 书房背景 + 横条底座 + 分组图标；二级页控件统一为金色自绘控件，接线不变*
   *更新：2026-10-26 · API改自有表单，插件保留原配置，撤其他原生设置入口*
================================================================ */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { DotProps } from './DotShell.tsx'
import { DEFAULT_PERSONAL, type PersonalPreferences } from './personal-settings.ts'
import { settingsCenterBackground, settingsCenterBanner, settingsCenterIcons, type SettingsCenterIconKey } from './settings-center-art.ts'
import { quickPanelArt } from './quick-settings-art.ts'
import { ArtSlot } from './visuals.tsx'
import { ApiSettingsPanel } from './ApiSettingsPanel.tsx'
import { useChunk } from './chunks/use-chunk.ts'
import css from './settings.module.css'
import { PersonaSettings } from './persona/PersonaSettings.tsx' // dot-persona-2026-10-27

/* 只有在遮罩上完成整次点击才关闭，拖动滑杆到外面松手不会误关或穿透。 */
export function SettingsOverlay(props: DotProps) {
  /* 浮层里的 ASTRA 入口用坐姿图，在 client.art.js；打开设置才取，没到前显示占位。 */
  useChunk('art')
  const view = props.useStore(value => value)
  const data = props.useDotData(value => value)
  const settings = props.personalSettings!
  const local = useSyncExternalStore(settings.subscribe, settings.getSnapshot)
  const panel = useRef<HTMLElement>(null)
  const pressed = useRef(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [until, setUntil] = useState(() => { const end = new Date(); end.setMinutes(0, 0, 0); end.setHours(end.getHours() + 2); return end.getTime() })
  const [diagOpen, setDiagOpen] = useState(false)
  const [permission, setPermission] = useState(typeof Notification === 'undefined' ? '当前环境未提供浏览器通知权限查询' : Notification.permission)
  const page = view.settings
  /* 完整设置首页=参考图的分组列表；进组只是本地层级，不改原生返回栈。 */
  const [group, setGroup] = useState<string | null>(null)
  useEffect(() => { if (page !== 'full') setGroup(null) }, [page])
  /* 进组/返回后把焦点放到新页面的返回键，键盘与读屏不会落在已卸载的按钮上。 */
  const firstGroupRender = useRef(true)
  useEffect(() => { if (firstGroupRender.current) { firstGroupRender.current = false; return } panel.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }) }, [group])
  const groupRef = useRef(group); groupRef.current = group
  const edge = local.value.spriteEdge ?? 'right'
  useEffect(() => {
    const root = panel.current
    const previous = document.activeElement as HTMLElement | null
    const siblings = Array.from(root?.parentElement?.children ?? []).filter(node => node !== root) as HTMLElement[]
    const old = siblings.map(node => node.inert)
    siblings.forEach(node => { node.inert = true })
    root?.querySelector<HTMLButtonElement>('button')?.focus()
    const keyboard = (event: KeyboardEvent) => {
      if (props.nativeSettingsOpen?.()) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (groupRef.current) setGroup(null); else props.actions.back(); return }
      if (event.key !== 'Tab') return
      const items = Array.from(root?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea,a[href]') ?? []).filter(node => node.offsetParent !== null)
      const first = items[0], last = items.at(-1)
      if (event.shiftKey && (document.activeElement === first || !root?.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !root?.contains(document.activeElement))) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keyboard, true)
    return () => { document.removeEventListener('keydown', keyboard, true); siblings.forEach((node, i) => { node.inert = old[i] ?? false }); if (previous?.isConnected) previous.focus() }
  }, [page])
  /* 提醒使用带 rev 的实例保存；离线/冲突保留错误，不伪报本机已保存。 */
  const server = async (patch: Record<string, unknown>) => {
    setBusy(true); setError('')
    try {
      const before = data.reminderSettings?.preferences
      await props.command('settings.reminders', patch)
      const expected = props.readData?.().reminderSettings?.preferences
      settings.notify('提醒习惯已保存到当前 DOT，电脑和手机共用；星邮匣仍收信。')
      if (before && expected) settings.offerServerUndo(() => props.command('settings.reminders', { restore: before, expected }))
    }
    catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }
  const change = (patch: Partial<PersonalPreferences>) => { try { settings.change(patch); setError('') } catch (cause) { setError(String(cause)) } }
  /* 设置中心二级页控件：全部是同风格的自绘控件（金色开关/滑条/分段/步进），不出现浏览器原生复选框与日期框。 */
  const slider = (key: 'fontScale' | 'glassOpacity' | 'spriteScale', label: string, min: number, max: number, icon: RowIconName) => <CSlider icon={icon} label={label} min={min} max={max} value={local.value[key]} onChange={value => change({ [key]: value })} />
  const toggle = (key: keyof PersonalPreferences, label: string, icon: RowIconName) => <CRow icon={icon} label={label} control={<CSwitch label={label} checked={Boolean(local.value[key])} onChange={value => change({ [key]: value })} />} />
  const prefs = data.reminderSettings?.preferences
  const quiet = Boolean(prefs?.dnd.enabled && (prefs.dnd.until === undefined || prefs.dnd.until > Date.now()))
  const reminderOff = busy || !data.connected || !data.reminderSettings?.personalReminders
  const quietUntil = (end: number) => { if (!Number.isFinite(end) || end <= Date.now()) { setError('结束时间需要在未来'); return } void server({ until: end }) }
  const permissionText = window.dotAndroid ? '由 Android 系统管理' : ({ granted: '已允许', denied: '已拒绝', default: '尚未询问' } as Record<string, string>)[permission] ?? permission
  const quietControls = <>
    {data.reminderSettings?.personalReminders !== true && <p role="status" className={css.cNotice}>临时免打扰与分类提醒代码已更新，当前运行服务尚未加载；这两项暂不可用，普通外观设置不受影响。</p>}
    <CSection caption="免打扰">
      <CRow icon="quiet" label="免打扰" desc={quiet ? prefs?.dnd.until ? `免打扰至 ${formatEnd(prefs.dnd.until)}` : '按每日时间窗免打扰' : '免打扰已关闭'} />
      <div className={css.cBlock}>
        <span className={css.cBlockLabel}>时长</span>
        <CSegment label="免打扰时长" wide value={quiet ? '' : 'off'} disabled={reminderOff} options={[{ key: 'off', label: '关闭' }, { key: 'hour', label: '1小时' }, { key: 'night', label: '今晚' }]} onPick={key => {
          if (key === 'off') void server({ until: null })
          else if (key === 'hour') void server({ until: Date.now() + 3600000 })
          else { const end = new Date(); end.setHours(8, 0, 0, 0); if (end.getTime() <= Date.now()) end.setDate(end.getDate() + 1); void server({ until: end.getTime() }) }
        }} />
      </div>
      <div className={css.cBlock}>
        <span className={css.cBlockLabel}>自定义结束<b>{formatEnd(until)}</b></span>
        <EndPicker value={until} onChange={setUntil} disabled={reminderOff} />
        <div className={css.cActions} data-align="end"><button type="button" className={css.cBtn} data-primary="true" disabled={reminderOff} onClick={() => quietUntil(until)}>设定</button></div>
      </div>
    </CSection>
    <p className={css.cHint}>当前 DOT 的电脑与手机共用。只暂停主动提醒，信照常进星邮匣。</p>
  </>
  const groups: { key: string; title: string; en: string; desc: string; icon: SettingsCenterIconKey; body: ReactNode }[] = [
    { key: 'appearance', title: '外观与阅读', en: 'APPEARANCE', desc: '字体大小、玻璃浓度与动态效果', icon: 'appearance', body: <>
      <CSection caption="阅读">{slider('fontScale', '字体大小', 85, 130, 'font')}{slider('glassOpacity', '玻璃浓度', 35, 100, 'glass')}</CSection>
      <CSection caption="动态">{toggle('reducedMotion', '减少动态效果', 'motion')}</CSection>
      <p className={css.cHint}>星夜风格保留。字体影响实际阅读与输入，玻璃影响真实面板；仅当前设备。</p>
      <div className={css.cActions}><button type="button" className={css.cBtn} onClick={() => change({ fontScale: DEFAULT_PERSONAL.fontScale, glassOpacity: DEFAULT_PERSONAL.glassOpacity, reducedMotion: DEFAULT_PERSONAL.reducedMotion })}><RowIcon name="reset" />恢复本组默认</button></div>
    </> },
    { key: 'astra', title: 'ASTRA 与菜单', en: 'ASTRA & MENU', desc: '精灵大小、停靠侧与状态提示', icon: 'astra', body: <>
      <CSection caption="精灵">{slider('spriteScale', '精灵大小', 40, 100, 'size')}
        <CRow icon="edge" label="精灵停靠侧" control={<CSegment label="精灵停靠侧" value={local.value.spriteEdge ?? ''} options={[{ key: 'left', label: '左侧' }, { key: 'right', label: '右侧' }]} onPick={key => change({ spriteEdge: key as 'left' | 'right' })} />} />
      </CSection>
      <CSection caption="状态">{toggle('idleShrink', '闲置时适度缩小', 'idle')}{toggle('stateFeedback', '显示状态提示', 'feedback')}</CSection>
      <p className={css.cHint}>精灵始终是菜单入口，拖动仍可停靠；没有隐藏开关。</p>
    </> },
    { key: 'persona', title: '人格与称呼', en: 'PERSONA', desc: 'DOT 的名字、对你的称呼、性别与人格', icon: 'astra', body: <PersonaSettings css={css as unknown as Record<string, string>} /> }, // dot-persona-2026-10-27
    { key: 'notice', title: '提醒习惯', en: 'NOTIFICATIONS', desc: '免打扰、系统通知与主动提醒', icon: 'notice', body: <>
      {quietControls}
      <CSection caption="系统通知">
        <CRow icon="bell" label="本设备系统通知" value={permissionText} />
        <button type="button" className={`${css.cRow} ${css.cNav}`} onClick={() => void props.command('notifications.enable').then(() => setPermission(typeof Notification === 'undefined' ? '无法从浏览器查询' : Notification.permission)).catch(cause => setError(String(cause)))}><RowIcon name="spark" /><span className={css.cLabel}>申请系统通知</span><Chevron /></button>
      </CSection>
      <CSection caption="主动提醒">{(['completed', 'attention', 'failed'] as const).map((category, i) => {
        const label = `${['任务完成', '需要确认或介入', '任务失败'][i]}主动提醒`
        return <CRow key={category} icon={(['done', 'attention', 'failed'] as const)[i]!} label={label} control={<CSwitch label={label} disabled={reminderOff || !prefs} checked={prefs?.events?.[category] ?? true} onChange={value => void server({ category, enabled: value })} />} />
      })}</CSection>
      <p className={css.cHint}>关闭后不再主动弹出，相关消息仍留在星邮匣。</p>
      <CSection caption="提醒渠道">
        <CRow icon="phone" label="本机/前台提醒渠道" control={<CSwitch label="本机/前台提醒渠道" disabled={busy || !prefs || !data.connected} checked={prefs?.channels.native ?? false} onChange={value => void server({ channel: 'native', enabled: value })} />} />
        {data.channelStatus?.feishuConfigured
          ? <CRow icon="plane" label="飞书提醒渠道" control={<CSwitch label="飞书提醒渠道" disabled={busy || !prefs || !data.connected} checked={prefs?.channels.feishu ?? false} onChange={value => void server({ channel: 'feishu', enabled: value })} />} />
          : <CRow icon="plane" label="飞书提醒渠道" desc={`飞书尚未配置：${data.channelStatus?.reason ?? '未取得接入状态'}`} />}
        {/* 2026-10-27 能力空间整页删除：原「前往能力空间配置渠道」一行随之撤掉。 */}
      </CSection>
    </> },
    { key: 'work', title: '对话与工作展示', en: 'CONVERSATION & WORK', desc: '工作卡打开方式、展开与动效', icon: 'conversation', body: <>
      <CSection caption="工作卡">{toggle('autoWorkCard', '查询进度时自动打开工作卡', 'card')}{toggle('expandedWorkCard', '工作卡默认展开详情', 'expand')}{toggle('cardMotion', '工作卡动态效果', 'motion')}</CSection>
      <p className={css.cHint}>只改本机展示，不取消后台工作，也不改聊天正文。</p>
    </> },
    { key: 'device', title: '当前设备与连接', en: 'DEVICE & SYNC', desc: '服务地址、连接状态与重新读取', icon: 'device', body: <>
      <CSection caption="当前连接">
        <CRow icon="server" label="当前服务" desc={<code className={css.cCode}>{location.origin}</code>} />
        <CRow icon="signal" label="连接" desc={data.connected ? undefined : '旧快照不代表实时状态'} value={<span className={css.cState} data-on={data.connected}>{data.connected ? '已连接' : '已断开'}</span>} />
      </CSection>
      <CSection caption="操作">
        <button type="button" className={`${css.cRow} ${css.cNav}`} onClick={() => void props.refresh()}><RowIcon name="refresh" /><span className={css.cLabel}>重新读取状态</span><Chevron /></button>
        <button type="button" className={`${css.cRow} ${css.cNav}`} onClick={() => location.reload()}><RowIcon name="reload" /><span className={css.cLabel}>刷新本页</span><Chevron /></button>
        <button type="button" className={`${css.cRow} ${css.cNav}`} onClick={() => void props.command('connection.configure').catch(cause => setError(String(cause)))}><RowIcon name="link" /><span className={css.cLabel}>更换服务地址</span><Chevron /></button>
      </CSection>
      <p className={css.cHint}>更换地址只影响此设备，可能断开当前连接；不会更改 Tailscale 或新建账号。</p>
    </> },
    { key: 'about', title: '关于与诊断', en: 'ABOUT & DIAGNOSTICS', desc: '版本、XTMEM、模型/API 与插件配置', icon: 'about', body: <>
      <CSection caption="版本">
        <CRow icon="info" label="XTCausal DOT" value="个人版 0.1.0" />
        <CRow icon="memory" label="XTMEM" desc={data.memoryStatus ? data.memoryStatus.available ? `可用${data.memoryStatus.engineVersion ? ` · ${data.memoryStatus.engineVersion}` : ''}` : data.memoryStatus.reason ?? '不可用' : '状态尚未取得'} />
      </CSection>
      <CSection caption="配置">
        <button type="button" className={`${css.cRow} ${css.cNav}`} onClick={() => void props.command('settings.models').catch(cause => setError(String(cause)))}><RowIcon name="chip" /><span className={css.cLabel}>模型/API 配置</span><Chevron /></button>
        <button type="button" className={`${css.cRow} ${css.cNav}`} onClick={() => void props.command('plugins.open').catch(cause => setError(String(cause)))}><RowIcon name="plugin" /><span className={css.cLabel}>插件与工具配置</span><Chevron /></button>
      </CSection>
      <CSection caption="诊断">
        <button type="button" className={`${css.cRow} ${css.cNav}`} aria-expanded={diagOpen} onClick={() => setDiagOpen(value => !value)}><RowIcon name="pulse" /><span className={css.cLabel}>诊断详情</span><Chevron open={diagOpen} /></button>
        {diagOpen && <div className={css.cDetail}>
          <p>真实目录：{data.providers?.length ?? 0} 个 API/供应商，{data.providers?.reduce((n, row) => n + row.models.length, 0) ?? 0} 个模型；{data.capabilities.filter(row => row.id.startsWith('tool:')).length} 个工具。</p>
          <p>最近错误：{data.error ?? data.providerError ?? '当前没有已捕获的错误'}</p>
          <div className={css.cActions}><button type="button" className={css.cBtn} onClick={() => { const report = { app: 'XTCausal DOT 0.1.0', connected: data.connected, memoryAvailable: data.memoryStatus?.available ?? null, providers: data.providers?.length ?? 0, models: data.providers?.reduce((n, row) => n + row.models.length, 0) ?? 0, tools: data.capabilities.filter(row => row.id.startsWith('tool:')).length, errorPresent: Boolean(data.error || data.providerError), time: new Date().toISOString() }; const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'dot-diagnostics.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }}><RowIcon name="download" />导出脱敏诊断</button></div>
          <p className={css.cHint}>导出不含服务地址、连接名称、正文、密钥或原始错误文本。</p>
        </div>}
      </CSection>
    </> }
  ]
  const open = page === 'full' ? groups.find(row => row.key === group) : undefined
  const native = page === 'plugins' || page === 'native'
  const apiPage = page === 'models'
  /* 快捷免打扰开关走星邮匣同一个 postbox.preferences 接口（与星邮匣页的免打扰勾选同一份），
     1小时/今晚/自定义结束仍在设置中心「提醒习惯」；保存成功才回执，撤销沿用带 rev 的原接头。 */
  const toggleQuiet = async (next: boolean) => {
    setBusy(true); setError('')
    try {
      const before = data.reminderSettings?.preferences
      await props.command('postbox.preferences', { dnd: next })
      const expected = props.readData?.().reminderSettings?.preferences
      settings.notify(next ? '已开启免打扰（按每日时间窗），当前 DOT 的电脑和手机共用；信照常进星邮匣。' : '已关闭当前 DOT 的免打扰。')
      if (before && expected && data.reminderSettings?.personalReminders) settings.offerServerUndo(() => props.command('settings.reminders', { restore: before, expected }))
    }
    catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }
  const quickPanel = page === 'quick' && <QuickPanel
    spriteScale={local.value.spriteScale} motion={!local.value.reducedMotion} quiet={data.dnd} quietDisabled={busy || !data.connected}
    onScale={value => change({ spriteScale: value })} onMotion={value => change({ reducedMotion: !value })} onQuiet={value => void toggleQuiet(value)}
    onOpenCenter={() => props.actions.settings('full')} onClose={() => props.actions.back()}
    footer={<>{busy && <p role="status" className={css.qReceipt}>正在保存到 DOT…</p>}{error && <p role="alert" className={css.qError}>{error}</p>}{local.notice && <p className={css.qReceipt} role="status">{local.notice}{(local.canUndo || local.serverUndo) && <button onClick={() => void settings.undoLast().catch(cause => setError(String(cause)))}>撤销</button>}</p>}</>} />
  const center = page !== 'quick'
  const headIcon: SettingsCenterIconKey = open ? open.icon as SettingsCenterIconKey : 'about'
  const headTitle = apiPage ? 'API与模型连接' : native ? '插件与工具' : open?.title
  const headEn = native ? 'NATIVE CONFIG' : open?.en
  const footer = <>{busy && <p role="status" className={css.cToast}>正在保存到 DOT…</p>}{error && <p role="alert" className={`${css.cToast} ${css.error}`}>{error}</p>}{local.notice && <p className={css.cToast} role="status">{local.notice}{(local.canUndo || local.serverUndo) && <button type="button" onClick={() => void settings.undoLast().catch(cause => setError(String(cause)))}>撤销{local.serverUndo ? '提醒' : '本机'}调整</button>}</p>}</>
  /* ⚠️ 精灵是唯一全局入口：设置盖住场景时，在浮层内保留同一入口，点它收起设置并打开六空间菜单。
     快捷设置：底角、同停靠侧；设置中心：底部是背景横幅（必须完整显示），入口移到标题栏右侧。 */
  const keep = <button className={css.spriteKeep} data-edge={edge} aria-label="ASTRA 菜单入口" title="打开六空间菜单" onClick={() => { props.actions.settings(null); props.actions.orbitMenu(true) }}><ArtSlot kind="docked" className={css.spriteKeepArt} /><small>ASTRA</small></button>
  return <section ref={panel} className={css.overlay} data-quick={page === 'quick'} data-center={center} data-page={open ? 'group' : page ?? undefined} data-edge={edge} data-settings-overlay="" role="dialog" aria-modal="true" aria-label={native ? '能力原生配置' : page === 'quick' ? 'ASTRA 快捷设置' : '个人设置'} onPointerDown={event => { pressed.current = event.target === event.currentTarget }} onClick={event => { if (pressed.current && event.target === event.currentTarget) props.actions.back(); pressed.current = false }}>
    {quickPanel || <div className={css.panel} data-view={open ? 'group' : native ? 'native' : 'home'} style={{ '--center-bg': `url(${settingsCenterBackground})`, '--center-banner': `url(${settingsCenterBanner})` } as CSSProperties}>
      {/* 背景 settings_bg 730×1536 按底部对齐铺满；底部横幅（坐着的 ASTRA 与标语）属于背景装饰，矮屏只裁顶部星空。 */}
      <header className={css.cHeader}>
        <button type="button" className={css.cBack} aria-label={open ? '返回设置中心' : '返回'} onClick={() => open ? setGroup(null) : props.actions.back()}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 3.2 5.2 8l4.8 4.8" /></svg></button>
        {headTitle
          ? <div className={css.cHeadGroup}><img className={css.cHeadIcon} src={settingsCenterIcons[headIcon]} alt="" draggable={false} /><h1 className={css.cHeadTitle}>{headTitle}<small>{headEn}</small></h1></div>
          : <h1 className={css.cTitle}>设置中心<small aria-hidden="true">SETTINGS CENTER</small></h1>}
        {keep}
      </header>
      {!headTitle
        ? <nav className={css.cList} aria-label="设置分组">{groups.map(row => <button type="button" key={row.key} className={css.cCard} data-group={row.key} onClick={() => setGroup(row.key)}>
            <img className={css.cCardIcon} src={settingsCenterIcons[row.icon]} alt="" draggable={false} />
            <span className={css.cCardText}><b>{row.title}</b><small>{row.desc}</small></span>
            <svg className={css.cCardChev} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3.2 10.8 8 6 12.8" /></svg>
          </button>)}</nav>
        : <div className={css.cBody}>
          <div className={css.cScroll} data-group={open?.key ?? page}>
            {apiPage ? <ApiSettingsPanel port={props.apiSettings} /> : native ? <CSection caption="插件与工具">
              <p className={css.cText}>插件保留各自的配置入口；API与模型使用DOT自己的设置界面。</p>
              <div className={css.native}><button type="button" className={`${css.cRow} ${css.cNav}`} onClick={() => void props.command('plugins.open').catch(cause => setError(String(cause)))}><RowIcon name="gear" /><span className={css.cLabel}>打开插件配置</span><Chevron /></button></div>
            </CSection> : open?.body}
          </div>
          {(busy || error || local.notice) && <div className={css.cFoot}>{footer}</div>}
        </div>}
    </div>}
    {!center && keep}
  </section>
}

/* ── 设置中心二级页的同风格控件 ────────────────────────────────────
   金色开关/滑条与快捷设置同一套配色；行小图标一律代码画的金色线条，不引图片素材。
   ⚠️ 只渲染：值与回调都由 SettingsOverlay 传入，接线仍是同一份 PersonalSettings / DOT 提醒接口。 */
const ROW_ICONS = {
  font: ['M3.5 18.5 8.5 5.5h1l5 13', 'M5.6 13.6h6.8', 'M20.5 18.5v-5a2.6 2.6 0 0 0-4.6-1.6', 'M20.5 15.6c-2.8-.4-5 .3-5 1.6 0 1 .9 1.5 2 1.5 1.6 0 3-1.1 3-3.1'],
  glass: ['M12 3.8 20.5 8 12 12.2 3.5 8 12 3.8z', 'M3.5 12 12 16.2 20.5 12', 'M3.5 16 12 20.2 20.5 16'],
  motion: ['M10 3.5l1.6 4.4 4.4 1.6-4.4 1.6L10 15.5l-1.6-4.4L4 9.5l4.4-1.6z', 'M17.5 13.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z'],
  reset: ['M4.5 12a7.5 7.5 0 1 0 2.2-5.3', 'M4.5 4v4.2h4.2'],
  size: ['M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6', 'M13.3 12a1.3 1.3 0 1 1-2.6 0 1.3 1.3 0 0 1 2.6 0z'],
  edge: ['M19.5 3.5v17', 'M7 8h5a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z', 'M14 12h3M15.6 10.4L17.2 12l-1.6 1.6'],
  idle: ['M13 4h6l-6 7h6', 'M5 12.5h4.5l-4.5 6h4.5'],
  feedback: ['M4 5.5h16v10.5H10l-4.5 3.5V16H4z', 'M8 9.5h8M8 12.5h5'],
  quiet: ['M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z', 'M16.5 4.5l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z'],
  bell: ['M6 16v-5a6 6 0 1 1 12 0v5l2 2H4l2-2z', 'M10 20.5a2 2 0 0 0 4 0'],
  spark: ['M12 3v4M12 17v4M3 12h4M17 12h4', 'M12 9.2l.9 1.9 1.9.9-1.9.9-.9 1.9-.9-1.9-1.9-.9 1.9-.9z'],
  done: ['M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17z', 'M8.2 12.3l2.6 2.6 5-5.2'],
  attention: ['M12 3.8 21 19.5H3z', 'M12 10v4.5', 'M12 17.2v.1'],
  failed: ['M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17z', 'M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6'],
  phone: ['M8.5 3h7a1.5 1.5 0 0 1 1.5 1.5v15a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 19.5v-15A1.5 1.5 0 0 1 8.5 3z', 'M11 18h2'],
  plane: ['M20.5 3.5 3.5 10.8l6.8 2.4 2.4 6.8z', 'M10.3 13.2l4.4-4.4'],
  link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  card: ['M4 6h16v13H4z', 'M4 10h16', 'M7.5 14h5'],
  expand: ['M4 5h16v14H4z', 'M9 11l3 3 3-3'],
  server: ['M4.5 4.5h15v6h-15zM4.5 13.5h15v6h-15z', 'M8 7.5h.1M8 16.5h.1'],
  signal: ['M4.5 10.5a10.6 10.6 0 0 1 15 0', 'M7.6 13.8a6.2 6.2 0 0 1 8.8 0', 'M12 17.6v.1'],
  refresh: ['M19.5 11A7.5 7.5 0 0 0 6 7.3L4.5 9', 'M4.5 4.5V9H9', 'M4.5 13A7.5 7.5 0 0 0 18 16.7l1.5-1.7', 'M19.5 19.5V15H15'],
  reload: ['M4 6h16v13H4z', 'M4 9.5h16', 'M14.8 14.6a3 3 0 1 1-.9-2.2', 'M14.4 11.3v1.6h-1.6'],
  info: ['M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17z', 'M12 11v5.2', 'M12 7.8v.1'],
  memory: ['M12 3.5c4.1 0 7.5 1.2 7.5 2.8S16.1 9 12 9 4.5 7.9 4.5 6.3 7.9 3.5 12 3.5z', 'M4.5 6.3v11.4c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8V6.3', 'M4.5 12c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8'],
  chip: ['M7.5 7.5h9v9h-9z', 'M10 3.5v4M14 3.5v4M10 16.5v4M14 16.5v4M3.5 10h4M3.5 14h4M16.5 10h4M16.5 14h4'],
  plugin: ['M9.5 4.5h5v2.2a1.6 1.6 0 0 0 3.2 0V4.5H20v6h-2.3a1.6 1.6 0 0 0 0 3.2H20v5.8H4v-5.8h2.3a1.6 1.6 0 0 0 0-3.2H4v-6h5.5z'],
  pulse: ['M3 12h4l2.2-5.5 4.2 11 2.3-5.5H21'],
  download: ['M12 4v11', 'M7.5 10.5 12 15l4.5-4.5', 'M5 19.5h14'],
  calendar: ['M4.5 6h15v14h-15z', 'M4.5 10h15', 'M8.5 3.5v4M15.5 3.5v4'],
  gear: ['M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z', 'M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7'],
} as const
type RowIconName = keyof typeof ROW_ICONS
function RowIcon({ name }: { name: RowIconName }) {
  return <svg className={css.cIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{ROW_ICONS[name].map(d => <path key={d} d={d} />)}</svg>
}
function Chevron({ open }: { open?: boolean | undefined }) {
  return <svg className={css.cChev} data-open={open} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M6 3.5 10.5 8 6 12.5" /></svg>
}
function CSection({ caption, children }: { caption: string; children: ReactNode }) {
  return <section className={css.cSection}><h2 className={css.cCaption}>{caption}</h2><div className={css.cGlass}>{children}</div></section>
}
function CRow({ icon, label, desc, value, control }: { icon: RowIconName; label: string; desc?: ReactNode | undefined; value?: ReactNode | undefined; control?: ReactNode | undefined }) {
  return <div className={css.cRow}><RowIcon name={icon} /><span className={css.cLabel}>{label}{desc !== undefined && <small>{desc}</small>}</span>{value !== undefined && <span className={css.cValue}>{value}</span>}{control}</div>
}
function CSwitch({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange(value: boolean): void; disabled?: boolean | undefined }) {
  return <button type="button" role="switch" className={css.cSwitch} aria-label={label} aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} />
}
function CSlider({ icon, label, min, max, value, onChange }: { icon: RowIconName; label: string; min: number; max: number; value: number; onChange(value: number): void }) {
  return <label className={`${css.cRow} ${css.cSlider}`}><RowIcon name={icon} /><span className={css.cLabel}>{label}</span><output className={css.cValue}>{value}%</output>
    <input className={css.cRange} style={{ '--c-fill': `${(value - min) / (max - min) * 100}%` } as CSSProperties} aria-label={label} type="range" min={min} max={max} step={1} value={value} onChange={event => onChange(Number(event.target.value))} /></label>
}
function CSegment({ label, options, value, onPick, disabled, wide }: { label: string; options: { key: string; label: string }[]; value: string; onPick(key: string): void; disabled?: boolean | undefined; wide?: boolean | undefined }) {
  return <div className={css.cSegment} data-wide={wide} role="group" aria-label={label}>{options.map(option => <button type="button" key={option.key} aria-pressed={value === option.key} disabled={disabled} onClick={() => onPick(option.key)}>{option.label}</button>)}</div>
}
const WEEK = '日一二三四五六'
const pad = (n: number) => String(n).padStart(2, '0')
function dayWord(time: number) {
  const day = new Date(time); day.setHours(0, 0, 0, 0)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((day.getTime() - today.getTime()) / 86400000)
  return diff === 0 ? '今天' : diff === 1 ? '明天' : diff === 2 ? '后天' : ''
}
function formatEnd(time: number) {
  const at = new Date(time), word = dayWord(time)
  return `${word || `${at.getMonth() + 1}月${at.getDate()}日`} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}
/* 自定义结束时间：日期步进 + 时步进 + 分钟四档，代替浏览器原生 datetime-local。日期不早于今天，最多 30 天后。 */
function EndPicker({ value, onChange, disabled }: { value: number; onChange(value: number): void; disabled?: boolean | undefined }) {
  const at = new Date(value)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const day = new Date(value); day.setHours(0, 0, 0, 0)
  const offset = Math.round((day.getTime() - today.getTime()) / 86400000)
  const shift = (patch: (next: Date) => void) => { const next = new Date(value); patch(next); onChange(next.getTime()) }
  const minute = Math.floor(at.getMinutes() / 15) * 15
  return <div className={css.cPicker} role="group" aria-label="免打扰结束时间">
    <div className={css.cStepper} data-wide="true">
      <button type="button" aria-label="前一天" disabled={disabled || offset <= 0} onClick={() => shift(next => next.setDate(next.getDate() - 1))}><Chevron /></button>
      <output aria-live="polite"><RowIcon name="calendar" />{dayWord(value) && <em>{dayWord(value)}</em>}{at.getMonth() + 1}月{at.getDate()}日 周{WEEK[at.getDay()]}</output>
      <button type="button" aria-label="后一天" disabled={disabled || offset >= 30} onClick={() => shift(next => next.setDate(next.getDate() + 1))}><Chevron /></button>
    </div>
    <div className={css.cPickerRow}>
      <div className={css.cStepper}>
        <button type="button" aria-label="早一小时" disabled={disabled} onClick={() => shift(next => next.setHours((next.getHours() + 23) % 24))}><Chevron /></button>
        <output aria-live="polite">{pad(at.getHours())}<small>时</small></output>
        <button type="button" aria-label="晚一小时" disabled={disabled} onClick={() => shift(next => next.setHours((next.getHours() + 1) % 24))}><Chevron /></button>
      </div>
      <CSegment label="分钟" value={String(minute)} disabled={disabled} options={[0, 15, 30, 45].map(m => ({ key: String(m), label: pad(m) }))} onPick={key => shift(next => next.setMinutes(Number(key), 0, 0))} />
    </div>
  </div>
}

/* ── 快捷设置面板 ─────────────────────────────────────────────
   底座原画（金边、标题、头发都在图里）+ 真实控件叠层；坐标按单文件验收版在原图 941×1672 上的实测。
   ⚠️ 只渲染，不持有状态：每个值都来自 PersonalSettings / DOT 快照，回调写回同一处。 */
type QuickPanelProps = {
  spriteScale: number; motion: boolean; quiet: boolean; quietDisabled: boolean
  onScale(value: number): void; onMotion(value: boolean): void; onQuiet(value: boolean): void
  onOpenCenter(): void; onClose(): void; footer: ReactNode
}
const QUICK_ICONS = {
  show: ['M2.8 12s3.4-6 9.2-6 9.2 6 9.2 6-3.4 6-9.2 6-9.2-6-9.2-6z', 'M12 9.3l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z'],
  edge: ['M19.5 3.5v17', 'M7 8h5a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z', 'M14 12h3M15.6 10.4L17.2 12l-1.6 1.6'],
  size: ['M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6', 'M13.3 12a1.3 1.3 0 1 1-2.6 0 1.3 1.3 0 0 1 2.6 0z'],
  motion: ['M10 3.5l1.6 4.4 4.4 1.6-4.4 1.6L10 15.5l-1.6-4.4L4 9.5l4.4-1.6z', 'M17.5 13.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z'],
  quiet: ['M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z', 'M16.5 4.5l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z'],
  center: ['M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z', 'M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7', 'M18.6 12a6.6 6.6 0 1 1-13.2 0 6.6 6.6 0 0 1 13.2 0z'],
} as const
function QuickIcon({ name }: { name: keyof typeof QUICK_ICONS }) {
  return <svg className={css.qIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{QUICK_ICONS[name].map(d => <path key={d} d={d} />)}</svg>
}
function QuickSwitch({ id, checked, onChange, disabled }: { id: string; checked: boolean; onChange?: (value: boolean) => void; disabled?: boolean | undefined }) {
  return <button type="button" role="switch" className={css.qSwitch} aria-checked={checked} aria-labelledby={id} disabled={disabled} onClick={() => onChange?.(!checked)} />
}
function QuickPanel(props: QuickPanelProps) {
  const fill = `${(props.spriteScale - 40) / 60 * 100}%`
  return <>
    <div className={css.qStage}>
      <div className={css.qFrost} aria-hidden="true" />
      <img className={css.qArt} src={quickPanelArt} alt="" draggable={false} />
      <h2 className={css.qTitle}>ASTRA · 快捷设置</h2>
      <button type="button" className={css.qClose} aria-label="关闭快捷设置" onClick={props.onClose}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /></svg></button>
      <div className={css.qContent}>
        {/* TODO(快捷设置·显示 ASTRA)：用户 2026-10-24 定为先留位、功能后定。不接状态、不新增设置，也绝不隐藏精灵（精灵是唯一菜单入口）。 */}
        <div className={css.qRow} data-pending="true"><QuickIcon name="show" /><span className={css.qLabel} id="dot-quick-show">显示 ASTRA</span><QuickSwitch id="dot-quick-show" checked={false} disabled /></div>
        {/* TODO(快捷设置·自动贴边)：同上先留位；精灵现有的左右停靠在设置中心「ASTRA 与菜单」。 */}
        <div className={css.qRow} data-pending="true"><QuickIcon name="edge" /><span className={css.qLabel} id="dot-quick-edge">自动贴边</span><QuickSwitch id="dot-quick-edge" checked={false} disabled /></div>
        <label className={`${css.qRow} ${css.qSize}`}><QuickIcon name="size" /><span className={css.qLabel}>精灵大小</span><output className={css.qValue}>{props.spriteScale}%</output>
          <input className={css.qRange} style={{ '--q-fill': fill } as CSSProperties} aria-label="精灵大小" type="range" min={40} max={100} step={1} value={props.spriteScale} onChange={event => props.onScale(Number(event.target.value))} /></label>
        <div className={css.qRow}><QuickIcon name="motion" /><span className={css.qLabel} id="dot-quick-motion">动态效果</span><QuickSwitch id="dot-quick-motion" checked={props.motion} onChange={props.onMotion} /></div>
        <div className={css.qRow}><QuickIcon name="quiet" /><span className={css.qLabel} id="dot-quick-quiet">免打扰</span><QuickSwitch id="dot-quick-quiet" checked={props.quiet} disabled={props.quietDisabled} onChange={props.onQuiet} /></div>
        <button type="button" className={`${css.qRow} ${css.qGo}`} onClick={props.onOpenCenter}><QuickIcon name="center" /><span className={css.qLabel}>打开设置中心</span><svg className={css.qChev} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" /></svg></button>
      </div>
    </div>
    <div className={css.qFooter}>{props.footer}</div>
  </>
}
