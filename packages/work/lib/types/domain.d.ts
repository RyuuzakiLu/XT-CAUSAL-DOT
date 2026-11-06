import { type ArtifactRef, type WorkId, type WorkSnapshot, type WorkStatus } from '@xtcausal/dot-contracts';
import type { ExternalActionReach, PlanRecord, WorkPlanTiming, WorkRecord, WorkStepRecord } from './types.ts';
/**
 * 判断一次状态迁移是否被允许。
 * @param from - 当前状态
 * @param to - 目标状态
 * @returns 允许为 true；同状态视为允许（幂等写入不报错）
 */
export declare function canTransition(from: WorkStatus, to: WorkStatus): boolean;
/** 一份工作的"终态"判定：终态不再有任何阶段变化。 */
/**
 * 跨回合、由专门流程收口的阻塞码：凭据（credential-required）与亲自登录（login-required）。
 * 回合结束时这类阻塞不许被模型的"succeeded/failed"冲掉，工作要停在 waiting-input，
 * 由各自的监视器在用户处理完后续办（resumeCredential）或收口（abandonCredential）。
 */
export declare function isOwnedWait(code: string | undefined): boolean;
export declare function isTerminal(status: WorkStatus): boolean;
/** 状态是否表示"在等人"（补充说明或确认）。 */
export declare function isWaiting(status: WorkStatus): boolean;
/**
 * `turn/end` 的 reason → 工作状态 + 失败原因。
 * 为什么单独成函数：这是"什么算成功"的唯一判定点；散在回调里就会各自解释一遍。
 * @param reason - 原生 turn/end 的 reason（结构宽松读取，未知变体按说不准处理）
 * @returns 目标状态与可选失败原因
 */
export declare function outcomeOfTurnEnd(reason: unknown): {
    readonly status: WorkStatus;
    readonly error?: string;
};
/**
 * 把持久记录投影成界面快照。
 * 为什么必须有这一个函数：工作空间、临时卡、精灵提示、星邮匣都读同一份事实；
 * 各自投影一遍，迟早出现"列表说完成了、卡片说还在跑"。
 * @param record - 权威持久记录
 * @returns 契约形状的工作快照（深拷贝步骤与成果数组，避免调用方改到存储对象）
 */
export declare function toSnapshot(record: WorkRecord): WorkSnapshot;
/**
 * 由目标文本得出短标题。
 * 为什么不问模型要标题：交代工作是同步操作，多一次模型调用会让"登记"变慢且可能失败。
 * @param goal - 用户原话
 * @param limit - 最大字符数，默认 40
 * @returns 首行截断后的标题；空目标返回固定占位，不返回空串
 */
export declare function titleFromGoal(goal: string, limit?: number): string;
/**
 * 组装下一步骤记录：步骤只增不改，序号由已有长度决定。
 * @param steps - 现有步骤
 * @param label - 面向人的步骤名
 * @param now - 当前时间（ISO-8601）
 * @returns 新步骤数组（不修改入参）
 */
export declare function appendStep(steps: readonly WorkStepRecord[], label: string, now: string): readonly WorkStepRecord[];
/**
 * 把最后一个进行中的步骤收尾。
 * @param steps - 现有步骤
 * @param status - 结束状态
 * @param now - 当前时间
 * @param error - 失败原因（仅 failed 时给）
 * @returns 新步骤数组；没有进行中的步骤时原样返回
 */
export declare function finishRunningStep(steps: readonly WorkStepRecord[], status: 'done' | 'failed', now: string, error?: string): readonly WorkStepRecord[];
/**
 * 能否取消：只有"推进态"可取消。终态再取消只会让用户以为撤回了什么。
 * @param status - 当前状态
 * @returns 可取消为 true
 */
export declare function isCancellable(status: WorkStatus): boolean;
/**
 * 能否重试：结束得"不成功"才值得重试；已完成的工作重试只会白花钱。
 * `unknown` 也允许重试——用户核实后决定重来，是合理路径。
 * @param status - 当前状态
 * @returns 可重试为 true
 */
