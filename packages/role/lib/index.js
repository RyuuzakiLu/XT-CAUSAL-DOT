/**
 * @xtcausal/dot-role —— 角色由代码定死（role-2026-10-27，Miles）
 *
 * 挂在每个 agent preset 里（astra = front，astra-worker = worker），不靠模型判断：
 *   1. 把全局 AGENTS.md 和本角色的角色文件（front.md / worker.md，都是 root 所有、只读）注入系统提示，
 *      别的角色的文件读都不读；
 *   2. worker 在工具层拿掉派活工具：对已注册的用 ctx.tools.restrict 隐藏，
 *      再加一道 ctx.tools.guard，哪怕以后新注册了 work_* / plan_* / dispatch 类工具，调用也会被拒；
 *   3. 进程带 DOT_ROLE 时按角色检查；账号前台可显式装配本户内部 worker，
 *      但 worker 仍由下面的工具守卫禁止再派活，不能把 front 的工具搬给 worker。
 *   更新：2026-10-27 · 每账号一个宿主包含前台及其内部 worker，避免拆户后派活被角色锁误拦。 
 *   【不】删除 DOT_WORKER_IN_PROCESS 的显式开关；单独 worker 进程仍不能装配 front。
 */
import { readFileSync, realpathSync } from 'node:fs'
import { resolve, relative, isAbsolute } from 'node:path'

export const name = 'dot-role'
export const inject = ['tools']

const SECTION = 'dot-role'
const AGENTS_SECTION = 'dot-agents'
const ROLES = new Set(['front', 'worker'])
/** 后台一律不给的工具：派活、定时派活。 */
const WORKER_DENY = ['work_create', 'work_query', 'work_supplement', 'work_cancel', 'plan_create', 'plan_update', 'plan_cancel', 'plan_list']
const WORKER_DENY_RE = /^(work_|plan_|dot_work|dot_dispatch|dispatch)/

/* present 自己只记展示意图就回成功；后台必须在执行前拒绝界外文件，不能等成果入库时静默丢弃。 */
export function workerPresentDenied(execution) {
  if (execution?.name !== 'present') return undefined
  const files = execution.arguments?.files
  if (!Array.isArray(files)) return undefined /* 格式校验仍由原生工具负责。 */
  const cwd = execution.agent?.session?.header?.cwd ?? process.env.DOT_CLOUD_WORKSPACE
  if (typeof cwd !== 'string' || cwd === '') return '无法确定本户工作区，文件尚未交付。'
  try {
    const root = realpathSync(cwd)
    for (const file of files) {
      if (typeof file?.path !== 'string') continue
      const target = realpathSync(resolve(cwd, file.path))
      const rel = relative(root, target)
      if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) return '不能交付工作区外的文件：该文件未登记为成果，请只交付本户工作区内的文件。'
    }
  } catch { return '文件不存在或不可访问，尚未交付为成果。' }
  return undefined
}

export function apply(ctx, config = {}) {
  const role = String(config.role || '')
  const log = ctx.logger('dot-role')
  if (!ROLES.has(role)) throw new Error(`dot-role: role 必须是 front 或 worker，收到 "${role}"`)
  const envRole = process.env.DOT_ROLE
  const ownWorker = envRole === 'front' && role === 'worker' && process.env.DOT_WORKER_IN_PROCESS === '1'
  if (envRole && envRole !== role && !ownWorker) throw new Error(`dot-role: 本进程 DOT_ROLE=${envRole}，不装配 ${role} 角色`)
  const file = String(config.file || '')
  const agentsFile = String(config.agents || '')

  ctx.effect(() => ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const result = await next()
    result.sections = result.sections.filter(item => item.name !== SECTION && item.name !== AGENTS_SECTION)
    for (const [section, path] of [[AGENTS_SECTION, agentsFile], [SECTION, file]]) {
      if (!path) continue
      try {
        const text = readFileSync(path, 'utf8').trim()
        if (text !== '') result.sections.push({ name: section, text })
      } catch (error) {
        log.warn('注入失败（%s）：%s', path, error instanceof Error ? error.message : String(error))
      }
    }
    return result
  }), `dot-role: ${role} 角色文件注入`)

  if (role === 'worker') {
    /* dot-role-restrict-late-20261028：restrict 必须**跟着注册表变化补打**。
       原因（实测）：role 插件 apply 时 work_* 往往还没注册，restrict() 对未知名会抛错，
       旧代码用 try/catch 吞掉，于是"藏"这一步对后来注册的派活工具从未生效——
       2026-10-28 真账号 worker 会话的 request/header 里仍能看到 work_create/work_query/
       work_supplement/work_cancel 四个工具，模型也确实看见了它们（只是靠提示词拒绝）。
       现在：装配时试一次，之后每次 tools/change 再试一次；已藏过的不重复藏。 */
    const hidden = new Set()
    const hideAll = (label) => {
      for (const toolName of WORKER_DENY) {
        if (hidden.has(toolName)) continue
        /* restrict 会同步发 tools/change；先占位，否则回调会再次隐藏同一个工具。 */
        hidden.add(toolName)
        try {
          ctx.effect(() => ctx.tools.restrict({ deny: [toolName] }), `dot-role: worker 隐藏 ${toolName}(${label})`)
        } catch { hidden.delete(toolName) /* 还没注册：撤销占位，等注册后重试。 */ }
      }
    }
    hideAll('装配时')
    // ⚠️ 事件名必须是 'tools/change'（dsh-tools 注册/注销时 emit 的就是它，见其 lib）。
    ctx.effect(() => ctx.on('tools/change', () => hideAll('注册后补藏')), 'dot-role: worker 补藏派活工具')
    // 拒绝：不管工具什么时候注册、叫什么，派活类调用在执行前一律拒。
    ctx.effect(() => ctx.tools.guard(execution => {
      const n = String(execution?.name || '')
      return WORKER_DENY.includes(n) || WORKER_DENY_RE.test(n) ? '后台不能再派活：直接把这件事做完' : workerPresentDenied(execution)
    }), 'dot-role: worker 派活守卫')
  }
}
