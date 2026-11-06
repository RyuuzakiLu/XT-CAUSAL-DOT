/**
 * @xtcausal/dot-greeting —— 每天早上一条主动问候（用户 2026-11-01 批）
 *
 * ▍这是什么
 *   账号前台实例里的一个宿主插件。每分钟看一眼本账号的问候偏好（存在知序 /postbox/greeting，默认关、08:00）：
 *   到点 → 去知序认领"今天"（同一天至多一次，重启不重发）→ 往用户当前的对话里投一条 source.kind = 'dot-greeting'
 *   的触发消息（agent.followup，和原生定时提醒 dsh-schedule 同一条路），模型照常跑一个回合，回复就是对话里一条
 *   普通的助手消息，用户可以直接接着回；回合结束后把回复写成一封星邮匣信（走原来的通知路径；免打扰时只进匣不弹）。
 *
 * ▍资料从哪来（全部走本户自己的钥匙路径，不用共享钥匙）
 *   日程：本户 DOT_ZHIXU_KEY 调知序只读工具 zhixu_today_agenda；
 *   天气：只有偏好里填了 location 且保密服务里有和风凭据时才查（经 broker 代调，计数和缓存照旧），
 *         没凭据/任何失败都静默跳过，【不】弹填写表单；
 *   人格、名字、称呼：真发时由 dot-persona 每轮组装系统提示现读；触发消息里另带一次称呼（现读）；
 *   多久没聊：dot-turn-context 的账本（$DSH_HOME/dot-cloud/auto-memory-state.json）里真实用户发言的最近时间。
 *   模型调用走实例原本的通道（账号进程里只有占位钥匙，真钥匙在 dot-keyproxy）。
 *
 * ▍界面标记
 *   触发消息：user/message.source = { kind: 'dot-greeting', proactive: true, date: 'YYYY-MM-DD' }。
 *   它后面那一回合的助手回复就是主动消息（界面以后据此显示粉色「主动」小标签）。现在原生聊天视图会把这条
 *   触发消息显示成一个折叠的"唤醒"小条（和定时提醒一样），隐藏/改样式要动界面，留给界面那一轮。
 *
 * ▍试运行（不发）
 *   POST /dot-greeting/api/dry-run（只认登录门转来的本户请求）：现查资料、拼触发消息，按本户人格直接调一次模型生成
 *   正文，返回并写日志；【不】碰任何会话、不认领、不写信。默认把"现在"模拟成今天的问候时间，?now=1 用真实时间。GET /dot-greeting/api/status 看偏好、最近一次和下一步。
 *
 * ▍修改铁律
 *   1. 先认领再投递：认领失败（已发过）就不投；投递后失败也不放回认领（宁可少一条，不重复）。
 *   2. 【不】在问候里调用工具（尤其 dot_weather：没凭据会给用户弹表单）；资料由本插件先查好写进触发消息。
 *   3. 【不】另发"很久没聊"的消息：只并进当天这一条。
 *   更新：2026-11-01 · 首版（Hark）
 *   更新：2026-11-06 · 早晚报（DOT_BRIEF=1 才装，见 brief.js）；开了早晚报的账号问候 tick 让位给 09:00 早报（Hark）
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  SOURCE_KIND, agendaLines, assistantText, buildTrigger, decide, lastUserAt, letterBody, localParts, pickSession, silenceHours,
} from './core.js'
import { createBrief } from './brief.js'

export const name = 'dot-greeting'
export const inject = ['agents', 'sessions', 'sessionController']
export * from './core.js'
export * from './brief-core.js'

const TICK_MS = 60_000
const FIRST_TICK_MS = 30_000
const REPLY_WAIT_MS = 180_000

function deepFreeze(value) {
  if (value && typeof value === 'object') { for (const v of Object.values(value)) deepFreeze(v); Object.freeze(value) }
  return value
}

/* ---------------- 知序（本户钥匙） ---------------- */
export async function zhixu(method, path, body, fetchImpl = fetch) {
  const base = process.env.DOT_ZHIXU_URL, key = process.env.DOT_ZHIXU_KEY, actor = process.env.DOT_CLOUD_ACCOUNT
  if (!base || !key || !actor) throw new Error('知序未配置')
  const response = await fetchImpl(`${base}${path}`, {
    method,
    headers: { 'x-dot-zhixu-key': key, 'x-dot-actor': actor, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data?.ok !== true) throw new Error(`知序 ${path} 失败（${data?.error?.code ?? `HTTP_${response.status}`}）`)
  return data.data
}
const agendaOf = timeZone => zhixu('POST', '/invoke', { name: 'zhixu_today_agenda', arguments: { timeZone } })

/* ---------------- 天气（可选；任何失败都静默跳过） ---------------- */
export async function weatherOf(location, log) {
  if (typeof location !== 'string' || location.trim() === '') return undefined
  try {
    const { brokerConfigOf, callByPurpose } = await import('../../credentials/lib/broker.js')
    const { formatDaily, parseLocation, todayIn } = await import('../../credentials/lib/weather.js')
    const config = brokerConfigOf()
    if (config === undefined) return undefined
    const qw = async (path, query) => {
      const called = await callByPurpose(config, { purposeKey: 'qweather', path, query })
      if (!called.ok) return undefined /* no-credential / 冷却 / 上限 —— 早安里不提天气就是了 */
      const r = called.value.result ?? {}
      return Number(r.status) >= 200 && Number(r.status) < 300 && (r.body?.code === undefined || String(r.body.code) === '200') ? r.body : undefined
    }
    const geo = await qw('/geo/v2/city/lookup', { location: parseLocation(location).query, number: '1', lang: 'zh' })
    const place = geo?.location?.[0]
    if (!place) return undefined
    const daily = await qw('/v7/weather/3d', { location: String(place.id), lang: 'zh' })
    if (!daily) return undefined
    const today = todayIn(typeof place.tz === 'string' ? place.tz : 'Asia/Shanghai')
    const first = { ...daily, daily: (daily.daily ?? []).filter(d => d.fxDate === today).slice(0, 1) }
    const line = formatDaily(first, today)
    return line ? `${place.name}：${line.replace(/^\S+：/, '')}` : undefined
  } catch (error) {
    log.info?.('早安天气跳过：%s', error instanceof Error ? error.message : String(error))
    return undefined
  }
}

/* ---------------- 本户人格（试运行用；真发走系统提示） ---------------- */
export async function personaOf(actor) {
  try {
    const { readProfile, promptSection } = await import('../../persona/lib/store.js')
    const profile = await readProfile(actor)
    let text = promptSection(profile)
    if (text !== '' && (profile.expanded || profile.brief)) {
      const { loadCore } = await import('../../persona/lib/expand.js')
      const core = await loadCore(profile).catch(() => '')
      if (core) text = `${text}\n\n${core}`
    }
    return { name: profile.name, userName: profile.userName || '', section: text }
  } catch { return { name: 'ASTRA', userName: '', section: '' } }
}

export function stateOf() {
  try {
    const file = process.env.DOT_AUTO_MEMORY_STATE || join(process.env.DSH_HOME || '.', 'dot-cloud', 'auto-memory-state.json')
    const s = JSON.parse(readFileSync(file, 'utf8'))
    return s && typeof s === 'object' ? s : {}
  } catch { return {} }
}

/** 经本实例自己的公开 RPC 入口（同 dot-turn-context：DOT_SELF_KEY，只认本户）。 */
export async function selfRpc(method, args) {
  const argv = process.argv
  const port = Number(argv[argv.indexOf('--port') + 1])
  const origin = argv[argv.indexOf('--public-url') + 1]
  const actor = process.env.DOT_CLOUD_ACCOUNT, key = process.env.DOT_SELF_KEY
  if (!port || !origin || !actor || !key) throw new Error('本实例 RPC 入口参数不全')
  const body = JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload: { args } })
  const d = await new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path: `/api/${method}`, method: 'POST', timeout: 30_000,
      headers: { host: new URL(origin).host, origin, 'x-dot-account': actor, 'x-dot-self-key': key, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { resolve({}) } })
    })
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject); req.end(body)
  })
  if (!d?.result?.ok) throw new Error(`${method} 失败：${String(JSON.stringify(d?.result?.error ?? d)).slice(0, 200)}`)
  return d.result.value
}

