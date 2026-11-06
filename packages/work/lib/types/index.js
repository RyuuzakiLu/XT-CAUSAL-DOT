import { DotWorkService } from "./service.js";
import { registerWorkTools } from "./tool.js";
export { DotWorkService } from "./service.js";
export { DotWorkRunner } from "./runner.js";
export { dotWorkDomain } from "./storage.js";
export { pickWorkForQuery, matchScore } from "./work-match.js";
export { appendStep, artifactIntentsOf, artifactRefOf, canTransition, externalReachOf, finishRunningStep, isCancellable, isRetryable, isTerminal, isWaiting, outcomeOfTurnEnd, scheduleSelectorOf, timingOfScheduleRecord, titleFromGoal, toPlanView, toSnapshot, } from "./domain.js";
/** Loader 诊断里显示的名字。 */
export const name = 'dot-work';
/**
 * 必需依赖：会话业务面（真实执行）、会话存储（读 header cwd）、
 * 持久域（写工作记录）、Agent 注册表（重启后判断会话是否还活着）、工具注册表。
 * ⚠️ `schedule` 故意不在这里：计划是可选能力，缺它就只在调用计划方法时报稳定错误码，
 * 而不是让整个工作插件永远等不到依赖（那样连"交代一件工作"都做不了）。
 */
export const inject = ['sessionController', 'sessions', 'storageDomain', 'agents', 'tools'];
export { Config } from "./service.js";
/**
 * 装配 DOT 工作领域。
 * @param ctx - 挂载作用域
 * @param config - 已解析部署策略
 */
export function apply(ctx, config) {
    const work = new DotWorkService(ctx, config);
    // 服务由构造函数自注册到 ctx.dotWork；这里只负责把工具与清理接上。
    /* 云端工作服务已按账号分区（owner + requireOwned，见 cloud.ts），云端也注册模型工具。 */
    registerWorkTools(ctx, work);
    // 星邮匣比本插件晚就位时补发未登记终态：监听服务绑定事件，一次就够。
    ctx.effect(() => {
        const stop = ctx.on('internal/service', (name, value) => {
            if (name !== 'dotPostbox' || value === undefined)
                return;
            void work.notifyPostboxReady();
        });
        return () => { stop(); };
    }, 'dot-work: postbox ready()');
}
