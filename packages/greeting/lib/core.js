/**
 * @xtcausal/dot-greeting · 纯函数区（单测直接调，不碰网络、不碰会话）
 *
 * 口径（用户 2026-11-01 批）：
 *   - 每天按账号偏好的时间（默认 08:00，偏好时区默认 Asia/Shanghai）发【一条】主动问候；
 *   - 同一天只发一次（认领在知序，重启不重发）；
 *   - 机器停着错过了：开机后只在「补发窗口」内补发——问候时间早于 11:00 的，窗口到当天 11:00；
 *     晚于 11:00 的，窗口是问候时间后 3 小时（不跨天）；过了窗口当天就跳过；
 *   - 用户很久没聊（> 48 小时）时，在这条早安里顺带一句轻松的关心，不另发消息。
 */

export const SOURCE_KIND = 'dot-greeting'
export const SILENCE_HOURS = 48
export const LATE_CUTOFF_MINUTE = 11 * 60
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 某时区里的日期 / 一天第几分钟 / 星期 / HH:mm。 */
export function localParts(ms, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  }).formatToParts(new Date(ms)).map(p => [p.type, p.value]))
  const hour = Number(parts.hour) % 24
  const minute = Number(parts.minute)
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday)
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: hour * 60 + minute,
    weekday: WEEK[wd] ?? '',
    hhmm: `${String(hour).padStart(2, '0')}:${parts.minute}`,
    month: Number(parts.month), day: Number(parts.day),
  }
}

/** 补发窗口的结束分钟（不含）。 */
export function windowEnd(minute) {
  return minute < LATE_CUTOFF_MINUTE ? LATE_CUTOFF_MINUTE : Math.min(1440, minute + 180)
}

/**
 * decide()：这一刻该做什么。
 * @param now - 毫秒
 * @param prefs - {enabled, minute, timezone}
 * @param lastDate - 知序里最近一次认领的日期（偏好时区），没有为 null
 * @returns {action:'idle'|'wait'|'send'|'skip', reason, date, late?}
 */
export function decide({ now, prefs, lastDate }) {
  if (!prefs || prefs.enabled !== true) return { action: 'idle', reason: 'disabled' }
  const zone = prefs.timezone || 'Asia/Shanghai'
  const at = localParts(now, zone)
  if (lastDate === at.date) return { action: 'idle', reason: 'done-today', date: at.date }
  const target = Number.isInteger(prefs.minute) ? prefs.minute : 480
  if (at.minute < target) return { action: 'wait', reason: 'before-time', date: at.date }
  if (at.minute >= windowEnd(target)) return { action: 'skip', reason: 'missed-window', date: at.date }
  return { action: 'send', reason: at.minute - target > 5 ? 'late' : 'on-time', date: at.date, late: at.minute - target > 5 }
}

/** 最近一次真实用户发言距今多少小时；不知道返回 undefined。 */
export function silenceHours(lastUserAt, now) {
  if (!(Number(lastUserAt) > 0)) return undefined
  return Math.max(0, (now - Number(lastUserAt)) / 3_600_000)
}

function clock(iso, zone) {
  if (!iso) return ''
  try { return localParts(Date.parse(iso), zone).hhmm } catch { return '' }
}

/** zhixu_today_agenda 的结果 → 给模型看的几行（最多 8 条）。 */
export function agendaLines(data, zone = 'Asia/Shanghai') {
  const lines = []
  for (const ev of data?.events ?? []) {
    const d = ev?.data ?? ev ?? {}
    const startDay = d.start ? localParts(Date.parse(d.start), zone).date : ''
    const endDay = d.end ? localParts(Date.parse(d.end) - 1, zone).date : ''
    const today = data?.date
    const allDay = today && startDay < today && endDay > today
    const when = allDay ? '全天' : `${startDay === today || !today ? clock(d.start, zone) : '更早开始'}–${endDay === today || !today ? clock(d.end, zone) : '跨天'}`
    lines.push(`日程 ${when} ${String(d.title ?? '').slice(0, 60)}${d.location ? `（${String(d.location).slice(0, 30)}）` : ''}`)
  }
  for (const t of data?.tasks ?? []) {
    const d = t?.data ?? t ?? {}
    const bits = []
    if (d.dueAt) bits.push(`截止 ${clock(d.dueAt, zone)}`)
    if (d.remindAt) bits.push(`提醒 ${clock(d.remindAt, zone)}`)
    lines.push(`待办 ${String(d.title ?? '').slice(0, 60)}${bits.length ? `（${bits.join('，')}）` : ''}${d.priority === 'important' ? ' [重要]' : ''}`)
  }
  if (lines.length > 8) return [...lines.slice(0, 8), `……另外还有 ${lines.length - 8} 条`]
  return lines
}