/* ---------------- 试运行的模型调用（同 dot-persona 扩写的通道：占位钥匙 → dot-keyproxy） ---------------- */
export async function generatePreview(persona, trigger, opts = {}) {
  const models = (process.env.DOT_PERSONA_MODELS || 'ag/gemini-3.8-flash-high').split(',').map(s => s.trim()).filter(Boolean)
  const base = (process.env.DOT_PERSONA_BASE_URL || '').replace(/\/$/, '')
  const key = process.env.PI_CLOUD_KEY
  if (!base || !key) throw new Error('模型通道未配置')
  const system = ['你是 XTCAUSAL DOT，这位账号使用者的个人助理。说话自然、简短。', persona.section].filter(Boolean).join('\n\n')
  let last
  for (const model of models) {
    try {
      const response = await fetch(`${base}/chat/completions`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: trigger }], temperature: 0.8, max_tokens: Number(opts.maxTokens) || 600, stream: false }),
        signal: AbortSignal.timeout(Number(opts.timeoutMs) || 60_000),
      })
      const data = await response.json().catch(() => ({}))
      const text = data?.choices?.[0]?.message?.content
      if (!response.ok || typeof text !== 'string' || !text.trim()) throw new Error(`模型返回 ${response.status}`)
      return { model, text: text.replace(/<think>[\s\S]*?<\/think>/g, '').trim() }
    } catch (error) { last = error }
  }
  throw last ?? new Error('生成失败')
}

