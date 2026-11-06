/**
 * @xtcausal/dot-greeting · 早晚报纯函数区（单测直接调，不碰网络、不碰会话）
 *
 * 口径（用户 2026-11-06 批）：
 *   - 只给开了 DOT_BRIEF=1 的账号（目前只有用户本人 b181）；早报 09:00、晚报 21:00（Asia/Shanghai）；
 *   - 每个时段每天至多一次（认领文件 O_EXCL）；
 *   - 早报：机器停着/免打扰错过了，免打扰结束后可补发到 11:00；晚报不补发（只留 15 分钟抖动宽限）；
 *   - 23:00–08:00 一律不发（他晚上关机），即使没开免打扰；
 *   - 资料全部由确定性代码查好；模型只在最后一轮写字；空的版块不写；什么都没有就一句话。
 */
import { localParts } from './core.js'

export const SLOTS = Object.freeze({
  morning: { minute: 9 * 60, catchUpEnd: 11 * 60, label: '早报', tag: 'am' },
  evening: { minute: 21 * 60, catchUpEnd: 21 * 60 + 15, label: '晚报', tag: 'pm' },
})
export const QUIET_START = 23 * 60
export const QUIET_END = 8 * 60
export const BRIEF_MARK = '〔早晚报·系统定时触发〕'

/** 免打扰判定（与知序 postbox-feed.cjs inDndWindow 同口径）。 */
export function inDnd(dnd, now) {
  if (!dnd || dnd.enabled !== true) return false
  if (Number(dnd.until) > 0) return now < Number(dnd.until)
  const m = localParts(now, dnd.timezone || 'Asia/Shanghai').minute
  const s = Number(dnd.startMinute), e = Number(dnd.endMinute)
  if (!Number.isInteger(s) || !Number.isInteger(e) || s === e) return false
  return s < e ? (m >= s && m < e) : (m >= s || m < e)
}

export function inQuietHours(minute) { return minute >= QUIET_START || minute < QUIET_END }

/**
 * 某时段这一刻该做什么。
 * @returns {action:'wait'|'send'|'skip'|'idle'|'hold', reason, date}
 *   hold = 免打扰中，早报还可能在窗口内补发；skip = 今天这个时段放弃（要记一次认领）
 */
export function decideSlot({ slot, now, timezone = 'Asia/Shanghai', claimed = false, dnd }) {
  const s = SLOTS[slot]
  if (!s) return { action: 'idle', reason: 'bad-slot' }
  const at = localParts(now, timezone)
  if (claimed) return { action: 'idle', reason: 'done-today', date: at.date }
  if (at.minute < s.minute) return { action: 'wait', reason: 'before-time', date: at.date }
  if (inQuietHours(at.minute)) return { action: 'skip', reason: 'quiet-hours', date: at.date }
  if (at.minute >= s.catchUpEnd) return { action: 'skip', reason: 'missed-window', date: at.date }
  if (inDnd(dnd, now)) return slot === 'morning' ? { action: 'hold', reason: 'dnd', date: at.date } : { action: 'skip', reason: 'dnd', date: at.date }
  return { action: 'send', reason: at.minute - s.minute > 5 ? 'late' : 'on-time', date: at.date }
}

/* ---------------- 时间小工具 ---------------- */
const ms = iso => { const t = Date.parse(iso ?? ''); return Number.isFinite(t) ? t : NaN }
export const hhmm = (iso, zone) => (Number.isFinite(ms(iso)) ? localParts(ms(iso), zone).hhmm : '')
export const dayOf = (iso, zone) => (Number.isFinite(ms(iso)) ? localParts(ms(iso), zone).date : '')
/** 某时区某天 00:00 的毫秒（逐小时回退找 00:00，避免依赖 Temporal）。 */
export function dayStartMs(now, zone) {
  const p = localParts(now, zone)
  return now - p.minute * 60_000 - (now % 60_000)
}
export function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t }

