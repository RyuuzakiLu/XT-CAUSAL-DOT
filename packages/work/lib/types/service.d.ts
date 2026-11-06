import { type PageQuery, type ContextPage } from './context-page.ts';
import { Service, type Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { type WorkId, type WorkSnapshot, type WorkStatus } from '@xtcausal/dot-contracts';
import { type Evidence } from './work-resolution.ts';
import { type WorkPick } from './work-match.ts';
import type { WorkCancelRequest, WorkCancelValue, WorkCreateRequest, WorkCreateValue, WorkFollowFrame, WorkFollowRequest, WorkGetRequest, WorkGetValue, WorkListRequest, WorkListValue, WorkPlanCancelRequest, WorkPlanCancelValue, WorkPlanCreateRequest, WorkPlanCreateValue, WorkPlanListRequest, WorkPlanListValue, WorkPlanPauseRequest, WorkPlanPauseValue, WorkArtifactRequest, WorkArtifactValue, WorkArtifactsRequest, WorkArtifactsValue, WorkPlanUpdateRequest, WorkPlanUpdateValue, WorkRecord, WorkRetryRequest, WorkRetryValue, WorkSupplementRequest, WorkSupplementValue, WorkAnnotateBlockedRequest, WorkAnnotateBlockedValue, WorkResumeCredentialRequest, WorkResumeCredentialValue, WorkAbandonCredentialRequest, WorkAbandonCredentialValue } from './types.ts';
export type * from './types.ts';
declare module '@deepseek-ai/dsh-typert-protocol' {
    interface RemoteErrorDetailsMap {
        /** 没有这件工作（可能已被清库，或 workId 传错）。 */
        'work/not-found': {
            readonly workId: string;
        };
        /** 这件工作当前不允许该动作（例如已完成还想取消）。 */
        'work/not-actionable': {
            readonly workId: string;
            readonly status: WorkStatus;
            readonly action: string;
        };
        /** 参数不合格（空目标、空补充文本、非法 limit 等）。 */
        'work/bad-request': {
            readonly field: string;
            readonly reason: string;
        };
        /** 原生会话侧失败（建会话被拒、prompt 被拒等）；原始错误挂在 cause 上。 */
        'work/session-failed': {
            readonly workId: string;
            readonly reason: string;
        };
        /** 计划不存在或已被原生删除。 */
        'work/plan-not-found': {
            readonly scheduleId: string;
        };
        /** 原生计划服务没有就位（部署未挂 schedule）。 */
        'work/plan-unavailable': {
            readonly reason: string;
        };
    }
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** DOT 工作领域服务：工作事实的唯一所有者，也是 `dotWork` Remote 命名空间 owner。 */
        dotWork: DotWorkService;
    }
    interface Events {
        /**
         * 一件工作的快照发生变化（同进程消费者用；跨端订阅走 `dotWork.follow` 流）。
         * @param snapshot - 变化后的完整快照
         * @mode emit
         */
        'dot-work/changed'(snapshot: WorkSnapshot): void;
        /**
         * 有页面打开了工作列表（用户回到 DOT）。登录/授权入口过期后，凭证插件借此换新链接。
         * @param event - 打开者账号（云端）
         * @mode emit
         */
        'dot-work/viewer'(event: {
            readonly actor?: string;
        }): void;
    }
}
/** 部署策略。全部有安全默认值；不配也能跑。 */
export interface Config {
    /** 同时在跑的工作数上限；超出的排队（默认 2，符合 SPEC 的可配默认）。 */
    readonly maxActiveRuns?: number;
    /** 列表默认返回条数（默认 50，上限 200）。 */
    readonly listLimit?: number;
    /** 文字成果内联进存储的最大字符数；超出按文件成果落盘（默认 32 KiB）。 */
    readonly maxTextArtifactChars?: number;
    /**
     * 单件工作允许的最长墙钟时长（分钟）；超时由本插件主动请求中止并记 failed。
     * 为什么必须有：没有上限的话，一次卡住的回合会永远占着后台额度，
     * 后面的工作全排队——这就是"静默停工"。默认 60 分钟。
     */
    readonly maxRunMinutes?: number;
    /**
     * 单件工作允许的最大工具调用步数；超过即请求中止并记 failed。
     * 为什么不用"步数预估"：只有真实事件才知道走了几步，预估只会变成假进度。
     * 默认 100。
     */
    readonly maxToolSteps?: number;
    /** 成果文件落盘目录；省略时用 `<workRoot>/dot-artifacts`。 */
    readonly artifactDir?: string;
    /**
     * 后台工作与计划会话的文件根（个人工作区）。
     * 为什么必须显式给：不传 `cwd` 时原生会话落在**进程当前目录**——
     * 那是工程根，不是用户的工作区。关掉终端后模型仍能读到工程配置、项目源码，
     * 而用户想让它写的文件也不在"他的文件区"里。
     */
    readonly workRoot?: string;
    /**
     * 后台会话使用的 agent preset（组合层给的是 `astra`）。
     * 为什么必须显式给：省略时宿主用默认 preset——那是 coding 身份，
     * 后台干活就会带着工程上下文、用错人格。DOT 的后台与前台必须是同一个 ASTRA。
     */
    readonly agentPreset?: string;
}
type ResolvedConfig = Required<Omit<Config, 'artifactDir' | 'workRoot' | 'agentPreset'>> & {
    readonly artifactDir?: string;
    readonly workRoot?: string;
    readonly agentPreset?: string;
};
/**
 * 配置 schema（Loader 用它做运行时校验并填默认值）。
 * 为什么单独成常量：Loader 读的是插件导出的 `Config` 值，而本服务类内部也要同一份
 * 定义；写成一处常量、两处引用，避免两边默认值漂移。
 */
