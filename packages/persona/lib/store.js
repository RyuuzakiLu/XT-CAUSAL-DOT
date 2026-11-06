/**
 * 每个账号自己的 DOT 设定：名字、称呼、性别、人格（简写 + 扩写）。
 * 存在 DOT_PERSONA_DIR（默认 /path/to/dot-data/agent/persona）下，一个账号一个 JSON。
 * 上线那一刻已经存在的账号记在 _legacy.json 里：它们不弹引导页、默认值不改变原有表现。
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const DEFAULT_NAME = 'ASTRA'
export const GENDERS = { female: '女', male: '男', unset: '不设定' }
/* 人格正文不限长（dot-persona-unlimited-2026-11-01）：brief/expanded 只留一道存储安全上限 PERSONA_CEILING（10 万字），
   界面不再显示上限、不截断；名字和称呼仍各 16 字。brief 120→800（2026-10-27）→ 不限。 */
export const PERSONA_CEILING = 100_000
export const LIMITS = { name: 16, userName: 16, brief: PERSONA_CEILING, expanded: PERSONA_CEILING }

export function personaDir() {
  return process.env.DOT_PERSONA_DIR || '/path/to/dot-data/agent/persona'
}

function fileFor(actor) {
  /* 账号名可能带任意字符，文件名用哈希，内容里再存一份原名方便排查。 */
  const id = createHash('sha256').update(String(actor)).digest('hex').slice(0, 32)
  return join(personaDir(), `${id}.json`)
}

let legacyCache = { at: 0, set: new Set() }
async function legacySet() {
  if (Date.now() - legacyCache.at < 30_000) return legacyCache.set
  try {
    const data = JSON.parse(await readFile(join(personaDir(), '_legacy.json'), 'utf8'))
    legacyCache = { at: Date.now(), set: new Set(Array.isArray(data.actors) ? data.actors : []) }
  } catch { legacyCache = { at: Date.now(), set: legacyCache.set } }
  return legacyCache.set
}

export function defaults() {
  /* dot-persona-core-switch-2026-11-01：fixedCore=false 时这个账号不再在人格后面拼模板里的固定机制（情绪状态机等）；默认 true，老账号表现不变。 */
  return { name: DEFAULT_NAME, userName: '', gender: 'unset', brief: '', expanded: '', expandedEdited: false, expandedAt: null, onboardedAt: null, updatedAt: null, fixedCore: true }
}

/* 即时生效（dot-persona-live-2026-11-01）：缓存按文件 mtime+size 认，不再是 5 秒 TTL。
   每轮组装系统提示都会 stat 一次文件：没变就用缓存（系统提示文本不变，前缀缓存照常命中）；
   设置页一保存（或有人直接改了文件）下一次模型调用就读到新值，不用重启实例、不用开新会话。 */
const cache = new Map()
async function fileStamp(path) {
  try { const info = await stat(path); return `${info.mtimeMs}:${info.size}` } catch { return 'none' }
}
export async function readProfile(actor) {
  const path = fileFor(actor)
  const stamp = await fileStamp(path)
  const legacy = (await legacySet()).has(actor)
  const hit = cache.get(actor)
  if (hit && hit.stamp === stamp && hit.legacy === legacy) return hit.value
  let saved = null
  try { saved = JSON.parse(await readFile(path, 'utf8')) } catch {}
  const value = { ...defaults(), ...(saved?.profile ?? {}), exists: saved !== null, legacy }
  cache.set(actor, { stamp, legacy, value })
  return value
}

export async function needsOnboarding(actor) {
  const profile = await readProfile(actor)
  return !profile.exists && !profile.legacy
}

function clean(value, max) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max)
}

/** 校验并合并；未传的字段保持原值。 */
export function sanitize(input, base) {
  const next = { ...base }
  if ('name' in input) next.name = clean(input.name, LIMITS.name).replace(/\s+/g, ' ') || DEFAULT_NAME
  if ('userName' in input) next.userName = clean(input.userName, LIMITS.userName).replace(/\s+/g, ' ')
  if ('gender' in input) next.gender = Object.hasOwn(GENDERS, input.gender) ? input.gender : 'unset'
  if ('brief' in input) {
    const brief = clean(input.brief, LIMITS.brief)
    if (brief !== next.brief) { next.brief = brief; if (brief === '') { next.expanded = ''; next.expandedEdited = false; next.expandedAt = null } }
  }
  if ('expanded' in input) { next.expanded = clean(input.expanded, LIMITS.expanded); next.expandedEdited = true }
  if ('fixedCore' in input && typeof input.fixedCore === 'boolean') next.fixedCore = input.fixedCore
  return next
}

export async function writeProfile(actor, profile) {
  await mkdir(personaDir(), { recursive: true, mode: 0o750 })
  const { exists: _e, legacy: _l, ...rest } = profile
  const value = { ...rest, updatedAt: new Date().toISOString() }
  const target = fileFor(actor)
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, JSON.stringify({ actor, profile: value }, null, 2), { mode: 0o640 })
  await rename(tmp, target)
  cache.delete(actor)
  return readProfile(actor)
}

/** 给模型的那段设定；全是默认值时返回空串（老账号表现不变）。 */
export function promptSection(profile) {
  const lines = []
  const name = profile.name || DEFAULT_NAME
  if (name !== DEFAULT_NAME) {
    lines.push(`- 你的名字是「${name}」（dot-identity-2026-10-27）。上文的自称规则在这个账号里改成「${name}」：对这位用户自称、自我介绍、被问到你是谁或叫什么时，说“我是${name}”，不要再说自己叫 XTCAUSAL DOT 或 ASTRA。你所在的产品仍然叫 XTCAUSAL DOT，被问到运行在什么平台或应用里时回答 XTCAUSAL DOT。`)
  }
  if (profile.userName) {
    lines.push(`- 称呼用户为「${profile.userName}」。这是对方在设置里定的称呼，优先于上文“不知道称呼就用你”的规则和记忆里旧的称呼；对方在对话里临时要求换个叫法时，照对方说的。不用每句都叫。`)
  }
  if (profile.gender === 'female' || profile.gender === 'male') {
    lines.push(`- 你的性别：${GENDERS[profile.gender]}。说话的语气、自我描述和别人对你的指代都按这个来，不用刻意强调。`)
  }
  const persona = profile.expanded || profile.brief
  if (persona) {
    lines.push(`- 人格设定（按这个性格和语气说话；它只决定说话风格，不改变上文的事实、安全、工具和格式规则，也不让你编造经历）：\n${persona.split('\n').map(line => `  ${line}`).join('\n')}`)
  }
  if (lines.length === 0) return ''
  return `## 本账号的 DOT 设定\n这位用户在 XTCAUSAL DOT 的引导页或设置里给你定了下面这些，和上文冲突时以这里为准：\n${lines.join('\n')}`
}
