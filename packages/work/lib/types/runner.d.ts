import type { Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { WorkId, WorkStatus } from '@xtcausal/dot-contracts';
import type { WorkBlockKind } from './types.ts';
/** 一件工作在执行期发生的、需要写回记录的事实增量。 */
export interface RunnerFacts {
    /** 阶段描述变化（给人看）。 */
    readonly stage?: string;
    /** 状态变化；只有结局判定与阻塞变化会带这个字段。 */
    readonly status?: WorkStatus;
    /** 新增步骤（追加到尾部）。 */
    readonly pushStep?: string;
    /** 结束当前进行中的步骤。 */
    readonly finishStep?: {
        readonly status: 'done' | 'failed';
        readonly error?: string;
    };
    /** 阻塞说明；`null` 表示解除阻塞。 */
    readonly blocked?: {
        readonly kind: WorkBlockKind;
        readonly message: string;
        readonly code: string;
        readonly risk?: string;
    } | null;
    /** 失败原因（仅 failed 时给）。 */
    readonly error?: string;
    /** 观察到的工具调用次数累加（用于取消时如实报告外部动作）。 */
    readonly toolCalls?: number;
    /** 本回合最终助手文本；作为文字成果的候选正文。 */
    readonly finalText?: string;
    /** present 工具声明过的文件路径（成功回合才登记为文件成果）。 */
    readonly presentedFiles?: readonly {
        readonly path: string;
        readonly description?: string;
    }[];
    /** 这次观察到的工具名（被打断后判断"只读、可自动重做"用，见 service.recover）。 */
    readonly toolName?: string;
    /** 这次请过用户确认/回答（审批或 ask_user_question）；一旦为真，被打断后不自动重做。 */
    readonly askedUser?: boolean;
}
/** 服务层交给执行引擎的能力面（引擎不直接写存储，避免两份真相）。 */
export interface RunnerHost {
    /** 读当前持久记录里的会话绑定与已观察到的工具调用数。 */
    readonly factsOf: (workId: WorkId) => Promise<{
        readonly sessionId?: string;
        readonly toolCalls: number;
    }>;
    /** 写回一次事实增量并持久化；返回是否仍然存活（工作未被取消/删除）。 */
    readonly apply: (workId: WorkId, facts: RunnerFacts) => Promise<void>;
    /** 回合结束、工作已落终态时的通知（用于排队出队与星邮匣）。 */
    readonly settled: (workId: WorkId) => void;
    /**
     * 新建后台会话时要带的参数（`cwd` = 个人工作区、`agentPreset` = ASTRA）。
     * ⚠️ 不能在这里自己拼 `process.cwd()`：那是工程根，模型关掉终端后还能读到项目配置，
     * 用户想让它写的文件也不在"他的文件区"。文件根只能由部署配置决定。
     */
    readonly createRequest: () => {
        readonly cwd?: string;
        readonly agentPreset?: string;
    };
}
/**
 * 从 `tool/result` 的 tool-private `meta` 里认出"刚创建了一个文件成果"。
 * 为什么走 meta 而不是解析中文正文：meta 是原生持久化的结构化载荷（`dot.artifact` 标记），
 * 文案改了也不会断；而 `dot_write_artifact` 的 render 文本是给人看的，不该被机器解析。
 * @param meta - 事件里的 `meta` 字段（任意 JSON）
 * @returns 命中的文件引用；不是成果创建、或字段不合法时 undefined
 */
export declare function artifactMetaOf(meta: unknown): {
    readonly path: string;
    readonly title?: string;
    readonly bytes?: number;
    readonly mimeType?: string;
} | undefined;
/**
 * 一件工作的执行脚本：启动一次原生会话回合，观察它到终局，然后释放订阅。
 * ⚠️ 一个实例只服务一件工作的一段执行；重试会新建工作、新建脚本。
 */
export declare function inputRequestId(workId: string, sessionId: string, operationId: string): string;
export declare class DotWorkRunner {
    private readonly ctx;
    private readonly workId;
    private readonly host;
    private disposeObserver;
    /** 本回合观察到的工具调用计数（不含历史）。 */
    private toolCalls;
    /** 本回合最终助手文本（可能有多段，取最后一段非空）。 */
    private finalText;
    /**
     * 本回合登记为文件成果的候选，按**路径去重**。
     * 为什么必须去重：模型常常先用 `dot_write_artifact` 写文件，再 `present` 同一条路径；
     * 不去重会登记两份指向同一文件的成果，界面上就出现"两个一模一样的结果"。
     */
    private readonly presentedByPath;
    /** 用户是否已要求取消：决定中止原因是"用户取消"还是"宿主中断"。 */
    private cancelRequested;
    /**
     * 已经交出终局事实的次数（不是布尔）。
     *
     * ▍为什么必须计数（R1-C，2026-10-28，实测抓到）
     * 首版是个布尔 `settled`：第一次 turn/end 之后它永久为真，观察者也被 dispose 了。
     * 但"等你交钥匙"这条路上的工作会**先**正常收尾一次（工具超时、模型交还回合），
     * 用户处理完再由 resumeCredential 补一句话——那条脚本必须能重新听见**新回合**。
     * 用布尔的话，续办把话投进去以后没人接事件，工作永远停在 running（实测就是这样）。
     * 现在每交一次终局加一；resumeCredential 复用脚本时会重置计数并重新挂上观察者。
     */
    private readonly initialDispatch;
    private settledCount;
    private readonly queuedInputs;
    private deferredEnd;
    /** 是否已经为**当前这一轮**交出过终局。 */
    private get settled();
    /**
     * 本脚本绑定的原生会话。
     * ⚠️ 为什么要自己记一份：记录里的 `sessionId` 是异步写回的，
     * "刚进入 running、会话已建好但记录还没写完"这段窗口里，
     * 用户点取消/补充会读到没有会话的旧记录而失败——脚本自己记着就不会。
     */
    private boundSession;
    /** 当前是否处于等确认（approval 问出未答）。 */
    private awaitingApproval;
    /** 当前是否处于等用户回答（ask_user_question 工具未返回）。 */
    private awaitingInput;
    /**
     * 事件串行队列。
     * 为什么必须串：`session/event` 是同步 emit，密集的 tool/call 与 turn/end 会挤在同一
     * 微任务里；而每次写回都要 await 存储。若不排队，turn/end 的终局写可能抢在
     * 前面的事实写之前落盘，导致最终文本丢失或出现非法状态迁移。
     */
    private chain;
    /**
     * @param ctx - Host 上下文（用 sessionController 建会话/prompt/cancel，用 events 观察）
     * @param workId - 这件工作的稳定 ID
     * @param host - 服务层给的回写能力（含新建会话的 cwd / preset）
     */
    constructor(ctx: Context, workId: WorkId, host: RunnerHost);
    /**
     * 启动执行：复用已绑定会话，或新建一个；然后投递目标文本并开始观察。
     * 为什么要自己观察而不是等 notify：工作状态是 DOT 的事实，必须由 DOT 从原生事件翻译，
     * 不能靠会话列表轮询猜测。
     * @param goal - 交代给 ASTRA 的目标文本（用户原话，不改写）
     * @param signal - 插件生命周期信号；中止时释放订阅但不谎报取消
     * @param onSession - 会话一建好就回调，让服务层立刻把 sessionId 写进记录
     *   （否则"建好会话 → 还没写记录"这段窗口里，补充/取消会报"没有会话"）
     * @returns 绑定的原生会话 ID
     */
    start(goal: string, signal: AbortSignal, onSession?: (sessionId: SessionId) => Promise<void>): Promise<SessionId>;
    private startSession;
    /**
     * 重启后重新接上原会话：只恢复观察，不再投递目标。
     * 为什么不能再投一次：上一次可能已经把外部动作做出去了，重发等于干两遍。
     * @param sessionId - 记录里绑定的原生会话
     * @param signal - 生命周期信号
     */
    reattach(sessionId: SessionId, signal: AbortSignal): void;
    /**
     * 往这件工作的会话里补一句话。
     * 用途有两种，语义不同但走同一个原生入口：等待输入时给答案、执行中追加要求。
     *
     * ⚠️ R1-C（2026-10-28）：如果这条脚本上一轮已经交过终局（`settledCount > 0`），
     * 它的观察者在 settle 时就 dispose 了——此时补话**必须**先把观察者重新挂上，
     * 否则用户处理完之后模型接着干的那些事件没人接，工作会永远停在 running。
     * @param text - 用户补充的文本（已由服务层做非空校验）
     * @param signal - 生命周期信号
     */
    supplement(text: string, signal: AbortSignal, operationId?: string): Promise<void>;
    /**
     * 请求取消：先向原生会话请求中止，再如实记录"能不能撤回"。
     * ⚠️ 不在这里写终态——终态由 turn/end（或会话已不在）决定，避免"取消了但回合还在跑"的双话。
     * @param signal - 生命周期信号
     * @returns 是否成功把中止请求交给原生 Agent
     */
    cancel(signal: AbortSignal): Promise<boolean>;
    /** 释放观察者。插件卸载、工作终态、重试替换时都必须调。 */
    dispose(): void;
    private requestId;
    private prompt;
    /**
     * 订阅该会话的原生事件，把回合事实翻译成工作事实。
     * @param sessionId - 目标会话
     * @param signal - 生命周期信号（中止时自动释放）
     */
    private observe;
    /**
     * 单条事件 → 事实增量。
     * ⚠️ 这里【不】做终局以外的状态跳跃：中间只更新阶段、步骤与阻塞。
     * @param event - 原生会话事件（结构化读取，未知类型静默忽略）
     */
    private onEvent;
    /**
     * 落终局：把 turn/end 的 reason 翻成状态，并交出成果候选。
     * 判定顺序：用户取消优先（中止是取消造成的），再按原生 reason。
     * @param data - turn/end 的事件载荷
     */
    private settle;
}
/**
 * 读取一个 Agent 是否还存在（用于重启后判断"说不准"）。
 * 为什么只读 registry 而不是 resolveAgent：恢复期不该为了判断状态而唤醒会话、消耗模型。
 * @param ctx - Host 上下文
 * @param sessionId - 会话身份
 * @returns 是否有活 Agent
 */
export declare function hasLiveAgent(ctx: Context, sessionId: string): boolean;