/* ---------------- 日程：一行一条，冲突/连轴几个字标出 ---------------- */
/** events: 知序 projectRecord 列表（{data:{title,start,end,location,status}}）。 */
export function scheduleLines(events, zone, today, { gapMin = 10 } = {}) {
  const list = (events ?? []).map(e => e?.data ?? e ?? {}).filter(d => d.status !== 'canceled' && d.start && d.end)
    .map(d => ({ ...d, s: ms(d.start), e: ms(d.end) })).filter(d => Number.isFinite(d.s) && Number.isFinite(d.e))
    .sort((a, b) => a.s - b.s || a.e - b.e)
  const flags = list.map(() => new Set())
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      if (list[j].s < list[i].e) { flags[i].add('冲突'); flags[j].add('冲突') }
      else if (list[j].s - list[i].e <= gapMin * 60_000 && j === i + 1) { flags[i].add('连轴'); flags[j].add('连轴') }
    }
  }
  return list.map((d, i) => {
    const sd = dayOf(d.start, zone), ed = dayOf(new Date(d.e - 1).toISOString(), zone)
    const allDay = today && sd < today && ed > today
    const when = allDay ? '全天' : `${sd === today || !today ? hhmm(d.start, zone) : '前日起'}–${ed === today || !today ? hhmm(d.end, zone) : '次日止'}`
    const f = [...flags[i]]
    return `${when} ${clip(d.title, 40)}${d.location ? `（${clip(d.location, 20)}）` : ''}${f.length ? ` ⚠${f.join('/')}` : ''}`
  })
}

/* ---------------- 待办 ---------------- */
const OPEN = new Set(['pending', 'in_progress'])
const WAIT_OTHERS = /等(待)?.{0,12}(回复|回音|确认|反馈|答复|消息|结果|审批|报价)|waiting\s+(for|on)/i
/** tasks: 知序 list_tasks 的 items（{id,version,data:{title,status,priority,dueAt,remindAt,eventId}}）。事件附带的提醒不算待办。 */
export function classifyTodos(tasks, now, zone) {
  const today = localParts(now, zone).date
  const open = (tasks ?? []).filter(t => t && !t.data?.eventId && OPEN.has(t.data?.status))
  const row = t => {
    const d = t.data, due = d.dueAt ? `${dayOf(d.dueAt, zone) === today ? '' : `${dayOf(d.dueAt, zone).slice(5)} `}${hhmm(d.dueAt, zone)}` : ''
    return { id: t.id, title: clip(d.title, 50), due, important: d.priority === 'important', status: d.status, dueMs: ms(d.dueAt), remindMs: Number.isFinite(ms(d.remindAt)) ? ms(d.remindAt) : Infinity, remindDay: dayOf(d.remindAt, zone) }
  }
  const rows = open.map(row)
  const overdue = rows.filter(r => Number.isFinite(r.dueMs) && r.dueMs < now && dayOf(new Date(r.dueMs).toISOString(), zone) < today)
    .sort((a, b) => a.dueMs - b.dueMs)
  const dueToday = rows.filter(r => (Number.isFinite(r.dueMs) && dayOf(new Date(r.dueMs).toISOString(), zone) === today) || (!Number.isFinite(r.dueMs) && r.remindDay === today))
    .sort((a, b) => (Number.isFinite(a.dueMs) ? a.dueMs : a.remindMs) - (Number.isFinite(b.dueMs) ? b.dueMs : b.remindMs))
  /* 重要前三：标了重要的优先，其次最早到期；排除已列入今天/逾期的也没关系——它就是要你看见的那三件。 */
  const top3 = [...rows].sort((a, b) => (Number(b.important) - Number(a.important)) || ((Number.isFinite(a.dueMs) ? a.dueMs : Infinity) - (Number.isFinite(b.dueMs) ? b.dueMs : Infinity))).slice(0, 3)
  const waitingOthers = rows.filter(r => WAIT_OTHERS.test(r.title))
  return { overdue, dueToday, top3, waitingOthers, openCount: rows.length }
}
export const todoLine = r => `${r.title}${r.due ? `（${r.due}）` : ''}${r.important ? ' [重要]' : ''}${r.status === 'in_progress' ? ' [进行中]' : ''}`

