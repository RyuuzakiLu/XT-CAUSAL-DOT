/**
 * @xtcausal/dot-persona：每个账号自己的 DOT 名称、称呼、性别与人格。
 *
 * 同一个包挂两处（cordis.patch.yml）：
 *   @xtcausal/dot-persona —— 在 ASTRA 预设里，每轮组装系统提示时按当前账号注入「本账号的 DOT 设定」。
 *   @xtcausal/dot-persona/routes —— 在宿主层，给网页提供 /dot-persona/api/*（只认经登录门转来的请求）。
 */
import { promptSection, readProfile } from './store.js'
import { loadCore } from './expand.js'

export const name = 'dot-persona'
export const SECTION = 'dot-persona-profile'
const IDENTITY_KEY = Symbol.for('dot.cloud.identity')

function currentActor() {
  const actor = globalThis[IDENTITY_KEY]?.getStore?.()?.actor
  return typeof actor === 'string' && actor !== '' ? actor : undefined
}

function applyPrompt(ctx) {
  const logger = ctx.logger('dot-persona')
  ctx.effect(() => ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const result = await next()
    try {
      const actor = currentActor()
      if (actor === undefined) return result
      const profile = await readProfile(actor)
      let text = promptSection(profile)
      /* dot-soul-template-2026-10-27：有人格设定的账号，后面接上模板里的固定机制（情绪状态机、专注模式、记忆呈现、行为要点、底线）。 */
      /* dot-persona-core-switch-2026-11-01：按账号开关，profile.fixedCore === false 的账号不拼（人格规格书里自带底线时用）。 */
      if (text !== '' && (profile.expanded || profile.brief) && profile.fixedCore !== false) {
        const core = await loadCore(profile)
        if (core !== '') text = `${text}\n\n${core}`
      }
      result.sections = result.sections.filter(item => item.name !== SECTION)
      if (text !== '') {
        const at = result.sections.findIndex(item => /persona/i.test(String(item.name ?? '')))
        if (at >= 0) result.sections.splice(at + 1, 0, { name: SECTION, text })
        else result.sections.push({ name: SECTION, text })
      }
    } catch (error) {
      logger.warn('账号设定注入跳过：%s', error instanceof Error ? error.message : String(error))
    }
    return result
  }), 'dot-persona: 账号设定注入')
}

export function apply(ctx) {
  applyPrompt(ctx)
}
