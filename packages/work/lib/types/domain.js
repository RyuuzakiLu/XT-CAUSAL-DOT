/* ================================================================
   DOT 工作插件 · 领域规则（纯函数，无 I/O）

   ▍这是什么
   ① 干什么：工作状态机的判定、持久记录 → wire 快照的投影、取消/重试资格、
      计划时间规则到原生 schedule 选择器的翻译。全部是纯函数：给定输入必有同一输出。
   ② 技术栈：纯 TypeScript；不碰 ctx、不碰存储、不碰时间以外的一切。
   ③ 依赖：只依赖本包 types.ts 与 contracts 的形状；
      时间由调用方传入（`now`），因此测试可以确定性地驱动状态迁移。
   ④ 给谁看：改状态机的人（先读这里再动 service）、写测试的人（直接喂这里）。

   ▍结构
   状态迁移判定   —— 谁能变成谁，非法迁移一律拒绝而不是静默接受
   快照投影       —— 持久记录 → 界面快照（唯一一份投影，别处不得各写一遍）
   资格判定       —— 能否取消 / 能否重试
   计划翻译       —— DOT 计划时间 → 原生 schedule 的 create/update 请求

   ▍修改铁律
   1. 【不】把补丁写进投影：界面看到的是事实，不是"算一下让数字好看"。
   2. 【不】让终态再回到推进态：历史记录一旦终态，只有"重试产生新工作"这一条路。
   3. 【不】在纯函数里读 `Date.now()`：时间一律由参数传入，否则测试无法复现。
   4. 百分比【不】猜：`progress` 只在调用方给得出可靠依据时传进来，否则保持 undefined。

   ▍外号表
   "推进态"   → ACTIVE 状态集合（queued/running/waiting-input/waiting-approval）
   "终态"     → TERMINAL 状态集合（succeeded/failed/cancelled/interrupted）
   "说不准"   → `unknown`：记录在、状态对不上，界面按"待核实"显示，不谎称失败或完成

   ▍更新记录
   2026-10-23 · 建立：状态迁移表、快照投影、取消/重试资格、计划时间翻译。
   ================================================================ */
import { isActiveWork } from '@xtcausal/dot-contracts';
/* ----------------------------------------------------------------
   状态迁移判定
   ---------------------------------------------------------------- */
/**
 * 允许的状态迁移表。表里没有的组合一律拒绝——宁可让调用方看到错误，
 * 也不要让一条"已完成"的记录被悄悄改回"执行中"。
 * ⚠️ 例外只有一条：终态之间的 `interrupted → unknown`（重启后对不上执行记录时，
 * 把"明确中断"降级成"说不准"是更诚实的描述，不是进度回退）。
 */
const ALLOWED = {
    queued: ['running', 'waiting-input', 'waiting-approval', 'cancelled', 'failed', 'interrupted', 'unknown'],
    running: ['waiting-input', 'waiting-approval', 'succeeded', 'failed', 'cancelled', 'interrupted', 'unknown'],
    // 等待态可以直接成功：人答完之后模型可能当场收尾，"等待被打断"不等于"必须再跑一轮"。
    'waiting-input': ['running', 'succeeded', 'cancelled', 'failed', 'interrupted', 'unknown'],
    'waiting-approval': ['running', 'succeeded', 'cancelled', 'failed', 'interrupted', 'unknown'],
    // 终态不再迁移；重试是"新建一件工作"，不是把老记录改回去。
    succeeded: [],
    failed: [],
    cancelled: [],
    interrupted: ['unknown'],
    unknown: [],
};
/**
 * 判断一次状态迁移是否被允许。
 * @param from - 当前状态
 * @param to - 目标状态
 * @returns 允许为 true；同状态视为允许（幂等写入不报错）
 */
export function canTransition(from, to) {
    if (from === to)
        return true;
    return ALLOWED[from].includes(to);
}
/** 一份工作的"终态"判定：终态不再有任何阶段变化。 */
/**
 * 跨回合、由专门流程收口的阻塞码：凭据（credential-required）与亲自登录（login-required）。
 * 回合结束时这类阻塞不许被模型的"succeeded/failed"冲掉，工作要停在 waiting-input，
 * 由各自的监视器在用户处理完后续办（resumeCredential）或收口（abandonCredential）。
 */
export function isOwnedWait(code) {
    return code === 'credential-required' || code === 'login-required';
}
export function isTerminal(status) {
    return !isActiveWork(status) && status !== 'unknown';
}
/** 状态是否表示"在等人"（补充说明或确认）。 */
export function isWaiting(status) {
    return status === 'waiting-input' || status === 'waiting-approval';
}
/* ----------------------------------------------------------------
   回合结局判定
   ---------------------------------------------------------------- */
/**
 * `turn/end` 的 reason → 工作状态 + 失败原因。
 * 为什么单独成函数：这是"什么算成功"的唯一判定点；散在回调里就会各自解释一遍。
 * @param reason - 原生 turn/end 的 reason（结构宽松读取，未知变体按说不准处理）
 * @returns 目标状态与可选失败原因
 */
