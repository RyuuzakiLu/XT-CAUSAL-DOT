/* ================================================================
   DOT 工作插件 · Host 入口

   ▍这是什么
   ① 干什么：Loader 的入口插件。导出 name / inject / Config / apply，
      在 apply 里创建并注册 {@link DotWorkService}，再挂上模型可见的工作工具。
   ② 技术栈：官方插件形状（命名导出 name/inject/apply）；服务由类构造时自注册。
   ③ 依赖：见 inject —— 全是原生服务，没有本包以外的 DOT 依赖。
   ④ 给谁看：装配者（这行加进 DOT 组合就启用）、排查"插件没起来"的人（先看 inject 是否满足）。

   ▍结构
   name/inject/Config —— Loader 元信息
   apply              —— 只做组装：创建服务、注册工具、登记清理

   ▍修改铁律
   1. 【不】在 apply 里写业务算法：算法在 service/domain/runner；入口只接线。
   2. 【不】在模块顶层创建单例、定时器或订阅：Loader 会重复 import，副作用会翻倍。
   3. tools 是必须的（模型要能交代工作）；schedule 是可选（部署没挂时计划功能给稳定错误码）。
   4. 【不】把 dotPostbox 写进 inject：它是可选依赖，写进去会让本插件在只是没装邮匣时永远等待。

   ▍更新记录
   2026-10-23 · 建立：Load 入口、服务注册、工具注册、清理。
   ================================================================ */
import type { Context } from '@deepseek-ai/cordis'
import { DotWorkService } from './service.ts'
import { registerWorkTools } from './tool.ts'
import type { Config } from './service.ts'
export type * from './types.ts'
export { DotWorkService } from './service.ts'
export { DotWorkRunner } from './runner.ts'
export { dotWorkDomain } from './storage.ts'
export { pickWorkForQuery, matchScore, type WorkPick } from './work-match.ts'
export {
  appendStep, artifactIntentsOf, artifactRefOf, canTransition, externalReachOf, finishRunningStep, isCancellable,
  isRetryable, isTerminal, isWaiting, outcomeOfTurnEnd, scheduleSelectorOf, timingOfScheduleRecord,
  titleFromGoal, toPlanView, toSnapshot,
} from './domain.ts'

/** Loader 诊断里显示的名字。 */
export const name = 'dot-work'

/**
 * 必需依赖：会话业务面（真实执行）、会话存储（读 header cwd）、
 * 持久域（写工作记录）、Agent 注册表（重启后判断会话是否还活着）、工具注册表。
 * ⚠️ `schedule` 故意不在这里：计划是可选能力，缺它就只在调用计划方法时报稳定错误码，
 * 而不是让整个工作插件永远等不到依赖（那样连"交代一件工作"都做不了）。
 */
export const inject = ['sessionController', 'sessions', 'storageDomain', 'agents', 'tools']

export { Config } from './service.ts'

/**
 * 装配 DOT 工作领域。
 * @param ctx - 挂载作用域
 * @param config - 已解析部署策略
 */
export function apply(ctx: Context, config: Config): void {
  const work = new DotWorkService(ctx, config)
  // 服务由构造函数自注册到 ctx.dotWork；这里只负责把工具与清理接上。
  /* 云端工作服务已按账号分区（owner + requireOwned，见 cloud.ts），云端也注册模型工具。 */
  registerWorkTools(ctx, work)
  // 星邮匣比本插件晚就位时补发未登记终态：监听服务绑定事件，一次就够。
  ctx.effect(() => {
    const stop = ctx.on('internal/service', (name, value) => {
      if (name !== 'dotPostbox' || value === undefined) return
      void work.notifyPostboxReady()
    })
    return () => { stop() }
  }, 'dot-work: postbox ready()')
}