export declare const Config: z<Config, ResolvedConfig>;
/** 工作领域 Host 服务与 Remote owner。 */
export declare class DotWorkService extends TypertRemoteService {
    static inject: string[];
    static Config: z<Config, ResolvedConfig>;
    private readonly config;
    private readonly ready;
    /** 内存里已打开的表句柄集合（写入统一走这里，读也走这里）。 */
    private domain;
    /**
     * 正在**执行**（占后台额度）的工作 → 执行脚本。
     * 为什么等人工的状态不在这里：等输入/等确认时模型并没有在跑，
     * 继续占额度会让后面的工作永久排队——用户看到的是"两件都卡着，新的永远不动"。
     */
    private runners;
    /**
     * 在等人工（waiting-input / waiting-approval）的工作 → 执行脚本。
     * 观察者仍在（人一答就能继续），但**不计入** `maxActiveRuns`。
     */
    private readonly waitingRunners;
    /** 排队区：本轮没抢到后台额度的工作，按登记顺序。 */
    private readonly waiting;
    /** 插件是否在关闭：关闭后不再启动新执行。 */
    private stopping;
    /** 后台工作 → 知序待办（星邮匣）同步；没配知序时自动停用。 */
    private readonly zhixu;
    /** 全局快照版本：每次任何工作变化递增，订阅流用它判断"我这份是不是旧的"。 */
    private revision;
    /** 订阅者：整列表订阅者与单件订阅者分开存，变化时按需通知。 */
    private readonly listListeners;
    private readonly workListeners;
    /** 插件生命周期信号：卸载时中止执行脚本的观察者。 */
    private readonly lifetime;
    /** 星邮匣服务（可能不存在：显式可选依赖）。 */
    private postboxPublished;
    /** 同一提醒保存中共用一个结果；失败释放占位，留给下一次补扫重试。 */
    private readonly postboxPublishing;
    /**
     * 每件在跑工作的墙钟看门狗。
     * 为什么必须有：卡住的回合会永久占住后台额度，后面的工作全部排队——
     * 用户看到的是"没反应"，而这正是"静默停工"。
     */
    private readonly watchdogs;
    /** 每件工作累计观察到的工具调用次数（预算判定的依据，终态时清掉）。 */
    private readonly toolCallCount;
    /**
     * 用户已处理完、但当时没抢到后台额度的续办请求（workId → 补进原会话的那句话）。
     * 为什么会排队：等人工不占额度，人答完要重新占一个；满了就按顺序等，不插队也不丢。
     */
    private readonly pendingResumes;
    /**
     * 每件工作一把写锁（workId → 排队尾）。让"读记录→改→写回"不会互相覆盖。
     * 见 {@link withWorkLock}：三条写路径交错时，没有这把锁会把对方刚写的 blocked 抹掉。
     */
    private readonly workLocks;
    private dotGate;
    private dotRelayed;
    private dotSweeping;
    private readonly dotProgressAt;
    private readonly dotProgressTimers;
    /**
     * @param ctx - Host 上下文
     * @param config - 已解析部署策略
     */
    constructor(ctx: Context, config: Config);
    /** Cordis 初始化钩子：等域打开，让服务在可用之前不被消费者当成就绪。 */
    [Service.init](): Promise<void>;
    /**
     * 列出工作快照（按更新时间倒序）。
     * @param request - 状态过滤、条数、游标
     * @returns 快照数组 + 当前全局 revision
     */
    list(request?: WorkListRequest): Promise<WorkListValue>;
    /**
     * 取一件工作的详情。
     * @param request - 工作 ID
     * @returns 快照 + 内部事实 + 可取消/可重试标记
     */
    get(request: WorkGetRequest): Promise<WorkGetValue>;
    /**
     * 登记一件工作并尽快开始执行。
     * 幂等：同一 operationId 重复提交返回同一件工作（created:false），不会干两遍。
     * @param request - 目标、幂等键、可选标题
     * @returns 工作快照与是否新建
     */
    create(request: WorkCreateRequest): Promise<WorkCreateValue>;
    private frontOriginOf;
    createFollowup(parentId: WorkId, revision: number, adjustment: string, operationId: string, reservedId?: WorkId): Promise<WorkCreateValue>;
    private createRecord;
    /**
     * 补充说明：把用户追加的话送进该工作的会话。
     * @param request - 工作 ID、文本、可选幂等键
     * @returns 是否被原生会话收下 + 最新快照
     */
    supplement(request: WorkSupplementRequest): Promise<WorkSupplementValue>;
    /**
     * 用户处理完「等你交钥匙」之后，让**原来那件工作**接着跑。
     *
     * ▍为什么需要它（R1-C，2026-10-28）
     * 工具能等的时间有限；用户可能几分钟也可能几小时后才去填。工具超时返回后，
     * 模型这一回合就结束了，原生给 turn/end —— 工作按设计停在 `waiting-input`
     * （见 applyFacts 里的 credential-required 判据），**但此时没有任何东西会去叫醒它**。
     * 没有这个方法，用户填完就只是"工作卡上的入口消失了"，原任务永远不动。
     *
     * ▍一次性
     * 幂等键固定成 `credential:<requestId>`：同一个入口处理完只会续办一次——
     * 刷新、重复回调、重启后补扫都不会让同一件事干第二遍。
     *
     * ▍不重发目标
     * 只往**原会话**补一句"已经好了，接着做"，不像重试那样新建工作/重发 goal。
     *
     * @param request - 工作 ID、请求编号（broker 的 req_…）、要补进会话的那句话
     * @returns 最新快照与是否真的续办了
     * @throws RemoteError `work/not-found` / `work/not-actionable`
     */
    resumeCredential(request: WorkResumeCredentialRequest): Promise<WorkResumeCredentialValue>;
    /**
     * 把一次续办投递的结局记到工作记录上（重启后据此判断要不要重试）。
     * @param workId - 工作 ID
     * @param state - 要记的投递痕迹
     */
    private noteCredentialResume;
    /**
     * 续办投递没成功：把工作从"假 running"改成**明确失败且可重试**。
     *
     * ▍为什么不留在 running（R2）
     * 首版投递失败后只抛错，记录已经先被切成 running 并且 blocked 被清掉了——
     * 界面上显示"正在处理"，实际没有任何人在跑，用户也没有入口可点。这就是 running 僵尸。
     * 这里改成 `failed` + 原因：现有重试入口 (`retry`) 立刻可用，用户能自己再来一次。
     *
     * @param workId - 工作 ID
     * @param requestId - 这条凭据请求的编号
     * @param message - 真实错误
     * @param attempt - 投递结局（undelivered / unknown）
     */
    private settleCredentialFailure;
    /**
     * 用户放弃 / 入口过期 / 处理失败：把卡从"等你处理"收口成**可重试**的状态。
     *
     * ▍为什么需要它（R2）
     * 首版只把 blocked 清掉就停了监视，工作还停在 `waiting-input` 却没有入口——
     * 没有任何人能再推进它，用户也没有可见的下一步。这比"失败"更糟：它看起来还活着。
     * 现在落成 `cancelled`（用户放弃/过期）或 `failed`（处理失败），两者都能走现有 `retry` 重来，
     * 且**不删用户已经提交的东西**（凭据仍在保密服务里）。
     *
     * @param request - 工作 ID、请求编号、人话原因
     * @returns 最新快照与是否真的改了
     */
    abandonCredential(request: WorkAbandonCredentialRequest): Promise<WorkAbandonCredentialValue>;
    /**
     * 续办的前半段（持锁）：核对、把记录切回 running。
     * ⚠️ R2：这里**不**再写幂等键——那个只能在投递成功之后写（见 resumeCredential）。
     * @param request - 见 {@link resumeCredential}
     * @returns 已完结（直接返回）/ 原地复用脚本 / 需要重新接上原会话
     */
    private decideResume;
    /**
     * 给正在跑的工作挂一句「等你处理」（可带用户可点的入口），或把它清掉。
     *
     * ▍为什么需要它（2026-10-28）
     * 「等用户去填密钥 / 去第三方授权」不是模型问一句、也不是原生审批：
     * 模型这一回合还在跑（工具在等），但用户必须先在自己浏览器里完成一步。
     * 现有工作卡只认 `blocked` 这个通道来画 attention 与入口，所以这里**只补 blocked**，
     * 【不】改状态：状态仍由 runner 的 turn/end 与原生事件决定，否则会撞非法迁移。
     *
     * @param request - 工作 ID、阻塞说明（null 表示清掉）、可选阶段文字
     * @returns 最新快照
     * @throws RemoteError `work/not-actionable`（工作已结束）、`work/not-found`
     */
    annotateBlocked(request: WorkAnnotateBlockedRequest): Promise<WorkAnnotateBlockedValue>;
    /**
     * annotateBlocked 的本体；已持有该工作的写锁。
     * @param request - 见 {@link annotateBlocked}
     */
    private annotateBlockedLocked;
    /**
     * 取消：停止后续动作，并如实报告外部动作能追到哪一步。
     * @param request - 工作 ID
     * @returns 取消后的状态与两件事的分别结论
     */
    cancel(request: WorkCancelRequest): Promise<WorkCancelValue>;
    /**
     * 重试：新建一件工作，指向原来的失败记录。
     * 为什么不原地重置老记录：历史是审计与恢复的依据；"第几次重试"要能一眼看出来。
     * @param request - 原工作 ID、幂等键
     * @returns 新工作快照与来源
     */
    retry(request: WorkRetryRequest): Promise<WorkRetryValue>;
    /**
     * 订阅工作变化：首帧快照，其后增量。
     * 为什么用原生 stream 而不是转发事件：不改 upstream 的转发白名单也能有实时性，
     * 而且断线重连天然从新快照开始，不会漏帧。
     * @param request - 可选单件订阅
     * @param signal - 原生 carrier 的取消信号
     * @returns 帧流
     */
    follow(request: WorkFollowRequest | undefined, signal: AbortSignal): AsyncIterable<WorkFollowFrame>;
    /** 是否有后台额度（**真正在跑**的件数 < 上限；等人工的不算）。 */
    private hasCapacity;
    /** 只用来写"准备开始/排队中"的文案，不占名额。 */
    private dotCapacityPreview;
    private dotQueuedReason;
    /**
     * 工作转入等人工：把它从"占额度"移到"等人工"。
     * 调用后立刻让出一个额度给排队区（这就是 SPEC 说的"等待人工不占模型忙等"）。
     * @param workId - 工作 ID
     */
    private suspendRunner;
    /**
     * 人答完了：从"等人工"挪回"占额度"。
     * 若当前额度已满，就进排队区等（不插队、也不丢工作）。
     * @param workId - 工作 ID
     */
    private resumeRunner;
    /**
     * 预留一个后台额度槽。
     * ⚠️ 为什么要"预留"而不是"启动时再看一眼"：`create` 是并发调用，
     * 三个请求可能都在 `startWork` 走到建会话之前各自看到"还有空位"，
     * 结果三件一起开跑，`maxActiveRuns` 形同虚设（真实集成测试抓到的缺陷）。
     * 这里同步占位，失败/结束时由 `settled` / catch 分支释放。
     * @returns 占位用的执行脚本（尚未启动），或 undefined 表示额度已满
     */
    private reserveRunner;
    /**
     * 尝试启动一件工作；没额度就进排队区。
     * @param workId - 工作 ID
     */
    private scheduleStart;
    /** 前面有工作结束后，从排队区取下一件。 */
    private drainQueue;
    /** 云端排队区：按先来后到逐件过闸（全局 + 本账号两层）；已取消/已消失的直接出队。 */
    private dotDrainQueue;
    /**
     * 把"用户已处理完"的工作接回原会话（有多少额度就接多少）。
     *
     * ▍它与 drainQueue 的区别（R1-C）
     * drainQueue 处理的是"从没跑过 / 原来那条脚本还在"，要重发 goal 或直接接着跑；
     * 这里处理的是"上一回合已经结束、脚本早就 dispose 了"——
     * 【不】重发目标，只给原会话补一句"已经好了，继续"，这与"用户补充说明"是同一语义。
     *
     * @returns 无（失败已记日志，工作落下 failed，不静默吞掉）
     */
    private drainResumes;
    /**
     * 真正启动一件工作：建执行脚本、落 running、把目标交给原生会话。
     * @param workId - 工作 ID
     */
    private startWork;
    /**
     * 把执行期事实增量写回记录（唯一写入点之一）。
     * @param workId - 工作 ID
     * @param facts - 增量事实
     */
    private applyFacts;
    /**
     * applyFacts 的本体；已持有该工作的写锁。
     * @param workId - 工作 ID
     * @param facts - 增量事实
     */
    private applyFactsLocked;
    /**
     * 挂上时长看门狗：到点就按预算中止，并说明"超时"而不是假装完成。
     * @param record - 刚开始执行的工作
     */
    private armWatchdog;
    /**
     * 撤掉时长看门狗。
     * @param workId - 工作 ID
     */
    private disarmWatchdog;
    /**
     * 因超出预算而停下：请求原生中止、记 failed、说明原因、腾出额度。
     * 为什么不直接 cancel：取消是"用户让停"，预算是"系统让停"，两者在记录上要能区分。
     * @param workId - 工作 ID
     * @param current - 当前记录
     * @param reason - 人话原因（会写进 error）
     */
    private stopOnBudget;
    /** 游标：更新时间 + ID，稳定且可比较（不比时间戳精度）。 */
    private cursorOf;
    /**
     * 取已打开的域，并把句柄缓存到 `this.domain`。
     * ⚠️ 为什么不能直接读 `this.domain` 字段：它是在 `ready.then(...)` 里赋值的，
     * 而调用方可能在同一轮微任务里就用到它——那时字段还是 undefined，会静默什么都写不进去。
     * 一切读写都先 await 这个入口。
     * @returns 已打开的域
     */
    private domainOf;
    /**
     * 同步读一条记录（没有就 undefined）。
     * ⚠️ 只有在已经 settle 过域之后调用才安全；异步路径请用 `await this.requireRecord()`。
     * @param workId - 工作 ID
     * @returns 记录或 undefined
     */
    private recordOrUndefined;
    /**
     * 读一条必须存在的记录。
     * @param workId - 工作 ID
     * @returns 记录
     * @throws RemoteError `work/not-found`
     */
    private requireRecord;
    /** 云端：只认本账号的工作；别的账号的 ID 一律当不存在（不泄露存在性）。 */
    private requireOwned;
    /** 写入工作记录（storage-domain 先落盘再改内存，这里只负责调用与版本号自增）。 */
    private writeWork;
    /**
     * 按工作粒度的写锁：把"读记录 → 改 → 写回"整段串起来。
     *
     * ▍为什么必须有（R1-C，2026-10-28，Z 指出"旧 blocked 乱序回写"）
     * 一件工作有三条并发的写路径：启动回调（补 sessionId）、`annotateBlocked`（写/收入口）、
     * `applyFacts`（回合事实）。它们各自"先读、再算、后写"，两条交错就会出现
     * A 读到旧快照 → B 写进去 → A 拿旧快照覆盖，把 B 的改动抹掉。
     * 实测病象：工具刚把"等你填钥匙"的入口写进卡片，一条迟到的 running 写回就把它抹了，
     * 用户没填、按钮却没了；反过来也会把已清的入口又写回来。
     *
     * ▍为什么不是全局锁
     * 不同工作之间没有共享字段，用一把大锁会让互不相关的工作互相等待。
     *
     * ▍【不】能在锁里 await 会回调写同一件工作的方法（比如 runner.supplement 会触发 applyFacts），
     * 那会自锁。所以调用方只把"读-改-写"包进来，外部动作放到锁外。
     * @param workId - 工作 ID
     * @param run - 真正要执行的读改写
     * @returns run 的返回值
     */
    private withWorkLock;
    /** 写入幂等索引。 */
    private writeOperation;
    /** 状态迁移断言：非法迁移是缺陷，不是用户错误，所以用 Error 抛出而不是 RemoteError。 */
    private assertTransition;
    /** 把原生会话侧错误翻成稳定的 RemoteError；不是会话侧的错误原样上抛。 */
    private sessionFailureOf;
    /**
     * 造一份文字成果并返回它的轻量引用（不回写工作记录）。
     * 为什么只返回引用：收尾时要先把所有成果造好、再一次性写终态，
     * 这样界面永远看不到"succeeded 但成果还没落"的中间状态。
     * @param workId - 归属工作
     * @param title - 成果标题
     * @param text - 正文
     * @returns 成果引用；超长时按文件成果落盘
     */
    private storeTextArtifact;
    /**
     * 造一份文件成果并返回它的轻量引用（不回写工作记录）。
     * ⚠️ 文件不存在就不登记：撒谎登记一份打不开的成果，比不登记更糟。
     * @param record - 归属工作（用于相对路径解析）
     * @param path - 文件路径（相对路径按会话工作目录解析）
     * @param title - 展示标题
     * @returns 成果引用；文件缺失时 undefined
     */
    private storeFileArtifact;
    /** 成果文件目录：配置优先，否则 `<workRoot>/dot-artifacts`（不再退到进程当前目录）。 */
    private artifactDirOf;
    /** 把一段文本落成成果文件并返回绝对路径。 */
    private writeArtifactFile;
    /** 把资源路径解析成绝对路径；相对路径优先按绑定会话的工作目录。 */
    private absoluteArtifactPath;
    /**
     * 成果文件圈地判定（dot-work-artifact-scope-20261028）。契约：
     *   入参：record（归属工作，用来找会话 cwd）、absolute（已解析的绝对路径）
     *   返回：undefined = 在工作区内，可以用；字符串 = 拒绝原因（写日志用）
     * 为什么用 realpath 而不是字符串前缀：工作区里一个指向界外的软链，字符串比较拦不住。
     * ⚠️ 目标不存在时按"最近的已存在祖先"判定——否则模型用不存在的路径就能试探宿主结构。
     * ⚠️ 没有会话 cwd（record 无 sessionId 且拿不到）时用 workRoot；两者都没有就**拒绝**，不放行到 process.cwd()。
     */
    private dotArtifactInScope;
    /**
     * 发布一次变化：递增全局版本、通知同进程事件与订阅流。
     * @param record - 变化后的记录
     */
    private publish;
    /**
     * 向星邮匣交接事件；工作调用方可以不等，补扫调用方必须等保存结果。
     * ⚠️ 保存成功才记已发，异步失败只警告并释放占位，不冒充送达也不改工作结局。
     * 可选依赖不在模块级 import 值，避免形成插件依赖环。
     * @param record - 进入终态或阻塞态的工作记录
     * @returns 本次保存或同键在途保存的结果；失败已记录，不向后台执行链抛出。
     */
    private publishToPostbox;
    private resultText;
    /**
     * 云端：后台结果回到派活的那个前台会话，由前台用自己的口吻转述。
     * 以 owner 账号上下文投递（mode=queue，前台忙就排在它后面）。同一工作同一状态只投一次。
     */
    private dotRelayToOrigin;
    /**
     * work-relay-2026-11-03：派活的会话是飞书群/飞书私聊时，结果交给飞书桥：桥在同一会话里跑这一轮，再把转述发回飞书。
     * 原来直接 prompt 那个会话，那一轮不是桥发起的，飞书里谁都看不到。桥不接（不是飞书会话、没配、出错）就返回 false，照旧自己投。
     */
    private dotRelayViaFeishu;
    /**
     * feishu-progress-2026-11-05：派活会话是飞书群/私聊时，把阶段、步骤、耗时、产物推给桥，桥原地更新一张进度卡，
     * 不再每个状态刷一条。状态变化立刻推；同一状态内的阶段变化最多 4 秒推一次（尾沿补推最新的）。
     * 桥不接（非飞书会话、没配）或出错都只记日志，绝不影响工作本身。DOT_FEISHU_PROGRESS=0 关闭。
     */
    private dotProgressViaFeishu;
    /** 拿星邮匣服务；保留异步返回契约，不能再把保存的 Promise 当成同步成功。 */
    private optionalPostbox;
    /**
     * 补扫：把已经到终态但还没发过事件的工作补发一次。
     * 为什么需要：插件启动顺序不保证 star 邮匣先就位；终态只发一次，漏了就永久漏。
     * 幂等由 postbox 自己的 dedupeKey 兜底，重复补扫不会重复弹。
     */
    private publishPendingToPostbox;
    /** 星邮匣就位时由外部调用（装配层可挂 ctx.on('internal/service') 或直接调）。 */
    notifyPostboxReady(): Promise<void>;
    /**
     * 重启后核对在途记录：
     * · 会话还活着 → 继续观察（安全续步，不重发目标）
     * · 会话不在 → 记 `interrupted`（不能冒充"还在跑"，也不盲重做外部动作）
     * · 已终态 → 原样保留
     * 为什么不能一律重启执行：上一次可能已经把外部动作做出去了，重发等于干两遍。
     */
    private recover;
    /**
     * 给一件被打断的只读工作自动重做一次（新建一件 retryOf 指向它的工作，原记录保持 interrupted）。
     * 幂等键固定为 `auto-retry:<原工作>`：重启多少次都只会建一件。
     * @param record - 已落 interrupted 的原记录
     */
    private autoRetryInterrupted;
    /**
     * 列出计划：原生 catalog + 本插件的暂停镜像。
     * @param request - 可选按会话过滤
     * @returns 计划视图数组
     */
    listPlans(request?: WorkPlanListRequest): Promise<WorkPlanListValue>;
    /**
     * 新建计划：先建原生提醒，再存 DOT 镜像（含暂停态字段）。
     * 为什么顺序是这样：原生是时间规则的唯一真源；镜像失败只丢暂停态，不丢计划本身。
     * @param request - 标题、目标、时间规则、可选会话
     */
    createPlan(request: WorkPlanCreateRequest): Promise<WorkPlanCreateValue>;
    /**
     * 修改计划：转发原生 update 并同步镜像。
     * 入参用**稳定 planId**；内部再用镜像里的 scheduleId 去和原生对账。
     * @param request - planId + 可选字段 + 幂等键
     */
    updatePlan(request: WorkPlanUpdateRequest): Promise<WorkPlanUpdateValue>;
    /**
     * 暂停/恢复计划。
     * ⚠️ 原生 schedule 没有暂停：这里用「删原生任务 + 保留 DOT 记录」实现暂停吗？不。
     * 删除会丢历史与补发语义，所以真正的暂停=把原生任务删掉再恢复时按原规则重建，
     * 并把 DOT 记录里的 paused 与历史工作全部保留。
     * @param request - scheduleId + 幂等键
     */
    pausePlan(request: WorkPlanPauseRequest): Promise<WorkPlanPauseValue>;
    /** 恢复计划：按镜像里的时间规则重建原生任务（原生没有"取消暂停"的入口）。 */
    resumePlan(request: WorkPlanPauseRequest): Promise<WorkPlanPauseValue>;
    /**
     * 取消（删除）计划：删原生任务，保留 DOT 镜像与历史工作。
     * @param request - planId + 幂等键
     */
    cancelPlan(request: WorkPlanCancelRequest): Promise<WorkPlanCancelValue>;
    /**
     * 暂停/恢复的实现：原生侧「删/建」，DOT 侧「记 paused」。
     * @param request - scheduleId + 幂等键
     * @param paused - true 暂停，false 恢复
     */
    private setPaused;
    /**
     * 从一条原生提醒消息里认出"DOT 计划的哪一次触发"。
     * 原生把 `schedule_id_json` 与 `reminder_prompt_json` 写进固定文本；这里只认
     * **我们自己建的计划**（原生 id 能在镜像里反查到），别人的提醒一律不碰。
     * @param data - user/message 的事件载荷
     * @returns 命中的稳定 planId，没有则 undefined
     */
    private planIdOfReminder;
    /**
     * 把"某条计划真的触发了一次"接成一件 DOT 工作。
     * 为什么必须自己做这一层：原生 schedule 只负责"把提醒消息投进原会话"，
     * 它不知道 DOT 有工作这回事。不接这一步，计划触发了也只会在后台会话里多一条消息，
     * 工作列表里永远查不到这次运行，`lastWorkId` 永远是空的。
     * @param planId - 稳定计划身份
     * @returns 新登记（或幂等命中）的工作视图；计划不存在时 undefined
     */
    registerPlanRun(planId: string): Promise<WorkSnapshot | undefined>;
    /** 取原生 schedule 服务；部署没挂时给稳定错误码而不是崩。 */
    private requireSchedule;
    /**
     * 计划需要一个原生会话承载提醒投递；没给就建一个专用会话。
     * ⚠️ 必须带 `cwd: workRoot` 与 `agentPreset`：不带 cwd 会落到进程当前目录（工程根），
     * 不带 preset 会退回宿主默认 coding 身份——两者都不是个人 DOT 该有的行为。
     * @param sessionId - 调用方指定的既有会话；省略则新建
     * @returns 承载该计划的会话身份
     */
    private planSessionOf;
    /** 后台工作/计划会话应使用的文件根与身份（供执行引擎读取）。 */
    backgroundSessionCreateRequest(): {
        readonly cwd?: string;
        readonly agentPreset?: string;
    };
    /**
     * 模型侧登记工作的入口（工具调用）。
     * 与界面共用同一份业务规则：工具不是另一条路径。
     * @param goal - 目标文本
     * @param operationId - 幂等键（模型自己生成；重复调用不会新建第二件）
     */
    createFromTool(goal: string, operationId: string): Promise<WorkSnapshot>;
    /**
     * 模型侧查询工作（工具调用）。
     * @param workId - 可选；省略返回最近一件
     */
    queryFromTool(workId?: string): Promise<readonly WorkSnapshot[]>;
    /**
     * 模型侧"问的是哪项工作"：按用户原话里的描述词挑，挑不准就返回候选让模型反问。
     * @param match - 用户描述这项工作的词；可缺
     * @returns 唯一确定的工作，或有歧义时的候选（见 work-match.ts）
     */
    pickFromTool(match?: string): Promise<WorkPick>;
    private inputJournal?;
    private openInputs;
    /** A bounded view of immutable text or current work facts, scoped to the calling session. */
    readWorkContext(sessionId: string, query: PageQuery): Promise<ContextPage>;
    private choiceTicket;
    confirmCandidate(request: {
        ticket: string;
        readOnly?: boolean;
    }): Promise<{
        targetId: string;
        selectedId: string;
    }>;
    /** Canary-only: bind a routing decision to the latest persisted user message in the
     * invoking front session. Never execute on quoted text supplied by the model alone. */
    routeLatestAdjustment(sessionId: string, expectedText?: string, expectedTargetId?: string, pick?: {
        message: string;
        ticket: string;
    }): Promise<{
        action: string;
        inputId?: string;
        targetId?: string;
        candidates: WorkSnapshot[];
        choices?: string[];
    }>;
    /** Internal explicit adjustment entry. Read the user's words from their durable
     * front session; a caller cannot select another actor or supply replacement text. */
    acceptVerifiedAdjustment(parentId: WorkId, sessionRef: string, messageId: string, resolutionId: string, pickTicket?: string): Promise<string>;
    /** Host-only startup repair for this account. A stale target stays in the journal. */
    replayAcceptedInputs(): Promise<{
        finished: number;
        pending: number;
    }>;
    private dispatchAccepted;
    /** Shadow only. Account and runner readiness come from the host, never tool arguments. */
    resolveFromTool(input: Evidence): Promise<string>;
    /**
     * 列出一件工作的成果引用。
     * 为什么单独成一个端点：临时卡/工作页只需要轻量引用（标题、类型、长度），
     * 不该为了画列表把正文全搬一遍。
     * @param request - 工作 ID
     * @returns 成果引用数组
     */
    listArtifacts(request: WorkArtifactsRequest): Promise<WorkArtifactsValue>;
    /**
     * 读一份成果的内容。
     * 文字成果给正文；文件成果给 base64（Remote 只走无损 JSON，不传 Uint8Array）。
     * @param request - 成果 ID
     * @returns 内容或 `work/not-found`
     */
    readArtifact(request: WorkArtifactRequest): Promise<WorkArtifactValue>;
    /**
     * 读成果正文（进程内便捷入口，给工具与未来同进程消费者用）。
     * @param artifactId - 成果 ID
     * @returns 正文或文件字节（base64）
     */
    artifactContent(artifactId: string): Promise<{
        kind: 'text';
        text: string;
    } | {
        kind: 'file';
        base64: string;
    }>;
}
export default DotWorkService;
/** 被打断后可以自动重做的只读工具：网页搜索、网页抓取、待办、技能、交付。 */
export declare const AUTO_RETRY_READONLY_TOOLS: ReadonlySet<string>;
/**
 * 被打断的工作能不能自动重做一次。
 * 只看本记录的事实：用过的工具全在只读名单里（一个工具都没用过也算）、没请用户确认/回答过、
 * 自己不是一次自动重做（防止"重做→又被打断→再重做"无限循环）。
 * @param record - 已落 interrupted 的记录
 * @returns 是否自动重做
 */
export declare function autoRetryEligible(record: WorkRecord): boolean;