export function outcomeOfTurnEnd(reason) {
    const kind = reason?.kind;
    switch (kind) {
        case 'completed':
            return { status: 'succeeded' };
        case 'error': {
            const failure = reason.error;
            const message = typeof failure?.message === 'string' ? failure.message : '模型或执行链报错，未给出原因';
            return { status: 'failed', error: message };
        }
        case 'aborted':
            // 中止的归因（用户取消 / 进程回收 / 父级回收）由调用方按自己的取消标记再判一次；
            // 这里保守给 interrupted，绝不把中止报成 succeeded。
            return { status: 'interrupted', error: '回合被中止' };
        case 'blocked':
            // 原生把"停在需要人介入"记为 blocked；工作侧对应 waiting-input。
            return { status: 'waiting-input' };
        case 'max-tokens':
            return { status: 'failed', error: '输出达到长度上限，回合提前结束' };
        case 'interrupted':
        case 'forked':
            return { status: 'interrupted', error: '回合因宿主中断而结束' };
        default:
            // 未知变体：说"说不准"，不冒充成功也不冒充失败。
            return { status: 'unknown' };
    }
}
/* ----------------------------------------------------------------
   快照投影
   ---------------------------------------------------------------- */
/**
 * 把持久记录投影成界面快照。
 * 为什么必须有这一个函数：工作空间、临时卡、精灵提示、星邮匣都读同一份事实；
 * 各自投影一遍，迟早出现"列表说完成了、卡片说还在跑"。
 * @param record - 权威持久记录
 * @returns 契约形状的工作快照（深拷贝步骤与成果数组，避免调用方改到存储对象）
 */
export function toSnapshot(record) {
    return {
        id: record.id,
        goal: record.goal,
        status: record.status,
        stage: record.stage,
        ...(record.progress === undefined ? {} : { progress: record.progress }),
        revision: record.revision,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        ...(record.sessionId === undefined ? {} : { sessionId: record.sessionId }),
        origin: record.origin,
        steps: record.steps.map(step => ({ ...step })),
        artifacts: record.artifacts.map(artifact => ({ ...artifact })),
        ...(record.blocked === undefined ? {} : { blocked: { ...record.blocked } }),
        /* R2：把续办投递痕迹带进快照——界面要能显示「上次没送到，可以重试」。 */
        ...(record.credentialResume === undefined ? {} : { credentialResume: { ...record.credentialResume } }),
        ...(record.error === undefined ? {} : { error: record.error }),
        ...(record.queuedReason === undefined ? {} : { queuedReason: record.queuedReason }),
    };
}
/**
 * 由目标文本得出短标题。
 * 为什么不问模型要标题：交代工作是同步操作，多一次模型调用会让"登记"变慢且可能失败。
 * @param goal - 用户原话
 * @param limit - 最大字符数，默认 40
 * @returns 首行截断后的标题；空目标返回固定占位，不返回空串
 */
export function titleFromGoal(goal, limit = 40) {
    const firstLine = goal.trim().split(/\r?\n/u)[0]?.trim() ?? '';
    if (firstLine.length === 0)
        return '未命名工作';
    return firstLine.length <= limit ? firstLine : `${firstLine.slice(0, limit - 1)}…`;
}
/**
 * 组装下一步骤记录：步骤只增不改，序号由已有长度决定。
 * @param steps - 现有步骤
 * @param label - 面向人的步骤名
 * @param now - 当前时间（ISO-8601）
 * @returns 新步骤数组（不修改入参）
 */
export function appendStep(steps, label, now) {
    return [...steps, { index: steps.length + 1, label, status: 'running', startedAt: now }];
}
/**
 * 把最后一个进行中的步骤收尾。
 * @param steps - 现有步骤
 * @param status - 结束状态
 * @param now - 当前时间
 * @param error - 失败原因（仅 failed 时给）
 * @returns 新步骤数组；没有进行中的步骤时原样返回
 */
export function finishRunningStep(steps, status, now, error) {
    const index = steps.findLastIndex(step => step.status === 'running');
    if (index < 0)
        return steps;
    return steps.map((step, at) => at !== index
        ? step
        : { ...step, status, finishedAt: now, ...(status === 'failed' && error !== undefined ? { error } : {}) });
}
/* ----------------------------------------------------------------
   资格判定
   ---------------------------------------------------------------- */
/**
 * 能否取消：只有"推进态"可取消。终态再取消只会让用户以为撤回了什么。
 * @param status - 当前状态
 * @returns 可取消为 true
 */
export function isCancellable(status) {
    return isActiveWork(status);
}
/**
 * 能否重试：结束得"不成功"才值得重试；已完成的工作重试只会白花钱。
 * `unknown` 也允许重试——用户核实后决定重来，是合理路径。
 * @param status - 当前状态
 * @returns 可重试为 true
 */
