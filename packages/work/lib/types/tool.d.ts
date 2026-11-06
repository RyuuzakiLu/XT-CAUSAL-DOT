import type { Context } from '@deepseek-ai/cordis';
import type { DotWorkService } from './service.ts';
/** 本轮是不是飞书群里只读成员发的。 */
export declare function feishuGroupGuestTurn(exec: unknown): boolean;
export declare const GUEST_WORK_SCOPES: readonly ["research", "code-audit"];
/** 只读成员派活：scope 必须是两类之一；goal 前面钉上只读约束，交给后台 worker。 */
export declare function guestWorkGoal(goal: string, scope: string | undefined): string;
/**
 * 注册 DOT 工作工具。
 * @param ctx - 挂载作用域（preset 决定哪些 Agent 拿到这些工具）
 * @param work - 本包业务服务
 * @returns 注册 disposer（由 ctx.tools 自带，无需手管）
 */
export declare function registerWorkTools(ctx: Context, work: DotWorkService): void;
