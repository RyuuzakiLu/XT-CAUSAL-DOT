/* ================================================================
   个人 DOT 设置登记与本机保存 · 总导游图
   ▍这是什么
   给本人手机/电脑使用的纯 TypeScript 设置登记、普通指令识别与本机小本本。
   只存显示偏好；提醒、模型和凭据仍归各自原生服务。
   ▍结构
   类型与默认值 → 校验/自然语言 → 可订阅本机存储与撤销。
   ▍修改铁律
   1. 【不】增加精灵隐藏或零尺寸；它是唯一菜单入口。
   2. 【不】在这里保存 API Key 或服务器事实；否则两份真相会打架。
   3. 写盘失败必须抛错，不能先告诉用户已经保存。
   ▍更新记录
   *更新：2026-10-24 · 个人版设置、明确指令、按设备保存和可核对撤销*
================================================================ */
export type PersonalPreferences = {
  fontScale: number
  glassOpacity: number
  spriteScale: number
  spriteEdge: 'left' | 'right'
  reducedMotion: boolean
  idleShrink: boolean
  stateFeedback: boolean
  autoWorkCard: boolean
  expandedWorkCard: boolean
  cardMotion: boolean
}
export const DEFAULT_PERSONAL: PersonalPreferences = {
  fontScale: 100, glassOpacity: 88, spriteScale: 85, spriteEdge: 'right',
  reducedMotion: false, idleShrink: true, stateFeedback: true,
  autoWorkCard: true, expandedWorkCard: false, cardMotion: true,
}
export type PersonalKey = keyof PersonalPreferences
export type SettingsPage = 'quick' | 'full' | 'models' | 'plugins' | 'native' | null
export type SettingIntent =
  | { kind: 'local'; patch: Partial<PersonalPreferences> }
  | { kind: 'dnd'; until: number | null }
  | { kind: 'notification'; category: 'completed' | 'attention' | 'failed'; enabled: boolean }
  | { kind: 'undo' }
  | { kind: 'unavailable'; message: string }

/* 白名单和范围既供滑杆也供语言动作使用，旧数据不会把菜单缩没。 */
export function normalizePersonal(value: unknown): PersonalPreferences {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const range = (key: PersonalKey, min: number, max: number): number => {
    const n = input[key]
    return typeof n === 'number' && Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : DEFAULT_PERSONAL[key] as number
  }
  const bool = (key: PersonalKey): boolean => typeof input[key] === 'boolean' ? input[key] as boolean : DEFAULT_PERSONAL[key] as boolean
  return {
    fontScale: range('fontScale', 85, 130), glassOpacity: range('glassOpacity', 35, 100),
    spriteScale: range('spriteScale', 40, 100), spriteEdge: input.spriteEdge === 'left' ? 'left' : 'right',
    reducedMotion: bool('reducedMotion'), idleShrink: bool('idleShrink'), stateFeedback: bool('stateFeedback'),
    autoWorkCard: bool('autoWorkCard'), expandedWorkCard: bool('expandedWorkCard'), cardMotion: bool('cardMotion'),
  }
}