function sameKey(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || provided === '' || expected === '') return false
  const digest = /^sha256:([0-9a-f]{64})$/.exec(expected)
  const x = createHash('sha256').update(provided).digest()
  const y = digest !== null ? Buffer.from(digest[1], 'hex') : createHash('sha256').update(expected).digest()
  return timingSafeEqual(x, y)
}

export function apply(ctx, config = {}) {
  const base = typeof ctx.logger === 'function' ? ctx.logger('dot-greeting') : undefined
  /* ctx.logger 不进 journal；每天只有几行的关键事件同时打到 stdout/stderr（journal 可查），同一条警告一小时内只打一次。 */
  const fmt = (f, a) => { let i = 0; return String(f).replace(/%[sd]/g, () => String(a[i++])) }
  let lastWarn = { text: '', at: 0 }
  const log = {
    info: (f, ...a) => { base?.info?.(f, ...a); console.log(`[dot-greeting] ${fmt(f, a)}`) },
    warn: (f, ...a) => {
      base?.warn?.(f, ...a); const text = fmt(f, a)
      if (text !== lastWarn.text || Date.now() - lastWarn.at > 3_600_000) { lastWarn = { text, at: Date.now() }; console.warn(`[dot-greeting] ${text}`) }
    },
  }
  const actor = process.env.DOT_CLOUD_ACCOUNT
  if (process.env.DOT_ROLE !== 'front' || !actor || !process.env.DOT_ZHIXU_KEY) { base?.info?.('主动问候：不是账号前台实例，不启用'); return }
  const KEY = Symbol.for('dot.greeting')
  if (globalThis[KEY]) { log.warn?.('主动问候已有一份在跑，跳过重复装配'); return }
  globalThis[KEY] = true
  const workSessions = () => (globalThis[Symbol.for('dot.work.sessions')] instanceof Set ? globalThis[Symbol.for('dot.work.sessions')] : new Set())

  /* 等某条触发消息那一回合的回复。 */
  const waiters = new Map() // sessionId -> {messageId, seen, texts, resolve}
  const off = ctx.on('session/event', (session, event) => {
    const w = waiters.get(session?.id)
    if (!w) return
    try {
      if (event?.type === 'user/message' && String(event.data?.id) === String(w.messageId)) w.seen = true
      else if (w.seen && event?.type === 'assistant/message') { const t = assistantText(event); if (t) w.texts.push(t) }
      else if (w.seen && event?.type === 'turn/end') { waiters.delete(session.id); w.resolve(w.texts.join('\n').trim()) }
    } catch { /* 不影响会话 */ }
  })
  function waitReply(sessionId, messageId) {
    return new Promise(resolve => {
      const timer = setTimeout(() => { waiters.delete(sessionId); resolve('') }, REPLY_WAIT_MS)
      timer.unref?.()
      waiters.set(sessionId, { messageId, seen: false, texts: [], resolve: text => { clearTimeout(timer); resolve(text) } })
    })
  }

  /** 现查资料、拼触发消息（真发和试运行共用）。 */
  async function prepare(prefs, now) {
    const zone = prefs.timezone || 'Asia/Shanghai'
    const parts = localParts(now, zone)
    let agenda = [], agendaError = false
    try { agenda = agendaLines(await agendaOf(zone), zone) } catch (error) { agendaError = true; log.warn('早安日程没查到：%s', error instanceof Error ? error.message : String(error)) }
    const weather = await weatherOf(prefs.location, log)
    const state = stateOf()
    const silence = silenceHours(lastUserAt(state), now)
    const persona = await personaOf(actor)
    const trigger = buildTrigger({ parts, timezone: zone, agenda, agendaError, weather, silence, userName: persona.userName })
    return { parts, agenda, agendaError, weather: weather ?? null, silenceHours: silence === undefined ? null : Math.round(silence), persona, trigger, state }
  }

  async function chooseSession(state) {
    let list = []
    const sid0 = pickSession({ state, list: [], skip: workSessions() })
    if (sid0) return sid0
    try { list = (await selfRpc('session/list', { _request: {} }))?.items ?? [] } catch (error) { log.warn?.('早安取会话目录失败：%s', error instanceof Error ? error.message : String(error)) }
    return pickSession({ state: {}, list, skip: workSessions() })
  }

  /** 真发：认领 → 投递 → 等回复 → 写信。 */
  async function send(prefs, date, now) {
    const prep = await prepare(prefs, now)
    const sessionId = await chooseSession(prep.state)
    if (!sessionId) {
      const c = await zhixu('POST', '/postbox/greeting/claim', { date })
      if (c.claimed) await zhixu('POST', '/postbox/greeting/finish', { date, status: 'failed', detail: 'no-session' })
      log.warn?.('主动问候 %s：本账号还没有对话，今天跳过', date); return
    }
    const resolved = await ctx.sessionController.resolveAgent(sessionId)
    if (!resolved || 'error' in resolved) throw resolved?.error ?? new Error('取不到会话')
    const claim = await zhixu('POST', '/postbox/greeting/claim', { date })
    if (!claim.claimed) { log.info?.('主动问候 %s 已经发过（知序认领在先），不重复', date); return }
    const message = deepFreeze({
      role: 'user',
      content: [{ type: 'text', text: prep.trigger }],
      source: { kind: SOURCE_KIND, proactive: true, date },
      id: randomUUID(),
    })
    const reply = waitReply(sessionId, message.id)
    try {
      const deliver = async () => {
        resolved.agent.followup(message)
        if (typeof ctx.sessions?.flush === 'function' && !await ctx.sessions.flush(resolved.agent.session)) throw new Error('会话没有确认落盘')
      }
      if (typeof ctx.agents?.withoutInitiator === 'function') await ctx.agents.withoutInitiator(deliver)
      else await deliver()
    } catch (error) {
      waiters.delete(sessionId)
      await zhixu('POST', '/postbox/greeting/finish', { date, status: 'failed', detail: String(error?.message ?? error).slice(0, 200) }).catch(() => {})
      throw error
    }
    log.info?.('主动问候 %s：已投进会话 %s（消息 %s），等回复', date, sessionId, message.id)
    const text = await reply
    const done = await zhixu('POST', '/postbox/greeting/finish', { date, status: 'sent', title: `早安 · ${prep.persona.name || 'DOT'}`, body: letterBody(text) || undefined, detail: text ? `session:${sessionId}` : `session:${sessionId};no-reply-in-${REPLY_WAIT_MS / 1000}s` })
    log.info?.('主动问候 %s：%s；星邮匣信 %s%s', date, text ? `回复 ${text.length} 字` : '没等到回复（信用默认正文）', done?.letter?.id ?? '-', done?.letter?.suppressed ? `（${done.letter.reason}，不弹）` : '')
  }

  let busy = false
  let quietDate = null
  let failures = { date: null, n: 0 }
  /* brief-2026-11-06：开了早晚报的账号，早安问候由 09:00 早报接替（早报认领知序问候同一天、写信），问候 tick 不再自己发。 */
  const BRIEF_ON = process.env.DOT_BRIEF === '1'
  async function tick() {
    if (busy || BRIEF_ON) return
    busy = true
    try {
      const now = Date.now()
      const g = await zhixu('GET', '/postbox/greeting')
      const d = decide({ now, prefs: g.preferences, lastDate: g.last?.date ?? null })
      if (d.action === 'skip') {
        if (quietDate === d.date) return
        quietDate = d.date
        const c = await zhixu('POST', '/postbox/greeting/claim', { date: d.date })
        if (c.claimed) await zhixu('POST', '/postbox/greeting/finish', { date: d.date, status: 'skipped', detail: 'missed-window' })
        log.info?.('主动问候 %s：已过补发窗口（机器停着错过了），今天跳过', d.date)
        return
      }
      if (d.action !== 'send') return
      if (failures.date === d.date && failures.n >= 3) return
      await send(g.preferences, d.date, now)
    } catch (error) {
      const today = new Date().toISOString().slice(0, 10)
      failures = failures.date === today ? { date: today, n: failures.n + 1 } : { date: today, n: 1 }
      log.warn?.('主动问候这一轮没成：%s', error instanceof Error ? error.message : String(error))
    } finally { busy = false }
  }

  /* 试运行 / 状态接口：只认登录门转来的本户请求。 */
  let lastDry = 0
  const lastBriefDry = {}
  const brief = BRIEF_ON ? createBrief({ zhixu, selfRpc, personaOf, stateOf, weatherOf, generate: generatePreview, ctx, log, actor }) : null
  const handler = async (req, res) => {
    const reply = (status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(body)) }
    try {
      const who = String(req.headers['x-dot-account'] ?? '')
      if (!sameKey(String(req.headers['x-dot-gateway-key'] ?? ''), process.env.DOT_GATEWAY_KEY) || who === '' || who !== actor) return reply(403, { error: '未登录' })
      const path = (req.url ?? '').split('?')[0]
      if (path === '/dot-greeting/api/status' && req.method === 'GET') {
        const g = await zhixu('GET', '/postbox/greeting')
        return reply(200, { ...g, decision: decide({ now: Date.now(), prefs: g.preferences, lastDate: g.last?.date ?? null }) })
      }
      if (path.startsWith('/dot-greeting/api/brief/')) {
        if (!brief) return reply(404, { error: '本账号没开早晚报（DOT_BRIEF=1）' })
        if (path === '/dot-greeting/api/brief/status' && req.method === 'GET') return reply(200, brief.status())
        if (path === '/dot-greeting/api/brief/dry-run' && req.method === 'POST') {
          const q = new URL(req.url ?? '/', 'http://local').searchParams
          const slot = q.get('slot') === 'evening' ? 'evening' : 'morning'
          if (Date.now() - (lastBriefDry[slot] ?? 0) < 60_000) return reply(429, { error: '同一时段一分钟内只能试一次' })
          lastBriefDry[slot] = Date.now()
          const out = await brief.dryRun(slot, { simulate: q.get('now') !== '1' })
          log.info?.('早晚报试运行（未发送）：%s，模型 %s，%s 字', slot, out.model ?? '-', out.text.length)
          return reply(200, out)
        }
        /* brief2：立即发一份（不占当天认领）。force=1 只有飞书桥替本户主人的 /早报 /晚报 指令带（同一把网关钥匙进门），可越过 23–08 安静时段。 */
        if (path === '/dot-greeting/api/brief/now' && req.method === 'POST') {
          const q = new URL(req.url ?? '/', 'http://local').searchParams
          const slot = q.get('slot')
          if (slot !== 'morning' && slot !== 'evening') return reply(400, { error: 'slot 只能是 morning 或 evening' })
          const out = brief.now(slot, { force: q.get('force') === '1' })
          if (!out.accepted) return reply(out.code ?? 409, { accepted: false, reason: out.reason, ...(out.retryAfterSec ? { retryAfterSec: out.retryAfterSec } : {}) })
          log.info?.('早晚报立即发：%s 已受理（%s）', slot, out.forced ? '强制' : '普通')
          return reply(202, { accepted: true, slot: out.slot, date: out.date, forced: out.forced })
        }
        return reply(404, { error: '没有这个接口' })
      }
      if (path === '/dot-greeting/api/dry-run' && req.method === 'POST') {
        if (Date.now() - lastDry < 60_000) return reply(429, { error: '一分钟内只能试一次' })
        lastDry = Date.now()
        const g = await zhixu('GET', '/postbox/greeting')
        const now = Date.now()
        /* 默认按"今天的问候时间"模拟（凌晨试跑时模型不会去说"现在才一点"）；?now=1 用真实时间。 */
        const realTime = new URL(req.url ?? '/', 'http://local').searchParams.get('now') === '1'
        const zone = g.preferences.timezone || 'Asia/Shanghai'
        const simNow = realTime ? now : now - (localParts(now, zone).minute - (Number.isInteger(g.preferences.minute) ? g.preferences.minute : 480)) * 60_000
        const prep = await prepare({ ...g.preferences, enabled: true }, simNow)
        const sessionId = await chooseSession(prep.state)
        const out = await generatePreview(prep.persona, prep.trigger)
        log.info?.('主动问候试运行（未发送）：会话 %s，模型 %s，正文：%s', sessionId ?? '-', out.model, out.text.replace(/\s+/g, ' ').slice(0, 400))
        return reply(200, {
          dryRun: true, sent: false, wouldSendTo: sessionId ?? null, simulatedTime: realTime ? null : `${prep.parts.date} ${prep.parts.hhmm}`,
          decisionNow: decide({ now, prefs: g.preferences, lastDate: g.last?.date ?? null }),
          preferences: g.preferences, last: g.last,
          agenda: prep.agenda, agendaError: prep.agendaError, weather: prep.weather, silenceHours: prep.silenceHours,
          persona: { name: prep.persona.name, userName: prep.persona.userName, hasSection: prep.persona.section !== '' },
          source: { kind: SOURCE_KIND, proactive: true, date: prep.parts.date },
          trigger: prep.trigger, model: out.model, text: out.text, letterBody: letterBody(out.text),
        })
      }
      return reply(404, { error: '没有这个接口' })
    } catch (error) {
      log.warn?.('主动问候接口出错：%s', error instanceof Error ? error.message : String(error))
      return reply(500, { error: String(error?.message ?? error).slice(0, 200) })
    }
  }
  if (typeof ctx.inject === 'function') ctx.inject(['webServer'], scope => scope.effect(() => scope.webServer.register({ kind: 'prefix', path: '/dot-greeting/api', handler }), 'dot-greeting: 试运行/状态接口'))

  if (brief) {
    const bFirst = setTimeout(brief.tick, Number(config.firstTickMs) || FIRST_TICK_MS)
    const bTimer = setInterval(brief.tick, Number(config.tickMs) || TICK_MS)
    bFirst.unref?.(); bTimer.unref?.()
    ctx.effect?.(() => () => { clearTimeout(bFirst); clearInterval(bTimer); brief.dispose() }, 'dot-greeting: 早晚报定时')
    log.info?.('早晚报：已启用（09:00 早报 / 21:00 晚报，飞书私聊优先；早安问候由早报接替）')
  }
  const first = setTimeout(tick, Number(config.firstTickMs) || FIRST_TICK_MS)
  const timer = setInterval(tick, Number(config.tickMs) || TICK_MS)
  first.unref?.(); timer.unref?.()
  log.info?.('主动问候：已启用（每分钟看一次本户偏好；开关和时间在知序 /postbox/greeting）')
  ctx.effect?.(() => () => { clearTimeout(first); clearInterval(timer); off?.(); delete globalThis[KEY] }, 'dot-greeting: 定时')
}