/**
 * 触发消息正文（source.kind = dot-greeting）：不是用户说的话，是给模型的一次性说明 + 已查好的资料。
 * 人格、名字、称呼不写死在这里——真发时由系统提示里「本账号的 DOT 设定」每轮现读（设置页一改就生效）。
 */
export function buildTrigger({ parts, timezone, agenda, agendaError, weather, silence, userName }) {
  const lines = [
    '【主动问候 · 系统定时触发，不是用户发来的消息】',
    `现在是 ${parts.date}（${parts.weekday}）${parts.hhmm}（${timezone}）。这是你每天这个时间主动发给用户的早安问候，用户还没有说话。`,
    `用你平时的身份、名字、性格、语气和对用户的称呼${userName ? `（称呼：${userName}）` : ''}，直接写一条简短的早安消息：`,
    '- 2 到 5 句，像平时发消息那样自然；不要标题，不要长列表（安排多于 3 条可以简单分行）。',
  ]
  if (agendaError) lines.push('- 今天的日程这会儿没查到：不要提具体安排，也不要说"查不到"，就当普通问候。')
  else if (agenda.length) lines.push('- 今天的安排（已替你查好，照实说，挑要紧的提一下，不要编造）：', ...agenda.map(s => `  · ${s}`))
  else lines.push('- 今天日程里没有安排：轻轻带一句就好（比如今天可以松一点），不要编造安排。')
  if (weather) lines.push(`- 今天的天气（已查好，简单提一句，提醒带伞/添衣之类按需要）：${weather}`)
  if (silence !== undefined && silence > SILENCE_HOURS) {
    const days = Math.max(2, Math.round(silence / 24))
    lines.push(`- 用户已经大约 ${days} 天没来聊天了：顺带一句轻松的关心或问候近况，不要责怪、不要追问原因、不要煽情，一句就够。`)
  }
  lines.push('不要调用任何工具；不要说这是系统触发或定时发送的；不要提内部名字（知序、和风、星邮匣等，可以说"日程里"）；不要复述这段说明。')
  return lines.join('\n')
}

/** 从回合事件里取助手正文（只要 text 块）。 */
export function assistantText(event) {
  const blocks = event?.data?.message?.content
  if (!Array.isArray(blocks)) return ''
  return blocks.map(b => (b?.type === 'text' && typeof b.text === 'string') ? b.text : '').join('').trim()
}

/** 选「用户当前的对话」：最近有真实发言的会话（跟到换会话链尾）→ 服务端当前会话 → 会话目录里最近更新的非空会话。 */
export function pickSession({ state, list, skip = new Set() }) {
  const known = state?.sessions ?? {}
  const active = Object.entries(known).filter(([sid, s]) => !skip.has(sid) && Number(s?.lastActive) > 0)
  if (active.length) {
    active.sort((a, b) => b[1].lastActive - a[1].lastActive)
    let sid = active[0][0]
    /* 换会话链：跟到链尾 */
    for (let i = 0; i < 20 && typeof known[sid]?.rolledTo === 'string'; i += 1) sid = known[sid].rolledTo
    return sid
  }
  if (typeof state?.current === 'string' && !skip.has(state.current)) return state.current
  const rows = (Array.isArray(list) ? list : []).filter(r => r && typeof r.sessionId === 'string' && r.blank !== true && !skip.has(r.sessionId))
  const t = r => Number(Date.parse(r.updatedAt ?? '') || r.updatedAt || Date.parse(r.createdAt ?? '') || r.createdAt || 0)
  rows.sort((a, b) => t(b) - t(a))
  return rows[0]?.sessionId
}

/** 最近一次真实用户发言（turn-context 账本里各会话 lastActive 的最大值）。 */
export function lastUserAt(state) {
  let max = 0
  for (const s of Object.values(state?.sessions ?? {})) if (Number(s?.lastActive) > max) max = Number(s.lastActive)
  return max > 0 ? max : undefined
}

/** 星邮匣信的正文：回复原文去掉 markdown 标记，截 300 字。 */
export function letterBody(text) {
  const plain = String(text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/[*_`#>]/g, '').replace(/\n{3,}/g, '\n\n').trim()
  return plain.length > 300 ? `${plain.slice(0, 299)}…` : plain
}