/** 当天快照：{taken, tasks:{id:{status,version}}}。 */
export function snapshotOf(tasks, now) {
  const out = {}
  for (const t of tasks ?? []) if (t?.id && !t.data?.eventId) out[t.id] = { status: t.data?.status, version: t.version }
  return { taken: now, tasks: out }
}
/** 晚上对账：今天做完的、今天该做却没动的。 */
export function reconcile(snapshot, tasks, now, zone) {
  const snap = snapshot?.tasks ?? {}
  const today = localParts(now, zone).date
  const doneToday = [], untouched = [], touched = []
  for (const t of tasks ?? []) {
    if (!t?.id || t.data?.eventId) continue
    const before = snap[t.id], d = t.data ?? {}
    if (d.status === 'done') { if (!before || before.status !== 'done') doneToday.push(clip(d.title, 50)); continue }
    if (!OPEN.has(d.status)) continue
    const due = ms(d.dueAt)
    const relevant = (Number.isFinite(due) && dayOf(d.dueAt, zone) <= today) || dayOf(d.remindAt, zone) === today
    if (!relevant) continue
    if (before && before.version === t.version) untouched.push(clip(d.title, 50))
    else touched.push(clip(d.title, 50))
  }
  return { doneToday, untouched, touched, snapshotAt: snapshot?.taken ?? null }
}

/* ---------------- 后台工作 ---------------- */
const STUCK_MS = 2 * 3_600_000
/** works: dotWork/list 的 works。since: 毫秒。 */
export function worksSince(works, since, now) {
  const out = { finished: [], failed: [], stuck: [], needYou: [], queued: [], running: [] }
  for (const w of works ?? []) {
    const up = ms(w.updatedAt), goal = clip(w.goal, 50)
    if (w.status === 'waiting-input' || w.status === 'waiting-approval') { out.needYou.push(`${goal}：${clip(w.blocked?.message ?? (w.status === 'waiting-approval' ? '等你确认' : '等你补充'), 60)}`); continue }
    if (w.status === 'running') { (Number.isFinite(up) && now - up > STUCK_MS ? out.stuck : out.running).push(`${goal}${w.stage ? `（${clip(w.stage, 30)}）` : ''}`); continue }
    if (w.status === 'queued') { out.queued.push(`${goal}${w.queuedReason ? `（${clip(w.queuedReason, 30)}）` : ''}`); continue }
    if (!(Number.isFinite(up) && up >= since)) continue
    if (w.status === 'succeeded') out.finished.push(`${goal}${w.artifacts?.length ? `（成果：${clip(w.artifacts.map(a => a.title).join('、'), 40)}）` : ''}`)
    else if (w.status === 'failed' || w.status === 'interrupted') out.failed.push(`${goal}：${clip(w.error ?? w.status, 50)}`)
  }
  return out
}

/* ---------------- 飞书群记录 ---------------- */
/** 群记录里的昵称可能是真名：人类一律换成「群友<尾号后4位>」，主人写「你」，机器人保留名字。 */
export function speakerOf(p, ownerTail) { return p.bot ? p.name : (ownerTail && p.tail === ownerTail ? '你' : `群友${String(p.tail).slice(-4)}`) }
const LINE = /^-?\s*(\d{2}:\d{2})\s+(.+?)（([0-9a-zA-Z]{4,8})）：(.*)$/
export function parseGroupLine(raw) {
  const m = LINE.exec(String(raw ?? '').trim())
  if (!m) return null
  return { time: m[1], name: m[2].trim(), tail: m[3], text: m[4], bot: m[2].trim().startsWith('🤖') }
}
/**
 * 跟他有关的群消息：别人 @他（@昵称 / @用户<尾号>）或 @所有人。不含他自己说的、不含本助手（selfBotNames）的。
 * days: [{group, date, lines:[raw]}]；sinceMinuteByDate: {date: 最早分钟}（窗口起点）。
 */
