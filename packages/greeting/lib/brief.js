/**
 * @xtcausal/dot-greeting · 早晚报运行区（用户 2026-11-06 批；只在 DOT_BRIEF=1 的账号前台实例里跑）
 *
 * ▍这是什么
 *   每天 09:00 早报、21:00 晚报，发到用户的飞书私聊（经飞书桥现有的 POST /relay，每户 HMAC 钥匙）。
 *   资料全部由这里的确定性代码查好（知序日程/待办、dotWork 后台工作、飞书群记录文件、豆包搜索新闻、可选天气），
 *   模型只在最后一轮写字：桥收到 relay 后在本户的飞书私聊会话里跑这一轮（人格/称呼由系统提示现读），再发卡片。
 *   找不到可用的飞书私聊会话时退回 App：像早安问候一样投进用户当前对话（agent.followup）。
 *
 * ▍开关
 *   - 账号级：systemd drop-in 75-dot-brief.conf 设 DOT_BRIEF=1（只有 b181）；不设就整块不装。
 *   - 临时关：在 $DSH_HOME/dot-cloud/brief/ 下放一个名为 off 的文件（不用重启），删掉恢复。
 *   - 开启后本账号的 08:00 早安问候由早报接替（问候 tick 不再自己发；早报认领知序问候同一天，写星邮匣信）。
 *
 * ▍铁律
 *   1. 先认领再投递（$DSH_HOME/dot-cloud/brief/<日期>-<时段>.json，O_EXCL）；投递失败也不放回。
 *   2. 23:00–08:00 不发；免打扰时早报可在结束后补到 11:00，晚报直接跳过（15 分钟抖动宽限）。
 *   3. 只往「确定是私聊」的会话 relay（最近记录里有群聊标记的一律不选），绝不让早晚报落进群。
 *   4. 豆包搜索每份最多 3 次（晚报 1 次）；失败就不写新闻版块。
 *   5. 不给这一轮任何"必须用工具"的理由：资料全写进触发消息。
 *   更新：2026-11-06 · 首版（Hark）
 *   更新：2026-11-06 · brief2：投递改用桥 /relay 的 kind:'brief'（桥自己找本户绑定的私聊会话、出早晚报专用卡），
 *         不再借 work-brief-… 编号、不再在实例里猜会话；新增 now(slot,{force})（立即发一份，不占当天认领；
 *         非强制时守 23–08 安静时段；每时段 10 分钟最多一次）——给 POST /dot-greeting/api/brief/now 和飞书 /早报 /晚报 用。
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, writeFileSync, writeSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { localParts, pickSession } from './core.js'
import {
  BRIEF_MARK, SLOTS, addDays, buildBriefTrigger, classifyTodos, dayStartMs, decideSlot, groupDigest, groupLabel,
  groupMentions, hasGroupMarks, inQuietHours, pickNews, pickNewsQueries, reconcile, scheduleLines, snapshotOf, todoLine, worksSince,
} from './brief-core.js'

export const BRIEF_SOURCE_KIND = 'dot-brief'
const ZONE = 'Asia/Shanghai'
const REPLY_WAIT_MS = 240_000
const GROUP_DIR = '飞书群记录'
export const NOW_THROTTLE_MS = 10 * 60_000

export function briefDir(env = process.env) { return join(env.DSH_HOME || '.', 'dot-cloud', 'brief') }

/* ---------------- 认领 / 快照（本户 DSH_HOME，重启不丢） ---------------- */
export function claimFile(dir, date, slot) { return join(dir, `${date}-${slot}.json`) }
export function isClaimed(dir, date, slot) { return existsSync(claimFile(dir, date, slot)) }
export function claimSlot(dir, date, slot, now = Date.now()) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  let fd
  try { fd = openSync(claimFile(dir, date, slot), 'wx', 0o600) } catch (e) { if (e?.code === 'EEXIST') return false; throw e }
  try { writeSync(fd, JSON.stringify({ date, slot, status: 'claimed', claimedAt: now })) } finally { closeSync(fd) }
  return true
}
export function finishSlot(dir, date, slot, fields) {
  const f = claimFile(dir, date, slot)
  let cur = {}
  try { cur = JSON.parse(readFileSync(f, 'utf8')) } catch {}
  const tmp = `${f}.tmp`
  writeFileSync(tmp, JSON.stringify({ ...cur, ...fields, doneAt: Date.now() }), { mode: 0o600 })
  renameSync(tmp, f)
}
function readJson(f) { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return undefined } }