export function isRetryable(status) {
    return status === 'failed' || status === 'interrupted' || status === 'cancelled' || status === 'unknown';
}
/**
 * 由观察到的事实推断"外部动作能追到哪一步"。
 * 为什么必须分开报告：取消只保证不再往下做；已经发出去的搜索/写入/消息撤不回，
 * 谎称撤回比承认不确定更糟。
 * @param observedToolCalls - 该工作执行期间观察到过的工具调用次数
 * @returns 记录用的可达性取值
 */
export function externalReachOf(observedToolCalls) {
    return observedToolCalls > 0 ? 'observed-may-have-happened' : 'none-observed';
}
/* ----------------------------------------------------------------
   计划时间翻译
   ---------------------------------------------------------------- */
/**
 * 把 DOT 的计划时间规则翻成原生 schedule 的 create 请求字段。
 * 为什么翻译而不是自造时间规则：官方 schedule 已经处理了夏令时空缺、时区、
 * cron 规范化与重启补发；再写一套只会多一份会漂移的实现。
 * @param timing - DOT 计划时间
 * @returns 只含一个选择器的原生请求片段
 */
export function scheduleSelectorOf(timing) {
    switch (timing.kind) {
        case 'at':
            return { at: timing.at };
        case 'every':
            return { every_seconds: timing.everySeconds };
        case 'daily':
            return { daily: { time: timing.time, time_zone: timing.timeZone } };
        case 'weekly':
            return { weekly: { time: timing.time, time_zone: timing.timeZone, weekdays: [...timing.weekdays] } };
        case 'cron':
            return { cron: { expression: timing.expression, time_zone: timing.timeZone } };
    }
}
/**
 * 由原生 schedule 记录反推 DOT 计划时间规则（用于列出计划时显示）。
 * @param record - 原生 schedule 返回的记录（只读三个我们关心的字段）
 * @returns DOT 时间规则；不认识的种类返回 undefined，界面显示"无法识别的规则"而不是瞎猜
 */
export function timingOfScheduleRecord(record) {
    switch (record.kind) {
        case 'after':
        case 'at':
            return { kind: 'at', at: record.scheduledAt };
        case 'every':
            return record.everySeconds === undefined ? undefined : { kind: 'every', everySeconds: record.everySeconds };
        case 'daily':
            return record.time === undefined || record.timeZone === undefined
                ? undefined
                : { kind: 'daily', time: record.time, timeZone: record.timeZone };
        case 'weekly':
            return record.time === undefined || record.timeZone === undefined || record.weekdays === undefined
                ? undefined
                : { kind: 'weekly', time: record.time, timeZone: record.timeZone, weekdays: [...record.weekdays] };
        case 'cron':
            return record.expression === undefined || record.timeZone === undefined
                ? undefined
                : { kind: 'cron', expression: record.expression, timeZone: record.timeZone };
        default:
            return undefined;
    }
}
/**
 * 把计划记录投影成界面视图。
 * @param plan - DOT 计划记录
 * @param nextAt - 原生 schedule 当前给的下一次触发时间（可能没有）
 * @returns 计划视图
 */
export function toPlanView(plan, nextAt) {
    return {
        planId: plan.planId,
        scheduleId: plan.scheduleId,
        title: plan.title,
        goal: plan.goal,
        timing: plan.timing,
        ...(nextAt === undefined ? {} : { nextAt }),
        paused: plan.paused,
        cancelled: plan.cancelled,
        ...(plan.lastWorkId === undefined ? {} : { lastWorkId: plan.lastWorkId }),
        ...(plan.sessionId === undefined ? {} : { sessionId: plan.sessionId }),
    };
}
/**
 * 收尾时该登记哪些成果——**一次决策，两条都不漏**。
 * ⚠️ 为什么单独成纯函数：真实工作最常见的情况就是"既给了一段总结，又生成了文件"。
 * 之前把两件事写成互斥分支（有文字就 return），文件成果会被静默吞掉；
 * 抽成纯函数后可以直接测试这个组合，而不用起会话。
 * @param finalText - 本回合最终助手文本（可空）
 * @param presentedFiles - present 工具声明过的文件（可空）
 * @returns 待登记的成果意图，顺序：先文字后文件
 */
export function artifactIntentsOf(finalText, presentedFiles) {
    const intents = [];
    if (finalText !== undefined && finalText.trim().length > 0) {
        intents.push({ kind: 'text', title: '执行结果', text: finalText });
    }
    for (const file of presentedFiles ?? []) {
        intents.push({
            kind: 'file',
            title: file.description?.trim() || file.path,
            path: file.path,
        });
    }
    return intents;
}
/**
 * 成果引用投影：把成果正文记录裁成轻量引用。
 * 为什么快照里不带正文：查进度会变成搬附件；正文按需单读，插件停用也还能打开。
 * @param record - 成果正文记录
 * @returns 轻量引用
 */
export function artifactRefOf(record) {
    const base = {
        id: record.id,
        workId: record.workId,
        kind: record.kind,
        title: record.title,
        createdAt: record.createdAt,
        mimeType: record.mimeType,
    };
    if (record.kind === 'text') {
        return { ...base, charLength: record.text?.length ?? 0 };
    }
    return { ...base, ...(record.byteLength === undefined ? {} : { byteLength: record.byteLength }) };
}