export function groupMentions(days, { ownerTail, ownerNames = [], selfBotNames = [], sinceByDate = {} }) {
  const names = new Set(ownerNames.filter(n => n && n.length >= 2))
  const out = []
  for (const day of days ?? []) {
    /* 他在本群用过的名字也算（文件里他那几行的昵称） */
    const local = new Set(names)
    for (const raw of day.lines) { const p = parseGroupLine(raw); if (p && ownerTail && p.tail === ownerTail && !p.bot) local.add(p.name) }
    for (const raw of day.lines) {
      const p = parseGroupLine(raw)
      if (!p || (ownerTail && p.tail === ownerTail)) continue
      if (selfBotNames.some(n => p.name.replace(/^🤖/, '').toLowerCase() === String(n).toLowerCase())) continue
      const min = Number(p.time.slice(0, 2)) * 60 + Number(p.time.slice(3))
      if (sinceByDate[day.date] !== undefined && min < sinceByDate[day.date]) continue
      const text = p.text
      const hit = (ownerTail && text.includes(`@用户${ownerTail}`)) || /@(所有人|全体成员|all(?![a-z]))/i.test(text) || [...local].some(n => text.includes(`@${n}`))
      if (hit) out.push(`[${day.group} ${day.date.slice(5)} ${p.time}] ${speakerOf(p, ownerTail)}：${clip(text.replace(/ ⏎ /g, ' '), 120)}`)
    }
  }
  return out.slice(-12)
}
/** 晚报每群素材：条数、人类发言人数、最近若干条人类发言（给模型写一两句）。 */
export function groupDigest(days, { maxLines = 25, ownerTail } = {}) {
  return (days ?? []).map(day => {
    const parsed = day.lines.map(parseGroupLine).filter(Boolean)
    const humans = parsed.filter(p => !p.bot)
    const speakers = new Set(humans.map(p => p.tail))
    const sample = (humans.length ? humans : parsed).slice(-maxLines).map(p => `${p.time} ${speakerOf(p, ownerTail)}：${clip(p.text.replace(/ ⏎ /g, ' '), 80)}`)
    return { group: day.group, total: parsed.length, humanLines: humans.length, speakers: speakers.size, sample }
  }).filter(g => g.total > 0)
}
export const groupLabel = dir => String(dir).replace(/-[A-Za-z0-9_-]{6}$/, '') || '群'

/* ---------------- 新闻（豆包搜索） ---------------- */
export const DEFAULT_NEWS_QUERIES = Object.freeze(['AI Agent 智能体 产品 发布', '大模型 新模型 发布 更新', '飞书 AI 工具 新功能'])
const TOPICS = [
  { q: 'AI Agent 智能体 产品 发布', kw: ['agent', '智能体', '助理', '秘书', 'openclaw', 'hermes', 'dot', '工作流'] },
  { q: '大模型 新模型 发布 更新', kw: ['模型', 'deepseek', 'gemini', 'gpt', 'claude', 'glm', 'qwen', '豆包', 'kimi', 'llm', 'mimo'] },
  { q: '飞书 AI 工具 新功能', kw: ['飞书', 'lark', '多维表格', '机器人', '卡片'] },
  { q: 'AI 编程工具 Codex Cursor 更新', kw: ['codex', 'cursor', '编程', '代码', 'claude code', 'copilot', 'ide'] },
  { q: '新能源汽车 智能座舱 新闻', kw: ['电车', '车机', '小米汽车', '理想', '蔚来', '特斯拉', '新能源'] },
  { q: 'NAS 自托管 Docker 新闻', kw: ['nas', '飞牛', 'docker', '群晖', '自托管'] },
  { q: '游戏 新闻 发售', kw: ['游戏', 'steam', 'switch', '原神'] },
]
/** 从记忆/近期对话文本里数关键词挑兴趣（≤max 个搜索词）；不够的用默认补齐。 */
export function pickNewsQueries(corpus, max = 3) {
  const text = String(corpus ?? '').toLowerCase()
  const scored = TOPICS.map(t => ({ q: t.q, n: t.kw.reduce((s, k) => s + (text.split(k).length - 1), 0) }))
    .filter(t => t.n >= 2).sort((a, b) => b.n - a.n).map(t => t.q)
  const out = [...new Set([...scored, ...DEFAULT_NEWS_QUERIES])].slice(0, max)
  return { queries: out, derived: scored.slice(0, max) }
}
/** 豆包 WebResults → 去重、过滤过旧，按排名轮流取，最多 n 条。 */
export function pickNews(resultsByQuery, { n = 5, now, maxAgeHours = 48 } = {}) {
  const seen = new Set(), queues = resultsByQuery.map(list => [...(list ?? [])].sort((a, b) => (b.RankScore ?? 0) - (a.RankScore ?? 0)))
  const out = []
  const key = t => String(t ?? '').replace(/[\s\p{P}\p{S}]+/gu, '').slice(0, 18)
  while (out.length < n && queues.some(q => q.length)) {
    for (const q of queues) {
      if (out.length >= n) break
      let r, pt
      while ((r = q.shift())) {
        pt = ms(r.PublishTime)
        if (!r.Url || !r.Title || seen.has(r.Url) || seen.has(key(r.Title))) continue
        if (Number.isFinite(pt) && now && now - pt > maxAgeHours * 3_600_000) continue
        break
      }
      if (!r) continue
      seen.add(r.Url); seen.add(key(r.Title))
      out.push({ title: clip(r.Title, 60), site: clip(r.SiteName, 16), url: r.Url, summary: clip(r.Summary || r.Snippet, 160), time: Number.isFinite(pt) ? pt : null })
    }
  }
  return out
}