/* ---------------- 豆包搜索（直连火山引擎联网搜索 API，钥匙来自本户 drop-in 注入的环境变量） ---------------- */
export async function doubaoSearch(query, { fetchImpl = fetch, env = process.env, count = 6, timeRange = 'OneDay' } = {}) {
  const key = env.ASK_ECHO_SEARCH_INFINITY_API_KEY
  if (!key) throw new Error('豆包搜索未配置')
  const r = await fetchImpl('https://open.feedcoopapi.com/search_api/web_search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'x-traffic-tag': 'dot_brief' },
    body: JSON.stringify({ Query: String(query).slice(0, 100), SearchType: 'web', Count: count, TimeRange: timeRange, Filter: { NeedUrl: true } }),
    signal: AbortSignal.timeout(20_000),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j?.ResponseMetadata?.Error) throw new Error(`豆包搜索 HTTP ${r.status} ${String(j?.ResponseMetadata?.Error?.Code ?? '')}`)
  return Array.isArray(j?.Result?.WebResults) ? j.Result.WebResults : []
}

/* ---------------- 群记录文件 ---------------- */
function groupDays(root, dates) {
  const out = []
  let dirs = []
  try { dirs = readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name) } catch { return out }
  for (const g of dirs) {
    for (const date of dates) {
      const f = join(root, g, `${date}.md`)
      try {
        if (!existsSync(f) || statSync(f).size > 8e6) continue
        const lines = readFileSync(f, 'utf8').split('\n').filter(l => l.trim())
        if (lines.length) out.push({ group: groupLabel(g), dir: g, date, lines })
      } catch {}
    }
  }
  return out
}

/**
 * createBrief(deps)：deps 由 index.js 传入（同一份钥匙路径）：
 *   zhixu(method,path,body) / selfRpc(method,args) / personaOf(actor) / stateOf() / weatherOf(location,log) / generate(persona,trigger,opts)
 *   ctx（插件上下文）/ log / actor / env / fetchImpl / now()
 */
