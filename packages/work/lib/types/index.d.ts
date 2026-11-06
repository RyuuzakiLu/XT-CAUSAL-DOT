import type { Context } from '@deepseek-ai/cordis';
import type { Config } from './service.ts';
export type * from './types.ts';
export { DotWorkService } from './service.ts';
export { DotWorkRunner } from './runner.ts';
export { dotWorkDomain } from './storage.ts';
export { pickWorkForQuery, matchScore, type WorkPick } from './work-match.ts';
export { appendStep, artifactIntentsOf, artifactRefOf, canTransition, externalReachOf, finishRunningStep, isCancellable, isRetryable, isTerminal, isWaiting, outcomeOfTurnEnd, scheduleSelectorOf, timingOfScheduleRecord, titleFromGoal, toPlanView, toSnapshot, } from './domain.ts';
/** Loader 诊断里显示的名字。 */
export declare const name = "dot-work";
/**
 * 必需依赖：会话业务面（真实执行）、会话存储（读 header cwd）、
 * 持久域（写工作记录）、Agent 注册表（重启后判断会话是否还活着）、工具注册表。
 * ⚠️ `schedule` 故意不在这里：计划是可选能力，缺它就只在调用计划方法时报稳定错误码，
 * 而不是让整个工作插件永远等不到依赖（那样连"交代一件工作"都做不了）。
 */
export declare const inject: string[];
export { Config } from './service.ts';
/**
 * 装配 DOT 工作领域。
 * @param ctx - 挂载作用域
 * @param config - 已解析部署策略
 */
export declare function apply(ctx: Context, config: Config): void;
