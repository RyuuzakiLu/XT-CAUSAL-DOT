/* ================================================================
   DOT · 知序日程 · 网页只读接口（/dot-zhixu/api/events）· 总导游图

   ▍这是什么
   ① 干什么：简洁版「日历」页按月读本账号在知序里的日程，只读。
   ② 为什么不在浏览器直连知序：知序钥匙是每户自己的，只在本户进程环境里
      （launcher 写 DOT_ZHIXU_KEY），浏览器拿不到也不该拿到。
   ③ 依赖：webServer（同 dot-persona-routes）；DOT_ZHIXU_URL / DOT_ZHIXU_KEY；
      DOT_GATEWAY_KEY（摘要形式，核登录门转来的请求）；DOT_CLOUD_ACCOUNT（本进程账号）。
   ④ 谁调用：packages/ui/src/client/lite/calendar.ts 的 loadMonthEvents()。

   ▍修改铁律
   1. 账号只认登录门写的 x-dot-account（浏览器写不了，网关先删干净再写），
      并且必须等于本进程的 DOT_CLOUD_ACCOUNT（按账号拆进程后一户一进程）；对不上一律 403。
   2. 日程只读；个人待办仅允许本人通过页面切换完成状态，写入须携带版本号。
   3. 知序没配置 → 503 明说；知序失败 → 502 明说，【不】回空列表冒充"没有安排"。
   4. 单次范围最多 62 天（一个月格子最多跨 6 周），最多翻 5 页 × 100 条。

   ▍更新记录
   *更新：2026-11-01 · calendar：新建（简洁版日历页）。
   ================================================================ */
import { createHash, timingSafeEqual } from 'node:crypto'

export const name = 'dot-zhixu-routes'
export const inject = ['webServer']

export const MAX_RANGE_DAYS = 62
export const MAX_PAGES = 5
const OFFSET_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/

/* 与 packages/persona/lib/routes.js 的 sameKey 同义：expected 可以是明文或 "sha256:<hex>" 摘要。 */
export function sameKey(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || provided === '' || expected === '') return false
  const digest = /^sha256:([0-9a-f]{64})$/.exec(expected)
  const x = createHash('sha256').update(provided).digest()
  const y = digest !== null ? Buffer.from(digest[1], 'hex') : createHash('sha256').update(expected).digest()
  return timingSafeEqual(x, y)
}

/** 校验 from/to：必须带时区偏移、from < to、跨度不超过 MAX_RANGE_DAYS。不合格抛 400。 */
export function checkRange(from, to) {
  const bad = message => Object.assign(new Error(message), { status: 400 })
  if (typeof from !== 'string' || typeof to !== 'string' || !OFFSET_ISO.test(from) || !OFFSET_ISO.test(to)) throw bad('from / to 必须是带时区偏移的 ISO 时间')
  const a = Date.parse(from), b = Date.parse(to)
  if (!Number.isFinite(a) || !Number.isFinite(b) || a >= b) throw bad('from 必须早于 to')
  if (b - a > MAX_RANGE_DAYS * 86_400_000) throw bad(`一次最多查 ${MAX_RANGE_DAYS} 天`)
  return { from, to }
}

/** 知序一条日程记录 → 界面用的最小形状（只挑展示要的字段，不把知序内部字段原样外露）。 */
export function publicEvent(record) {
  const d = record?.data ?? {}
  return {
    id: String(record?.id ?? ''),
    title: String(d.title ?? ''),
    start: String(d.start ?? ''),
    end: String(d.end ?? ''),
    location: String(d.location ?? ''),
    status: String(d.status ?? 'scheduled'),
    timeZone: String(d.timeZone ?? ''),
    ...(record?.reminder?.remindAt ? { remindAt: String(record.reminder.remindAt) } : {}),
  }
}