export function createBrief(deps) {
  const { zhixu, selfRpc, personaOf, stateOf, weatherOf, generate, ctx, log, actor } = deps
  const env = deps.env ?? process.env
  const fetchImpl = deps.fetchImpl ?? fetch
  const clock = deps.now ?? (() => Date.now())
  const dir = deps.dir ?? briefDir(env)
  const groupRoot = deps.groupRoot ?? join(process.cwd(), GROUP_DIR)
  const workSessions = () => (globalThis[Symbol.for('dot.work.sessions')] instanceof Set ? globalThis[Symbol.for('dot.work.sessions')] : new Set())

  const invoke = (name, args) => zhixu('POST', '/invoke', { name, arguments: args })
  async function allTasks() {
    const items = []
    let cursor
    for (let i = 0; i < 5; i += 1) {
      const d = await invoke('zhixu_list_tasks', { timeZone: ZONE, limit: 100, ...(cursor ? { cursor } : {}) })
      items.push(...(d?.items ?? []))
      cursor = d?.nextCursor
      if (!cursor) break
    }
    return items
  }

  /** 当天第一次看到就拍一张待办快照（晚上对账用）。 */
  async function ensureSnapshot(now) {
    const date = localParts(now, ZONE).date
    const f = join(dir, `tasks-${date}.json`)
    if (existsSync(f)) return readJson(f)
    const snap = snapshotOf(await allTasks(), now)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    writeFileSync(f, JSON.stringify(snap), { mode: 0o600 })
    return snap
  }

  async function dndOf() {
    const d = await zhixu('GET', '/postbox/preferences')
    return (d?.preferences ?? d)?.dnd
  }

  function ownerTail(state) {
    if (/^[0-9a-z]{6}$/.test(env.DOT_BRIEF_FEISHU_OWNER_TAIL ?? '')) return env.DOT_BRIEF_FEISHU_OWNER_TAIL
    for (const s of Object.values(state?.sessions ?? {})) for (const r of s?.recent ?? []) {
      const m = /本群主人是飞书ID ou_[0-9a-z]*([0-9a-z]{6})\b/.exec(String(r?.text ?? '')); if (m) return m[1]
    }
    return undefined
  }

  async function interestCorpus(state) {
    const parts = []
    try {
      const { createCloudEngine } = await import('../../memory/lib/index.js')
      const engine = createCloudEngine({ timeoutMs: 10_000 })
      for (const q of ['兴趣 爱好 关注 喜欢', '在做 项目 产品 工作']) {
        const r = await engine.search(q, { top: 8 }).catch(() => ({ hits: [] }))
        for (const h of r.hits ?? []) parts.push(h.text)
      }
    } catch (error) { log.info?.('早晚报：记忆兴趣没取到（%s），用近期对话和默认', error instanceof Error ? error.message : String(error)) }
    const recent = Object.values(state?.sessions ?? {}).flatMap(s => (s?.recent ?? []).filter(r => r?.role === 'user').map(r => ({ at: Number(r.at) || 0, text: String(r.text ?? '').replace(/（飞书桥备注[\s\S]*?）/g, '').replace(/〔群聊边界[\s\S]*?〕\n/g, '') })))
      .sort((a, b) => b.at - a.at).slice(0, 40).map(r => r.text.slice(0, 300))
    return { text: [...parts, ...recent].join('\n').slice(0, 20_000), memoryHits: parts.length, recentTurns: recent.length }
  }

  async function newsOf(slot, state, errors) {
    if (!env.ASK_ECHO_SEARCH_INFINITY_API_KEY) return { items: [], queries: [], derived: [], skipped: 'no-key' }
    const corpus = await interestCorpus(state)
    const { queries, derived } = pickNewsQueries(corpus.text, slot === 'morning' ? 3 : 1)
    const results = []
    for (const q of queries.slice(0, 3)) {
      try { results.push(await doubaoSearch(q, { fetchImpl, env })) } catch (error) { errors.push(`news:${String(error?.message ?? error).slice(0, 80)}`); results.push([]) }
    }
    const items = pickNews(results, { n: slot === 'morning' ? 5 : 3, now: clock() })
    return { items: items.length >= (slot === 'morning' ? 3 : 1) ? items : [], queries, derived, memoryHits: corpus.memoryHits, recentTurns: corpus.recentTurns, searches: Math.min(queries.length, 3) }
  }

  /** 查资料（确定性）。每个来源单独兜底，失败只记 errors、那一块不写。 */
  async function gather(slot, now) {
    const parts = localParts(now, ZONE)
    const today = parts.date
    const errors = []
    const state = stateOf()
    const persona = await personaOf(actor)
    const safe = async (label, fn, dflt) => { try { return await fn() } catch (error) { errors.push(`${label}:${String(error?.message ?? error).slice(0, 80)}`); return dflt } }
    const agenda = await safe('agenda', () => invoke('zhixu_today_agenda', { timeZone: ZONE }), null)
    const tasks = await safe('tasks', allTasks, null)
    const works = await safe('works', async () => (await selfRpc('dotWork/list', { request: { limit: 100 } }))?.works ?? [], null)
    const g = await safe('greeting-prefs', () => zhixu('GET', '/postbox/greeting'), null)
    const weather = await safe('weather', () => weatherOf(g?.preferences?.location, log), undefined)
    const tail = ownerTail(state)
    const selfBotNames = [persona.name, 'ASTRA', 'Astra'].filter(Boolean)
    const data = { slot, parts, timezone: ZONE, userName: persona.userName || '老板', weather: weather || null, errors }
    const startToday = dayStartMs(now, ZONE)
    if (slot === 'morning') {
      data.schedule = agenda ? scheduleLines(agenda.events, ZONE, today) : []
      data.todos = tasks ? classifyTodos(tasks, now, ZONE) : null
      const since = startToday - 3 * 3_600_000 /* 昨晚 21:00 起 */
      data.works = works ? worksSince(works, since, now) : null
      const yesterday = addDays(today, -1)
      const days = groupDays(groupRoot, [yesterday, today])
      data.mentions = tail ? groupMentions(days, { ownerTail: tail, ownerNames: [], selfBotNames, sinceByDate: { [yesterday]: 21 * 60 } }) : []
      if (!tail) errors.push('mentions:未知主人飞书ID')
    } else {
      const snapshot = readJson(join(dir, `tasks-${today}.json`))
      data.reconcile = tasks && snapshot ? reconcile(snapshot, tasks, now, ZONE) : null
      if (!snapshot) errors.push('reconcile:今天没有早间快照')
      const w = works ? worksSince(works, startToday, now) : null
      data.works = w ? { finished: w.finished, failed: w.failed } : null
      const t = tasks ? classifyTodos(tasks, now, ZONE) : null
      data.blockers = { needYou: [...(w?.needYou ?? []), ...(w?.stuck ?? []).map(x => `${x}（可能卡住）`)], others: [...(t?.waitingOthers ?? []).map(todoLine), ...(w?.queued ?? []).map(x => `${x}（后台排队）`)], overdue: (t?.overdue ?? []).map(todoLine) }
      data.groups = groupDigest(groupDays(groupRoot, [today]), { ownerTail: tail }).slice(0, 6)
      const tStart = new Date(startToday + 86_400_000).toISOString(), tEnd = new Date(startToday + 2 * 86_400_000).toISOString()
      const ev = await safe('tomorrow-events', () => invoke('zhixu_list_events', { timeZone: ZONE, from: tStart, to: tEnd, limit: 50 }), null)
      const tomorrow = addDays(today, 1)
      data.tomorrow = {
        schedule: ev ? scheduleLines(ev.items, ZONE, tomorrow) : [],
        due: tasks ? classifyTodos(tasks, startToday + 86_400_000 + 1, ZONE).dueToday : [],
      }
    }
    const news = await safe('news', () => newsOf(slot, state, errors), { items: [] })
    data.news = news.items
    data.newsMeta = { queries: news.queries ?? [], derivedFromInterests: news.derived ?? [], memoryHits: news.memoryHits ?? 0, recentTurns: news.recentTurns ?? 0, searches: news.searches ?? 0, skipped: news.skipped ?? null }
    return { data, state, persona, greeting: g }
  }

  /* ---------------- 投递 ---------------- */
  /* 等回复：sid 为 null 的是"任意会话"等待（飞书那一轮在哪个会话跑由桥决定），看到带标记的触发消息就钉在那个会话上。 */
  const waiters = new Set() // {sid, label, seen, texts, resolve}
  const off = ctx?.on?.('session/event', (session, event) => {
    let attached = false // 一条触发消息只钉给一个等待者
    for (const w of [...waiters]) {
      if (w.sid !== null && w.sid !== session?.id) continue
      try {
        if (event?.type === 'user/message') {
          const text = (event.data?.content ?? []).map(b => (b?.type === 'text' ? b.text : '')).join('')
          if (!attached && !w.seen && text.includes(BRIEF_MARK) && text.includes(w.label)) { w.seen = true; w.sid = session?.id ?? w.sid; attached = true }
        } else if (w.seen && event?.type === 'assistant/message') {
          const t = (event.data?.message?.content ?? []).map(b => (b?.type === 'text' ? b.text : '')).join('').trim(); if (t) w.texts.push(t)
        } else if (w.seen && event?.type === 'turn/end') { waiters.delete(w); w.resolve(w.texts.join('\n').trim()) }
      } catch {}
    }
  })
  function waitReply(sessionId, label) {
    const w = { sid: sessionId ?? null, label, seen: false, texts: [], resolve: null }
    w.promise = new Promise(resolve => {
      const timer = setTimeout(() => { waiters.delete(w); resolve('') }, REPLY_WAIT_MS)
      timer.unref?.()
      w.resolve = t => { clearTimeout(timer); resolve(t) }
    })
    waiters.add(w)
    return w
  }

  /** brief2：交给桥 /relay kind:'brief'（桥按本户绑定找私聊会话、出早晚报卡；nonce 区分「立即发」的那几份）。 */
  async function relayBrief(fields) {
    const url = env.DOT_FEISHU_RELAY_URL, key = env.DOT_FEISHU_RELAY_KEY
    if (!url || !key) throw new Error('飞书 relay 未配置')
    const r = await fetchImpl(url, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-dot-relay-key': key },
      body: JSON.stringify({ actor, kind: 'brief', ...fields }), signal: AbortSignal.timeout(15_000),
    })
    const body = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(`relay HTTP ${r.status}`)
    return body
  }

  /** 先飞书私聊（桥自己找会话），桥不认（没绑飞书/出错）就退回 App 当前对话。 */
  async function deliver(slot, date, trigger, state, { nonce = '', name = '' } = {}) {
    const s = SLOTS[slot]
    const tried = []
    const w = waitReply(null, s.label)
    try {
      const res = await relayBrief({ slot, date, text: trigger, ...(nonce ? { nonce } : {}), ...(name ? { name: String(name).slice(0, 20) } : {}) })
      if (res?.handled === true) {
        /* 不按桥报的会话钉死：桥那边会话不存在会重建，触发消息落在哪个会话就跟哪个 */
        if (res.duplicate) waiters.delete(w)
        return { via: 'feishu', sessionId: res.sessionId ?? null, duplicate: res.duplicate === true, reply: res.duplicate ? Promise.resolve('') : w.promise, tried }
      }
      tried.push(`bridge:${res?.reason ?? res?.error ?? 'not-handled'}`)
    } catch (error) { tried.push(`bridge:${String(error?.message ?? error).slice(0, 60)}`) }
    waiters.delete(w)
    /* 退回 App：跟早安问候同一条路，但不选群会话 */
    const skip = new Set([...workSessions(), ...Object.keys(state?.sessions ?? {}).filter(id => hasGroupMarks(state, id))])
    let sessionId = pickSession({ state, list: [], skip })
    if (!sessionId) {
      const list = (await selfRpc('session/list', { _request: {} }).catch(() => ({})))?.items ?? []
      sessionId = pickSession({ state: {}, list, skip })
    }
    if (!sessionId) throw new Error(`没有可投递的会话（飞书：${tried.join(',') || '无私聊候选'}）`)
    const resolved = await ctx.sessionController.resolveAgent(sessionId)
    if (!resolved || 'error' in resolved) throw resolved?.error ?? new Error('取不到会话')
    const { randomUUID } = await import('node:crypto')
    const message = Object.freeze({ role: 'user', content: [{ type: 'text', text: trigger }], source: { kind: BRIEF_SOURCE_KIND, proactive: true, date, slot }, id: randomUUID() })
    const reply = waitReply(sessionId, s.label).promise
    const go = async () => {
      resolved.agent.followup(message)
      if (typeof ctx.sessions?.flush === 'function' && !await ctx.sessions.flush(resolved.agent.session)) throw new Error('会话没有确认落盘')
    }
    if (typeof ctx.agents?.withoutInitiator === 'function') await ctx.agents.withoutInitiator(go); else await go()
    return { via: 'app', sessionId, reply, tried }
  }

  /** 真发一份：认领 → 查资料 → 投递 → 等回复 → 记账（早报另写星邮匣信）。 */
  async function send(slot, date, now) {
    if (!claimSlot(dir, date, slot, now)) { log.info?.('%s %s 已认领过，不重复', SLOTS[slot].label, date); return }
    let greetingClaimed = false
    try {
      if (slot === 'morning') greetingClaimed = (await zhixu('POST', '/postbox/greeting/claim', { date }).catch(() => ({})))?.claimed === true
      const { data, state, persona } = await gather(slot, now)
      const { text, empty } = buildBriefTrigger(slot, data)
      const out = await deliver(slot, date, text, state, { name: persona.name })
      finishSlot(dir, date, slot, { status: 'delivered', via: out.via, sessionId: out.sessionId, empty, errors: data.errors, news: data.news.length, tried: out.tried })
      log.info?.('%s %s：已投递（%s，会话 %s），等回复', SLOTS[slot].label, date, out.via, out.sessionId)
      const replyText = await out.reply
      finishSlot(dir, date, slot, { status: 'sent', replyChars: replyText.length })
      if (greetingClaimed) {
        const { letterBody } = await import('./core.js')
        await zhixu('POST', '/postbox/greeting/finish', { date, status: 'sent', title: `早报 · ${persona.name || 'DOT'}`, body: letterBody(replyText) || undefined, detail: `brief:${out.via}:${out.sessionId}` }).catch(() => {})
      }
      log.info?.('%s %s：%s', SLOTS[slot].label, date, replyText ? `回复 ${replyText.length} 字` : '没等到回复正文（可能仍在发送）')
    } catch (error) {
      finishSlot(dir, date, slot, { status: 'failed', error: String(error?.message ?? error).slice(0, 200) })
      if (greetingClaimed) await zhixu('POST', '/postbox/greeting/finish', { date, status: 'failed', detail: `brief:${String(error?.message ?? error).slice(0, 150)}` }).catch(() => {})
      throw error
    }
  }

  let busy = false
  const quietLogged = new Set()
  async function tick() {
    if (busy) return
    if (existsSync(join(dir, 'off'))) return
    busy = true
    try {
      const now = clock()
      await ensureSnapshot(now).catch(error => log.warn?.('早晚报：待办快照失败：%s', error instanceof Error ? error.message : String(error)))
      let dnd
      for (const slot of ['morning', 'evening']) {
        const date = localParts(now, ZONE).date
        const claimed = isClaimed(dir, date, slot)
        if (claimed) continue
        if (dnd === undefined) dnd = await dndOf().catch(() => null)
        const d = decideSlot({ slot, now, timezone: ZONE, claimed, dnd })
        if (d.action === 'skip') {
          if (claimSlot(dir, d.date, slot, now)) { finishSlot(dir, d.date, slot, { status: 'skipped', reason: d.reason }); log.info?.('%s %s 跳过（%s）', SLOTS[slot].label, d.date, d.reason) }
          if (slot === 'morning') { const c = await zhixu('POST', '/postbox/greeting/claim', { date: d.date }).catch(() => ({})); if (c?.claimed) await zhixu('POST', '/postbox/greeting/finish', { date: d.date, status: 'skipped', detail: `brief:${d.reason}` }).catch(() => {}) }
          continue
        }
        if (d.action === 'hold') { const k = `${d.date}-${slot}`; if (!quietLogged.has(k)) { quietLogged.add(k); log.info?.('%s %s：免打扰中，结束后（11:00 前）补发', SLOTS[slot].label, d.date) } continue }
        if (d.action === 'send') await send(slot, d.date, now)
      }
    } catch (error) {
      log.warn?.('早晚报这一轮没成：%s', error instanceof Error ? error.message : String(error))
    } finally { busy = false }
  }

  /** 试运行：现查资料、拼触发消息、用本户人格直接调一次模型；不认领、不投递、不写信。 */
  async function dryRun(slot, { simulate = true } = {}) {
    const real = clock()
    const s = SLOTS[slot]
    const p = localParts(real, ZONE)
    const now = simulate ? real - (p.minute - s.minute) * 60_000 : real
    const { data, state, persona } = await gather(slot, now)
    const { text, empty } = buildBriefTrigger(slot, data)
    const dnd = await dndOf().catch(() => null)
    let out = { model: null, text: '', error: null }
    try { out = { ...(await generate(persona, text, { maxTokens: 1800 })), error: null } } catch (error) { out.error = String(error?.message ?? error).slice(0, 200) }
    return {
      dryRun: true, sent: false, slot, simulatedTime: simulate ? `${data.parts.date} ${data.parts.hhmm}` : null,
      decisionNow: decideSlot({ slot, now: real, timezone: ZONE, claimed: isClaimed(dir, p.date, slot), dnd }),
      wouldRelayTo: { via: 'bridge', kind: 'brief', note: '桥按本户绑定的飞书私聊会话投；没绑就退回 App 对话' }, empty, data, trigger: text, model: out.model, text: out.text, generateError: out.error,
    }
  }

  /**
   * brief2：立即发一份（POST /dot-greeting/api/brief/now、飞书 /早报 /晚报）。不认领当天时段、不写信、不受 off 文件影响（强制时）。
   * 非强制：23:00–08:00 不发（reason quiet-hours），有 off 文件不发。每时段 10 分钟最多一次（只记已受理的）。
   * 受理后后台跑（查资料要几十秒），返回 { accepted:true } ；完成情况写日志。
   */
  const lastNow = {}, runningNow = new Set()
  function now(slot, { force = false } = {}) {
    if (!SLOTS[slot]) return { accepted: false, code: 400, reason: 'bad-slot' }
    const t = clock()
    if (!force && existsSync(join(dir, 'off'))) return { accepted: false, code: 409, reason: 'off' }
    if (!force && inQuietHours(localParts(t, ZONE).minute)) return { accepted: false, code: 409, reason: 'quiet-hours' }
    if (runningNow.has(slot)) return { accepted: false, code: 429, reason: 'running' }
    if (t - (lastNow[slot] ?? -Infinity) < NOW_THROTTLE_MS) return { accepted: false, code: 429, reason: 'throttled', retryAfterSec: Math.ceil((NOW_THROTTLE_MS - (t - lastNow[slot])) / 1000) }
    lastNow[slot] = t
    runningNow.add(slot)
    const date = localParts(t, ZONE).date
    const nonce = `now-${t.toString(36)}`
    const done = (async () => {
      try {
        const { data, state, persona } = await gather(slot, t)
        const { text, empty } = buildBriefTrigger(slot, data)
        const out = await deliver(slot, date, text, state, { nonce, name: persona.name })
        log.info?.('%s（立即%s）%s：已投递（%s，会话 %s）', SLOTS[slot].label, force ? '·强制' : '', date, out.via, out.sessionId ?? '-')
        const replyText = await out.reply
        log.info?.('%s（立即）%s：%s', SLOTS[slot].label, date, replyText ? `回复 ${replyText.length} 字` : '没等到回复正文（可能仍在发送）')
        return { ok: true, via: out.via, sessionId: out.sessionId, empty, errors: data.errors, replyChars: replyText.length }
      } catch (error) {
        delete lastNow[slot]
        log.warn?.('%s（立即）没发成：%s', SLOTS[slot].label, error instanceof Error ? error.message : String(error))
        return { ok: false, error: String(error?.message ?? error).slice(0, 200) }
      } finally { runningNow.delete(slot) }
    })()
    return { accepted: true, slot, date, forced: Boolean(force), nonce, done }
  }

  function status() {
    const now = clock(), date = localParts(now, ZONE).date
    return {
      enabled: true, off: existsSync(join(dir, 'off')),
      today: Object.fromEntries(['morning', 'evening'].map(slot => [slot, readJson(claimFile(dir, date, slot)) ?? null])),
      snapshot: existsSync(join(dir, `tasks-${date}.json`)),
      delivery: 'bridge kind:brief',
    }
  }

  return { tick, send, now, gather, dryRun, status, deliver, dispose: () => off?.() }
}
export { todoLine }