/* 只认完整、明确的日常指令；问句、讨论、引用和附带其他工作的话交回真正对话。 */
export function parseSettingIntent(text: string, current: PersonalPreferences, now = Date.now()): SettingIntent | null {
  const raw = text.trim().replace(/[。！!]+$/u, '').replace(/^(请|帮我|麻烦)(把)?/u, '').trim()
  if (!raw || /[?？“”"「」]|怎么|如何|能不能|可以吗|要不要|建议|如果|假如|比如|是不是/u.test(raw)) return null
  if (/^(撤销|恢复)(刚才|上次|刚刚)(的)?(设置|调整|改动)$/u.test(raw)) return { kind: 'undo' }
  if (/^(把)?精灵(隐藏|关掉|关闭|禁用|藏起来)$/u.test(raw)) return { kind: 'unavailable', message: '精灵是全局菜单入口，不能隐藏；可以缩小或换到另一侧。' }
  const size = raw.match(/^(?:把)?精灵(?:大小)?(?:调到|调成|设为|设置为)?\s*(\d{1,3})\s*[%％]$/u)
  if (size) return { kind: 'local', patch: { spriteScale: Number(size[1]) } }
  if (/^(把)?精灵(调)?(小一点|缩小一点|小点)$/u.test(raw)) return { kind: 'local', patch: { spriteScale: current.spriteScale - 10 } }
  if (/^(把)?精灵(调)?(大一点|放大一点|大点)$/u.test(raw)) return { kind: 'local', patch: { spriteScale: current.spriteScale + 10 } }
  if (/^(精灵)?(靠左|停靠左侧|靠左一点)$/u.test(raw)) return { kind: 'local', patch: { spriteEdge: 'left' } }
  if (/^(精灵)?(靠右|停靠右侧|靠右一点)$/u.test(raw)) return { kind: 'local', patch: { spriteEdge: 'right' } }
  if (/^(减少动画|减少动态效果|关掉动画|关闭动画)$/u.test(raw)) return { kind: 'local', patch: { reducedMotion: true } }
  if (/^(恢复动画|开启动画|打开动画)$/u.test(raw)) return { kind: 'local', patch: { reducedMotion: false } }
  if (/^(把)?(字|字体)(调)?(大一号|大一点|放大一点)$/u.test(raw)) return { kind: 'local', patch: { fontScale: current.fontScale + 5 } }
  if (/^(把)?(字|字体)(调)?(小一号|小一点|缩小一点)$/u.test(raw)) return { kind: 'local', patch: { fontScale: current.fontScale - 5 } }
  if (/^(把)?玻璃(调)?(淡一点|透明一点)$/u.test(raw)) return { kind: 'local', patch: { glassOpacity: current.glassOpacity - 10 } }
  if (/^(把)?玻璃(调)?(浓一点|不透明一点)$/u.test(raw)) return { kind: 'local', patch: { glassOpacity: current.glassOpacity + 10 } }
  if (/^(关闭免打扰|取消免打扰|恢复主动提醒)$/u.test(raw)) return { kind: 'dnd', until: null }
  if (/^(免打扰一小时|一小时内别打扰我|接下来一小时别打扰我)$/u.test(raw)) return { kind: 'dnd', until: now + 3600000 }
  if (/^(今晚别打扰我|今晚免打扰)$/u.test(raw)) {
    const end = new Date(now); end.setHours(8, 0, 0, 0)
    if (end.getTime() <= now) end.setDate(end.getDate() + 1)
    return { kind: 'dnd', until: end.getTime() }
  }
  const category = raw.match(/^(任务完成|需要确认|失败)(别弹窗了|不要提醒了|关闭提醒|开启提醒|恢复提醒)$/u)
  if (category) return { kind: 'notification', category: category[1] === '任务完成' ? 'completed' : category[1] === '失败' ? 'failed' : 'attention', enabled: /开启|恢复/u.test(category[2]!) }
  return null
}

export type PersonalState = { value: PersonalPreferences; notice: string; canUndo: boolean; serverUndo: boolean }
const STORAGE_KEY = 'xtcausal.dot.personal.v1'

/* 小本本只服务当前浏览器设备；跨标签同步不跨手机/电脑，撤销不盖掉后来的修改。 */
export class PersonalSettings {
  private snapshot: PersonalState
  private listeners = new Set<() => void>()
  private previous: { before: PersonalPreferences; after: PersonalPreferences } | null = null
  private undoServer: (() => Promise<void>) | null = null
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'>, fallback: Partial<PersonalPreferences> = {}) {
    let value: PersonalPreferences, notice = ''
    try { const saved = storage.getItem(STORAGE_KEY); value = normalizePersonal(saved ? JSON.parse(saved) : { ...DEFAULT_PERSONAL, ...fallback }) }
    catch { value = normalizePersonal({ ...DEFAULT_PERSONAL, ...fallback }); notice = '本机偏好未能读取，当前使用默认值。' }
    this.snapshot = { value, notice, canUndo: false, serverUndo: false }
  }
  getSnapshot = (): PersonalState => this.snapshot
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  /* 只有明确登记的键允许写入，禁止把任意对象藏到普通偏好里。
     options.silent：照常保存，但不弹「…… 撤销 ×」回执，也不动已有的回执和撤销记录。
     用在拖动精灵松手这类高频、用户一眼就看得到结果的操作（2026-10-24 用户要求）。 */
  change(patch: Partial<PersonalPreferences>, notice = '已保存在当前设备，其他设备不变。', options: { readonly silent?: boolean } = {}): void {
    if (Object.keys(patch).some(key => !Object.hasOwn(DEFAULT_PERSONAL, key))) throw new Error('未登记的个人设置')
    const numeric: PersonalKey[] = ['fontScale', 'glassOpacity', 'spriteScale']
    for (const [key, value] of Object.entries(patch)) {
      if (numeric.includes(key as PersonalKey) ? typeof value !== 'number' || !Number.isFinite(value) : key === 'spriteEdge' ? value !== 'left' && value !== 'right' : typeof value !== 'boolean') throw new Error('个人设置值不正确')
    }
    const before = this.snapshot.value
    const after = normalizePersonal({ ...before, ...patch })
    this.storage.setItem(STORAGE_KEY, JSON.stringify(after))
    if (options.silent) { this.publish({ ...this.snapshot, value: after }); return }
    this.previous = { before, after }; this.undoServer = null
    this.publish({ value: after, notice, canUndo: true, serverUndo: false })
  }
  /* 撤销只恢复本次触碰的键；另一个标签页已经改过的值不能被旧撤销覆盖。 */
  undo(): void {
    const entry = this.previous
    if (!entry) throw new Error('没有可撤销的本机设置')
    const next = { ...this.snapshot.value }
    for (const key of Object.keys(DEFAULT_PERSONAL) as PersonalKey[]) {
      if (entry.before[key] === entry.after[key]) continue
      if (next[key] !== entry.after[key]) throw new Error('这个设置后来又被改过，请按当前值调整')
      Object.assign(next, { [key]: entry.before[key] })
    }
    this.storage.setItem(STORAGE_KEY, JSON.stringify(next)); this.previous = null
    this.publish({ value: next, notice: '已撤销上次本机调整。', canUndo: false, serverUndo: false })
  }
  /* 仅接纳另一个标签页的持久变化；不能制造跨设备的服务器同步。 */
  receive(key: string | null, value: string | null): void {
    if (key !== STORAGE_KEY) return
    try { this.publish({ ...this.snapshot, value: normalizePersonal(value ? JSON.parse(value) : DEFAULT_PERSONAL) }) } catch { this.notify('另一个标签页的设置无法读取，保留当前值。') }
  }
  /* 服务端撤销通过原接头回写并核对当前值，成功后才移除回退按钮。 */
  offerServerUndo(run: () => Promise<void>): void { this.undoServer = run; this.previous = null; this.publish({ ...this.snapshot, canUndo: false, serverUndo: true }) }
  async undoLast(): Promise<void> {
    const run = this.undoServer
    if (!run) { this.undo(); return }
    await run()
    if (this.undoServer === run) { this.undoServer = null; this.publish({ ...this.snapshot, serverUndo: false, notice: '已撤销上次提醒调整，当前 DOT 的设备共用。' }) }
  }
  notify(notice: string): void { this.publish({ ...this.snapshot, notice }) }
  private publish(value: PersonalState): void { this.snapshot = value; for (const listener of this.listeners) listener() }
}