/* ---------------- 飞书私聊会话候选（给桥 /relay 用） ---------------- */
const GROUP_MARK = /〔本群记录ID|〔群聊边界|〔群成员：/
/** 只挑「确定是私聊」的会话：有用户以〔飞书〕开头的普通发言，且最近记录里没有任何群聊标记。按最近活跃倒序。 */
export function feishuDmCandidates(state, max = 3) {
  const rows = []
  for (const [sid, s] of Object.entries(state?.sessions ?? {})) {
    const recent = Array.isArray(s?.recent) ? s.recent : []
    const users = recent.filter(r => r?.role === 'user' && typeof r.text === 'string')
    if (users.some(r => GROUP_MARK.test(r.text))) continue
    if (!users.some(r => r.text.startsWith('〔飞书〕') && !r.text.startsWith('〔飞书〕〔后台结果') && !r.text.includes(BRIEF_MARK))) continue
    rows.push([sid, Number(s.lastActive) || 0])
  }
  return rows.sort((a, b) => b[1] - a[1]).slice(0, max).map(r => r[0])
}
export function hasGroupMarks(state, sid) {
  const recent = state?.sessions?.[sid]?.recent
  return Array.isArray(recent) && recent.some(r => r?.role === 'user' && GROUP_MARK.test(String(r.text ?? '')))
}

/* ---------------- 触发消息（模型唯一的一轮写作） ---------------- */
const sec = (title, lines) => (lines && lines.length ? [`【${title}】`, ...lines.map(l => `- ${l}`)] : [])

/**
 * data: 由 brief.js 查好的确定性资料。返回 {text, empty}。
 * 模型只负责写：人格/称呼由系统提示（本户 ASTRA 设定）现读；这里再带一次称呼。
 */
