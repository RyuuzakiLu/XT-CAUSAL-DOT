/* 云端 DOT 账号设定（名字、称呼、性别、人格）的网页接口。
   后端是 packages/persona（@xtcausal/dot-persona-routes），只在云端登录门后面存在；
   本地 DOT 没有这个接口，读取失败时引导页不出现、设置里提示不可用。 */

export type PersonaGender = 'female' | 'male' | 'unset'
export interface PersonaProfile {
  name: string
  userName: string
  gender: PersonaGender
  brief: string
  expanded: string
  expandedEdited: boolean
  expandedAt: string | null
  onboardedAt: string | null
  updatedAt: string | null
}
export interface PersonaView {
  profile: PersonaProfile
  needsOnboarding: boolean
  defaults: { name: string }
  limits: { name: number; userName: number; brief: number; expanded: number }
  expandError?: string | null
}
export interface PersonaPatch {
  name?: string
  userName?: string
  gender?: PersonaGender
  brief?: string
  expanded?: string
  expandedFromPreview?: boolean
  expand?: boolean
  onboarding?: boolean
}

export const GENDER_OPTIONS: { key: PersonaGender; label: string }[] = [
  { key: 'female', label: '女' },
  { key: 'male', label: '男' },
  { key: 'unset', label: '不设定' },
]

/* 人设按外貌、性格等自由填写；存储仍用 brief 文本，扩写预览不改接口。
   各栏只有灰色占位提示，不提供可点选的性格，旧正文保留在“其他”。 */
export const BRIEF_PLACEHOLDER = '想写什么写什么，比如它的外貌、性格、说话风格、怎么称呼自己和你、口头禅、喜欢什么……\n\n例：银色短发，总别着一枚星星发卡。温柔细心，有点小迷糊。话不多，开心时句尾带“~”。平时自称“我”，叫我“阿龙”。喜欢猫，把记待办叫作“放进小本本”。'

/** 写太少时的提示（不强制）。没写或写够了返回空串。 */
export function thinHint(brief: string): string {
  const text = brief.trim()
  if (text === '') return ''
  const chars = text.replace(/[\s\p{P}\p{S}]/gu, '').length
  if (chars >= 20) return ''
  return '写得有点少，模型只能自己猜，扩写出来的可能不太像你想的。可以再补几句，比如它长什么样、怎么说话、有什么口头禅。不补也能继续。'
}

/** 只扩写不保存：先给用户看一版，满意了再用 savePersona 存。 */
export async function previewPersona(draft: { name: string; userName: string; gender: PersonaGender | ''; brief: string }): Promise<string> {
  const response = await fetch('/dot-persona/api/preview', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ ...draft, gender: draft.gender || 'unset' }) })
  let body: any = null
  try { body = await response.json() } catch {}
  if (!response.ok || typeof body?.expanded !== 'string') throw new Error(typeof body?.error === 'string' ? body.error : `扩写失败（${response.status}）`)
  return body.expanded
}

const BASE = '/dot-persona/api/profile'

async function parse(response: Response): Promise<PersonaView> {
  let body: any = null
  try { body = await response.json() } catch {}
  if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : `读取失败（${response.status}）`)
  return body as PersonaView
}

export async function loadPersona(): Promise<PersonaView> {
  return parse(await fetch(BASE, { credentials: 'same-origin', headers: { accept: 'application/json' }, cache: 'no-store' }))
}

export async function savePersona(patch: PersonaPatch): Promise<PersonaView> {
  const view = await parse(await fetch(BASE, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(patch) }))
  window.dispatchEvent(new CustomEvent('dot-persona:changed', { detail: view.profile }))
  return view
}
