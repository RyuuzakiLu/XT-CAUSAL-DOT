/** @xtcausal/dot-persona/routes：网页用的 /dot-persona/api/*，只认经登录门转来的请求。 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { DEFAULT_NAME, GENDERS, LIMITS, PERSONA_CEILING, needsOnboarding, readProfile, sanitize, writeProfile } from './store.js'

const MAX_BODY = PERSONA_CEILING * 3 * 2 + 64 * 1024
import { expandPersona, templatePath } from './expand.js'

export const name = 'dot-persona-routes'
export const inject = ['webServer']

/* 账号进程里 DOT_GATEWAY_KEY 是 "sha256:<hex>" 摘要而非明文（2026-10-30，见 scripts/dot-cloud-tenancy.mjs 的 verifyGatewayKey，语义保持一致）。 */
function sameKey(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || provided === '' || expected === '') return false
  const digest = /^sha256:([0-9a-f]{64})$/.exec(expected)
  const x = createHash('sha256').update(provided).digest()
  const y = digest !== null ? Buffer.from(digest[1], 'hex') : createHash('sha256').update(expected).digest()
  return timingSafeEqual(x, y)
}

function send(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(text)
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    /* 人格不限长（dot-persona-unlimited-2026-11-01）：请求体上限跟着 10 万字的存储安全上限放大（中文 UTF-8 + JSON 转义留足余量）。 */
    if (size > MAX_BODY) throw Object.assign(new Error('内容太长'), { status: 413 })
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { throw Object.assign(new Error('格式不对'), { status: 400 }) }
}

function publicView(profile, onboarding) {
  const { exists: _e, legacy: _l, ...rest } = profile
  return { profile: rest, needsOnboarding: onboarding, defaults: { name: DEFAULT_NAME }, genders: GENDERS, limits: LIMITS }
}

/* dot-persona-brief-2026-10-27：预览扩写（不存盘）。每个账号同时只跑一个，两次之间至少隔 4 秒。 */
const previewState = new Map()

function applyRoutes(ctx) {
  const logger = ctx.logger('dot-persona')
  const handler = async (req, res) => {
    try {
      const gatewayKey = process.env.DOT_GATEWAY_KEY
      const actor = String(req.headers['x-dot-account'] ?? '')
      if (!sameKey(String(req.headers['x-dot-gateway-key'] ?? ''), gatewayKey) || actor === '') return send(res, 403, { error: '未登录' })
      const path = (req.url ?? '').split('?')[0]
      if (path === '/dot-persona/api/profile' && req.method === 'GET') {
        const profile = await readProfile(actor)
        return send(res, 200, publicView(profile, await needsOnboarding(actor)))
      }
      if (path === '/dot-persona/api/preview' && req.method === 'POST') {
        if (!String(req.headers['content-type'] ?? '').includes('application/json')) return send(res, 415, { error: '格式不对' })
        const input = await readJson(req)
        const state = previewState.get(actor) ?? { busy: false, at: 0 }
        if (state.busy) return send(res, 429, { error: '上一版还在扩写，稍等一下' })
        if (Date.now() - state.at < 4_000) return send(res, 429, { error: '点得有点快，稍等几秒再试' })
        const draft = sanitize({ name: input.name, userName: input.userName, gender: input.gender, brief: input.brief }, await readProfile(actor))
        if (draft.brief === '') return send(res, 400, { error: '先写几句人设再预览' })
        previewState.set(actor, { busy: true, at: Date.now() })
        try {
          const out = await expandPersona(draft)
          logger.info('人格预览扩写完成（%s，原文 %d 字，扩写 %d 字）', out.model, draft.brief.length, out.text.length)
          return send(res, 200, { expanded: out.text, brief: draft.brief, model: out.model })
        } catch (error) {
          logger.warn('人格预览扩写失败：%s', error instanceof Error ? error.message : String(error))
          return send(res, 502, { error: '这次没扩写出来，稍后再点一次' })
        } finally { previewState.set(actor, { busy: false, at: Date.now() }) }
      }
      if (path === '/dot-persona/api/profile' && req.method === 'POST') {
        if (!String(req.headers['content-type'] ?? '').includes('application/json')) return send(res, 415, { error: '格式不对' })
        const input = await readJson(req)
        const before = await readProfile(actor)
        let next = sanitize(input, before)
        /* 保存的是预览出来、用户没动过的那一版：记作模型扩写，不算手改。 */
        if ('expanded' in input && input.expandedFromPreview === true && next.expanded !== '') { next.expandedEdited = false; next.expandedAt = new Date().toISOString() }
        if (input.onboarding === true && !next.onboardedAt) next.onboardedAt = new Date().toISOString()
        if (!before.exists && !next.onboardedAt) next.onboardedAt = new Date().toISOString()
        let expandError = null
        const wantExpand = input.expand === true || (input.expand !== false && next.brief !== '' && next.brief !== before.brief && !('expanded' in input))
        if (wantExpand && next.brief !== '') {
          try {
            const out = await expandPersona(next)
            next = { ...next, expanded: out.text, expandedEdited: false, expandedAt: new Date().toISOString() }
            logger.info('人格扩写完成（%s，%d 字）', out.model, out.text.length)
          } catch (error) {
            expandError = '扩写这次没成功，几个字的人格已经保存，可以稍后再点“重新扩写”。'
            logger.warn('人格扩写失败：%s', error instanceof Error ? error.message : String(error))
          }
        }
        const saved = await writeProfile(actor, next)
        return send(res, 200, { ...publicView(saved, false), expandError })
      }
      return send(res, 404, { error: '没有这个接口' })
    } catch (error) {
      const status = error?.status ?? 500
      if (status === 500) logger.warn('设定接口出错：%s', error instanceof Error ? error.message : String(error))
      return send(res, status, { error: status === 500 ? '保存失败，请稍后再试' : error.message })
    }
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/dot-persona/api', handler }), 'dot-persona: 设定接口')
  logger.info('人格模板：%s', templatePath())
}

export function apply(ctx) {
  applyRoutes(ctx)
}