export function buildBriefTrigger(slot, data) {
  const s = SLOTS[slot]
  const p = data.parts
  const L = []
  const personal = []
  if (slot === 'morning') {
    personal.push(...sec('今日日程（一行一条，⚠冲突/连轴照抄，不要展开分析）', data.schedule))
    personal.push(...sec('逾期待办', (data.todos?.overdue ?? []).map(todoLine)))
    personal.push(...sec('今天到期的待办', (data.todos?.dueToday ?? []).map(todoLine)))
    personal.push(...sec('最该先做的三件（按重要和到期排）', (data.todos?.top3 ?? []).map(todoLine)))
    const w = data.works ?? {}
    personal.push(...sec('夜里后台的活', [...(w.finished ?? []).map(x => `已完成：${x}`), ...(w.failed ?? []).map(x => `没做成：${x}`), ...(w.stuck ?? []).map(x => `可能卡住（2小时没动静）：${x}`), ...(w.needYou ?? []).map(x => `等你处理：${x}`)]))
    personal.push(...sec('飞书群里 @你 的', data.mentions))
  } else {
    const r = data.reconcile ?? {}
    personal.push(...sec('今日对账', [...(r.doneToday ?? []).map(x => `✓ 做完：${x}`), ...(r.touched ?? []).map(x => `… 动过没完：${x}`), ...(r.untouched ?? []).map(x => `✗ 没动：${x}`)]))
    const w = data.works ?? {}
    personal.push(...sec('今天后台的活', [...(w.finished ?? []).map(x => `已完成：${x}`), ...(w.failed ?? []).map(x => `没做成：${x}`)]))
    const b = data.blockers ?? {}
    personal.push(...sec('卡点', [...(b.needYou ?? []).map(x => `等你拍板：${x}`), ...(b.others ?? []).map(x => `等别人：${x}`), ...(b.overdue ?? []).map(x => `已逾期：${x}`)]))
    personal.push(...(data.groups?.length ? ['【今天各群（每群一两句，不点真名，只说在聊什么、有没有要他管的）】', ...data.groups.flatMap(g => [`- 群「${g.group}」今天 ${g.total} 条（人类发言 ${g.humanLines} 条，${g.speakers} 人）：`, ...g.sample.map(x => `    ${x}`)])] : []))
    personal.push(...sec('明天日程', data.tomorrow?.schedule))
    personal.push(...sec('明天到期', (data.tomorrow?.due ?? []).map(todoLine)))
  }
  const extra = []
  if (data.weather) extra.push(...sec('天气', [data.weather]))
  if (data.news?.length) extra.push(`【新闻（豆包搜索，已查好；每条：一行标题 + 一行「为什么跟你有关」+ 链接原样给出，不要编造链接）】`, ...data.news.map((n, i) => `- ${i + 1}. ${n.title}｜${n.site}｜${n.url}\n    摘要：${n.summary}`))
  const empty = personal.length === 0
  L.push(`${BRIEF_MARK}${s.label} · ${p.date}（${p.weekday}）${p.hhmm}（${data.timezone}）`)
  L.push(`这不是用户发来的消息，是每天${slot === 'morning' ? '早上' : '晚上'}定时让你写给用户的${s.label}。用户还没有说话。`)
  L.push(`用你平时的身份、名字、性格和语气，称呼用户「${data.userName || '老板'}」，直接写这份${s.label}：`)
  if (empty) {
    L.push(`- 今天${slot === 'morning' ? '日程、待办、后台、群里都没有要紧事' : '没有可对账的事、没有卡点、明天也没安排'}：只写一句短话交代${extra.length ? '，然后把下面的新闻按格式列出' : ''}，不要编内容。`)
  } else {
    L.push('- 按下面给的版块顺序写，版块名可以用简短的小标题（飞书卡片支持 markdown 加粗），没给的版块就是空的，不要写、也不要说"无"。')
    L.push('- 日程一行一条，原样带上 ⚠冲突/连轴 标记，不要写分析段落；待办一行一条。')
    if (slot === 'morning') L.push('- 最后一行：一句话建议今天先做哪件（从上面的资料里挑，不要编新事）。')
    else L.push('- 群动态每个群一两句；最后一行一句话收尾（比如明天第一件该干什么）。')
  }
  L.push(`- 📮 邮件：还没接入。${empty ? '不用提。' : '在末尾用一行占位「📮 邮件：还没接入」即可。'}`)
  L.push('- 不要调用任何工具；资料都在下面，照实写，不要编造；不要说这是系统触发或定时发送的；不要提内部名字（知序、dotWork、豆包搜索等，可以说"日程里""后台"）；不要复述这段说明。')
  L.push('', ...personal, ...extra)
  return { text: L.join('\n'), empty }
}