export declare function isRetryable(status: WorkStatus): boolean;
/**
 * 由观察到的事实推断"外部动作能追到哪一步"。
 * 为什么必须分开报告：取消只保证不再往下做；已经发出去的搜索/写入/消息撤不回，
 * 谎称撤回比承认不确定更糟。
 * @param observedToolCalls - 该工作执行期间观察到过的工具调用次数
 * @returns 记录用的可达性取值
 */
export declare function externalReachOf(observedToolCalls: number): ExternalActionReach;
/**
 * 把 DOT 的计划时间规则翻成原生 schedule 的 create 请求字段。
 * 为什么翻译而不是自造时间规则：官方 schedule 已经处理了夏令时空缺、时区、
 * cron 规范化与重启补发；再写一套只会多一份会漂移的实现。
 * @param timing - DOT 计划时间
 * @returns 只含一个选择器的原生请求片段
 */
export declare function scheduleSelectorOf(timing: WorkPlanTiming): {
    readonly at: string;
} | {
    readonly every_seconds: number;
} | {
    readonly daily: {
        readonly time: string;
        readonly time_zone: string;
    };
} | {
    readonly weekly: {
        readonly time: string;
        readonly time_zone: string;
        readonly weekdays: number[];
    };
} | {
    readonly cron: {
        readonly expression: string;
        readonly time_zone: string;
    };
};
/**
 * 由原生 schedule 记录反推 DOT 计划时间规则（用于列出计划时显示）。
 * @param record - 原生 schedule 返回的记录（只读三个我们关心的字段）
 * @returns DOT 时间规则；不认识的种类返回 undefined，界面显示"无法识别的规则"而不是瞎猜
 */
export declare function timingOfScheduleRecord(record: {
    readonly kind: string;
    readonly scheduledAt: string;
    readonly everySeconds?: number;
    readonly time?: string;
    readonly timeZone?: string;
    readonly weekdays?: readonly number[];
    readonly expression?: string;
}): WorkPlanTiming | undefined;
/**
 * 把计划记录投影成界面视图。
 * @param plan - DOT 计划记录
 * @param nextAt - 原生 schedule 当前给的下一次触发时间（可能没有）
 * @returns 计划视图
 */
export declare function toPlanView(plan: PlanRecord, nextAt: string | undefined): {
    planId: string;
    scheduleId: string;
    title: string;
    goal: string;
    timing: WorkPlanTiming;
    nextAt?: string;
    paused: boolean;
    cancelled: boolean;
    lastWorkId?: WorkId;
    sessionId?: string;
};
/**
 * 收尾时该登记哪些成果——**一次决策，两条都不漏**。
 * ⚠️ 为什么单独成纯函数：真实工作最常见的情况就是"既给了一段总结，又生成了文件"。
 * 之前把两件事写成互斥分支（有文字就 return），文件成果会被静默吞掉；
 * 抽成纯函数后可以直接测试这个组合，而不用起会话。
 * @param finalText - 本回合最终助手文本（可空）
 * @param presentedFiles - present 工具声明过的文件（可空）
 * @returns 待登记的成果意图，顺序：先文字后文件
 */
export declare function artifactIntentsOf(finalText: string | undefined, presentedFiles: readonly {
    readonly path: string;
    readonly description?: string;
}[] | undefined): readonly ({
    readonly kind: 'text';
    readonly title: string;
    readonly text: string;
} | {
    readonly kind: 'file';
    readonly title: string;
    readonly path: string;
})[];
/**
 * 成果引用投影：把成果正文记录裁成轻量引用。
 * 为什么快照里不带正文：查进度会变成搬附件；正文按需单读，插件停用也还能打开。
 * @param record - 成果正文记录
 * @returns 轻量引用
 */
export declare function artifactRefOf(record: {
    readonly id: string;
    readonly workId: WorkId;
    readonly kind: 'text' | 'file';
    readonly title: string;
    readonly createdAt: string;
    readonly mimeType: string;
    readonly text?: string;
    readonly byteLength?: number;
}): ArtifactRef;