/** 按账号调一次知序 /invoke（只读工具）。 */
async function invokeZhixu(actor, name, args, fetchImpl = fetch) {
  const base = process.env.DOT_ZHIXU_URL, key = process.env.DOT_ZHIXU_KEY
  if (!base || !key) throw Object.assign(new Error('知序未配置'), { status: 503 })
  const response = await fetchImpl(`${base}/invoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dot-zhixu-key': key, 'x-dot-actor': actor },
    body: JSON.stringify({ name, arguments: args }),
    signal: AbortSignal.timeout(30_000),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body?.ok !== true) {
    if (body?.error?.code === 'VERSION_CONFLICT') throw Object.assign(new Error('待办已更新，请刷新后重试'), { status: 409 })
    throw Object.assign(new Error(`知序 ${name} 失败（${body?.error?.code ?? `HTTP_${response.status}`}）`), { status: 502 })
  }
  return body.data
}

/** 读 [from,to) 内本账号的日程（不含已取消），翻页到底或到上限。 */
export async function listEvents(actor, from, to, fetchImpl = fetch) {
  const items = []
  let cursor
  let truncated = false
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await invokeZhixu(actor, 'zhixu_list_events', { from, to, timeZone: 'Asia/Shanghai', limit: 100, ...(cursor ? { cursor } : {}) }, fetchImpl)
    for (const record of data?.items ?? []) items.push(publicEvent(record))
    cursor = data?.nextCursor
    if (!cursor) break
    if (page === MAX_PAGES - 1) truncated = true
  }
  return { items, truncated }
}

/** 只列个人待办：日程关联提醒与后台工作同步项不混入。 */
export function publicTask(record) {
  const d = record?.data ?? {}
  if (d.eventId || /\[DOT 后台工作 [^\]\r\n]+\]/.test(String(d.description ?? ''))) return undefined
  if (!record?.id || !Number.isInteger(record.version)) return undefined
  return { id: String(record.id), version: record.version, title: String(d.title ?? ''), status: String(d.status ?? 'pending'), dueAt: String(d.dueAt ?? ''), remindAt: String(d.remindAt ?? '') }
}

export async function listTasks(actor, fetchImpl = fetch) {
  const items = []
  let cursor, truncated = false
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await invokeZhixu(actor, 'zhixu_list_tasks', { timeZone: 'Asia/Shanghai', limit: 100, ...(cursor ? { cursor } : {}) }, fetchImpl)
    for (const record of data?.items ?? []) { const item = publicTask(record); if (item) items.push(item) }
    cursor = data?.nextCursor
    if (!cursor) break
    if (page === MAX_PAGES - 1) truncated = true
  }
  return { items, truncated }
}

async function jsonBody(req) {
  if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw Object.assign(new Error('请求格式不对'), { status: 415 })
  const chunks = []; let size = 0
  for await (const chunk of req) { size += chunk.length; if (size > 4096) throw Object.assign(new Error('请求过大'), { status: 413 }); chunks.push(chunk) }
  try { const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); return body } catch { throw Object.assign(new Error('请求格式不对'), { status: 400 }) }
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(JSON.stringify(body))
}

/** 账号认定：登录门凭据对 + x-dot-account 非空 + 与本进程账号一致（进程有固定账号时）。不通过返回 undefined。 */
export function actorOf(req) {
  const actor = String(req.headers['x-dot-account'] ?? '')
  if (actor === '' || !sameKey(String(req.headers['x-dot-gateway-key'] ?? ''), process.env.DOT_GATEWAY_KEY)) return undefined
  const fixed = String(process.env.DOT_CLOUD_ACCOUNT ?? '').trim()
  if (fixed !== '' && fixed !== actor) return undefined
  return actor
}

// The phone holds one authenticated connection. The short waits stay on the server;
// only mailbox changes and a four-minute catch-up frame travel to the device.
async function watchPostbox(actor, res, fetchImpl) {
  const base = process.env.DOT_ZHIXU_URL, key = process.env.DOT_ZHIXU_KEY
  if (!base || !key) return send(res, 503, {error:'知序未配置'})
  const cancel = new AbortController()
  res.once('close', () => cancel.abort())
  let seq = -1, lastFrame = 0
  try {
    while (!cancel.signal.aborted) {
      const response = await fetchImpl(base + '/postbox/wait?since=' + seq + '&timeoutMs=25000', {
        headers:{'x-dot-zhixu-key':key,'x-dot-actor':actor},
        signal:AbortSignal.any([cancel.signal,AbortSignal.timeout(35000)]),
      })
      const body = await response.json()
      const next = body?.data?.seq
      if (!response.ok || !body.ok || !Number.isSafeInteger(next) || next < 0) throw new Error('星邮匣订阅中断')
      if (cancel.signal.aborted) break
      const type = seq < 0 ? 'ready' : seq !== next ? 'changed' : 'checkpoint'
      if (type !== 'checkpoint' || Date.now()-lastFrame >= 240000) {
        if (!res.headersSent) res.writeHead(200, {'content-type':'application/x-ndjson','cache-control':'no-store, no-transform','x-accel-buffering':'no'})
        if (!res.write(JSON.stringify({type,seq:next,actor})+'\n')) { res.end(); break }
        lastFrame=Date.now()
      }
      seq=next
    }
  } catch (err) {
    if (!cancel.signal.aborted) {
      if (!res.headersSent) return send(res,502,{error:'星邮匣暂不可用'})
      res.end()
    }
  } finally { cancel.abort() }
}

export function createHandler({ logger, fetchImpl = fetch } = {}) {
  return async (req, res) => {
    try {
      const actor = actorOf(req)
      if (actor === undefined) return send(res, 403, { error: '未登录' })
      const url = new URL(req.url ?? '/', 'http://local')
      if (url.pathname === '/dot-zhixu/api/postbox-watch') {
        if (req.method !== 'GET') return send(res,405,{error:'只读接口'})
        return await watchPostbox(actor,res,fetchImpl)
      }
      if (url.pathname === '/dot-zhixu/api/events') {
        if (req.method !== 'GET') return send(res, 405, { error: '只读接口' })
        const { from, to } = checkRange(url.searchParams.get('from'), url.searchParams.get('to'))
        return send(res, 200, { ...(await listEvents(actor, from, to, fetchImpl)), from, to })
      }
      if (url.pathname === '/dot-zhixu/api/tasks' && req.method === 'GET') return send(res, 200, await listTasks(actor, fetchImpl))
      if (url.pathname === '/dot-zhixu/api/tasks' && req.method === 'POST') {
        if (req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, { error: '请求来源不允许' })
        const input = await jsonBody(req)
        const title = typeof input.title === 'string' ? input.title.trim() : ''
        if (!title || title.length > 500 || typeof input.operationId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.operationId)) return send(res, 400, { error: '请输入待办内容' })
        const created = await invokeZhixu(actor, 'zhixu_create_task', { title, operationId: input.operationId, timeZone: 'Asia/Shanghai' }, fetchImpl)
        return send(res, 200, { item: publicTask(created) })
      }
      if (url.pathname === '/dot-zhixu/api/tasks/status' && req.method === 'POST') {
        /* 自定义 JSON 请求头触发跨站预检，接口不开放 CORS；阻止跨站表单。 */
        if (req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, { error: '请求来源不允许' })
        const input = await jsonBody(req)
        if (typeof input.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.id) || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1 || typeof input.operationId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.operationId) || !['done', 'pending'].includes(input.status)) return send(res, 400, { error: '待办参数不对' })
        const current = await invokeZhixu(actor, 'zhixu_get_record', { kind: 'task', id: input.id }, fetchImpl)
        if (!publicTask(current)) return send(res, 403, { error: '不能在这里更改这项记录' })
        if (current.version !== input.expectedVersion) return send(res, 409, { error: '待办已更新，请刷新后重试' })
        const updated = await invokeZhixu(actor, 'zhixu_update_task', { id: input.id, expectedVersion: input.expectedVersion, operationId: input.operationId, status: input.status }, fetchImpl)
        return send(res, 200, { item: publicTask(updated) })
      }
      if (url.pathname === '/dot-zhixu/api/tasks' || url.pathname === '/dot-zhixu/api/tasks/status') return send(res, 405, { error: '请求方法不支持' })
      return send(res, 404, { error: '没有这个接口' })
    } catch (error) {
      const status = error?.status ?? 500
      if (status >= 500) logger?.warn?.('日程接口出错：%s', error instanceof Error ? error.message : String(error))
      return send(res, status, { error: status === 500 ? '读取日程失败，请稍后再试' : error.message })
    }
  }
}

export function apply(ctx) {
  const logger = ctx.logger('dot-zhixu-routes')
  const handler = createHandler({ logger })
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/dot-zhixu/api', handler }), 'dot-zhixu: 日程只读接口')
}
