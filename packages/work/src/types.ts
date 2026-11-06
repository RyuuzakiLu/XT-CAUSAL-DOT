/* ================================================================
   DOT 工作插件 · 线上词汇（浏览器安全，只含类型与常量）

   ▍这是什么
   ① 干什么：定义 `dotWork` Remote 命名空间的请求/返回形状、工作状态取值、
      成果读取形状，以及本插件自己的持久记录类型。浏览器侧与 Host 侧共用同一份声明。
   ② 技术栈：纯 TypeScript 类型；业务快照形状来自 `@xtcausal/dot-contracts`，
      不在这里复制第二份"工作事实"。
   ③ 依赖：只 import type（contracts 的 WorkId/WorkStatus/WorkSnapshot/ArtifactRef），
      运行时零依赖，因此可以被 Client 面安全引用。
   ④ 给谁看：UI 作者（照这里的字段画卡片）、装配者（对齐 namespace/方法名）、
      未来的维护者（改字段前先看铁律）。

   ▍结构（从上到下）
   状态与原因的稳定码    —— 机器判定用的字符串，改一个字都会让历史记录读不出来
   请求/返回类型        —— Remote 方法的 wire 形状
   持久记录类型          —— 宿主域表里真正落盘的内容（比 wire 多内部字段）

   ▍修改铁律
   1. 【不】删除既有字段或状态取值：已落盘记录会读不出来。淘汰只能保留 + 标注废弃。
   2. 【不】把"百分比"做成必填：很多工作算不出可靠百分比，硬填 0 就是假进度。
   3. wire 类型里【不】出现 `Uint8Array`/`Date`/类实例——Remote 只走无损 JSON，
      文件字节一律 base64 字符串。
   4. `stage`（给人看）与 `status`（给机器判）不得互相替代，界面也不得反写二者。

   ▍更新记录
   2026-10-23 · 建立：Remote 方法参数/返回、成果读取、持久记录、稳定原因码。
   *更新：2026-10-28 · 增加 annotateBlocked（等你处理的入口走现有工作卡，不改状态）。
   ================================================================ */
import type { ArtifactRef, WorkId, WorkStatus, WorkSnapshot } from '@xtcausal/dot-contracts'

/** 工作来源稳定码：谁登记的这件工作。机器判定用，不比较中文。 */
export type WorkOrigin =
  /** 前台对话里交代的工作。 */
  | 'conversation'
  /** 定时职责触发的工作（复用原生 schedule）。 */
  | 'schedule'
  /** 由另一件工作派生（重试也算一条独立来源，但用的是 retry）。 */
  | 'derived'

/** 一件工作为什么停下等待：与 `WorkStatus` 的 waiting-* 一一对应。 */
export type WorkBlockKind = 'input' | 'approval'

/**
 * 停止工作的两类真实区别（取消的返回里如实分给用户）。
 * 为什么要分开说：取消只保证"不再往下做"，不能替已经发出去的外部动作撒谎说撤回了。
 */
export type ExternalActionReach =
  /** 日志里没有观察到任何工具调用，外部动作大概率没有发生。 */
  | 'none-observed'
  /** 至少有一次工具调用已经发生；外部影响是否存在需要用户自己核实。 */
  | 'observed-may-have-happened'

/** 列表查询的过滤条件。省略即"全部状态"。 */
export interface WorkListRequest {
  /** 只看这些状态；空数组表示不返回任何记录。 */
  readonly statuses?: readonly WorkStatus[]
  /** 最多返回条数，1–200；默认 50。 */
  readonly limit?: number
  /** 上一页最后一条的 `updatedAt` + `id` 游标；省略表示第一页。 */
  readonly cursor?: string
}

/** 列表返回：足够画列表，不必展开步骤。 */
export interface WorkListValue {
  /** 按 `updatedAt` 倒序的工作快照投影。 */
  readonly works: readonly WorkSnapshot[]
  /** 本次快照的全局递增版本；消费端比较它判断自己是否过期。 */
  readonly revision: number
  /** 下一页游标；没有更多时省略。 */
  readonly nextCursor?: string
}

/** 单件工作查询。 */
export interface WorkGetRequest {
  readonly workId: WorkId
}

/** 单件工作详情：快照 + 内部事实 + 界面可直接用的能力标记。 */
export interface WorkGetValue {
  /** 工作当前事实（契约形状，含步骤/成果引用/阻塞/错误）。 */
  readonly work: WorkSnapshot
  /** 幂等键：同一次交代的重发会命中同一件工作。 */
  readonly operationId: string
  /** 重试来源：这件工作是从哪件失败工作重试出来的。 */
  readonly followupOf?: WorkId
  readonly retryOf?: WorkId
  /** 现在能否取消（推进中才可取消）。 */
  readonly cancellable: boolean
  /** 现在能否重试（失败/中断/取消后可重试）。 */
  readonly retryable: boolean
  /** 关联的原生会话 ID；界面据此跳转到对话或取该会话历史。 */
  readonly sessionId?: string
}

/** 交代一件新工作。 */
export interface WorkCreateRequest {
  /** 用户原话或压缩后的目标；不做改写，界面直接显示。 */
  readonly goal: string
  /** 幂等键：同一值重复提交返回同一件工作，不会干两遍。 */
  readonly operationId: string
  /** 可选的短标题；省略时由目标首行截断。 */
  readonly title?: string
}

/** 创建返回。 */
export interface WorkCreateValue {
  /** 刚登记（或幂等命中）的工作快照。 */
  readonly work: WorkSnapshot
  /** 本次是否真的新建；`false` 表示幂等命中已有工作。 */
  readonly created: boolean
}

/** 取消一件工作。 */
export interface WorkCancelRequest {
  readonly workId: WorkId
}

/** 取消返回：三件事分开说，不合并成一句"已取消"。 */
export interface WorkCancelValue {
  readonly workId: WorkId
  /** 取消后的真实状态（可能已是终态，取消不再产生新动作）。 */
  readonly status: WorkStatus
  /** 是否成功阻止了后续动作（原生的在途回合已请求中止）。 */
  readonly stoppedNewActions: boolean
  /** 已经发生的外部动作能追到哪一步——见 {@link ExternalActionReach}。 */
  readonly externalActions: ExternalActionReach
}

/** 重试一件工作：产生新的 workId，旧记录保留。 */
export interface WorkRetryRequest {
  readonly workId: WorkId
  /** 幂等键，规则同创建。 */
  readonly operationId: string
}

/** 重试返回。 */
export interface WorkRetryValue {
  readonly work: WorkSnapshot
  readonly created: boolean
  /** 新工作指向的失败来源；便于界面串起"这是第几次重试"。 */
  readonly retryOf: WorkId
}

/** 补充说明：把用户追加的话送进正在执行的会话。 */
export interface WorkSupplementRequest {
  readonly workId: WorkId
  /** 非空文本；空串按参数错误拒绝。 */
  readonly text: string
  /** 幂等键；省略时由服务端按 workId+文本生成（重发可能重复一次补充）。 */
  readonly operationId?: string
}

/** 补充返回。 */
export interface WorkSupplementValue {
  /** 是否已被原生会话收下（收下不等于模型已读到）。 */
  readonly accepted: true
  readonly work: WorkSnapshot
}

/** 订阅请求：省略 workId 表示订阅整张工作列表的变化。 */
export interface WorkFollowRequest {
  readonly workId?: WorkId
}

/* ================================================================
   等你处理（blocked 注解，2026-10-28）
   为什么单独一个动作而不是让模型"补充一句"：补充文本会变成会话里的一条用户消息，
   而"等你填密钥 / 去授权"是**工作卡上的入口**，两者位置不同；混在一起用户会以为
   把内容贴进聊天就行，那正是本单要禁掉的做法。
   ================================================================ */

/**
 * 给在跑的工作挂/清一句「等你处理」。
 * ⚠️ 只改 `blocked`（与可选 stage），【不】改 status：状态仍由执行引擎与原生事件决定。
 */
export interface WorkAnnotateBlockedRequest {
  readonly workId: WorkId
  /** 阻塞说明；`null` 表示清掉（用户已经处理完，继续跑）。 */
  readonly blocked: {
    readonly kind: WorkBlockKind
    readonly message: string
    readonly code: string
    readonly risk?: string
    /** 用户可点的入口（给用户本人浏览器打开）。【不】放任何秘密。 */
    readonly action?: {
      readonly kind: 'open-url'
      readonly label: string
      readonly url: string
      readonly requestId?: string
    }
  } | null
  /** 同时更新的阶段文字（给人看）。 */
  readonly stage?: string
}

/** 注解返回。 */
export interface WorkAnnotateBlockedValue {
  readonly work: WorkSnapshot
}

/* ================================================================
   凭据续办（R1-C，2026-10-28）
   为什么单独一个动作：用户处理完入口之后，**必须有东西去叫醒原任务**。
   工具自己的等待迟早会超时（模型回合不能一直占着），超时后原生回合结束、
   观察者也随之释放——这时只有服务端知道"这件工作正在等哪条请求"，
   于是由它把原会话接回来，补一句"已经好了，继续"。
   ================================================================ */

/**
 * 让原先卡在「等你交钥匙」的工作继续跑。
 *
 * ⚠️ R2（2026-10-28）修正幂等语义：**不是**"调用过就算办过"。
 * 首版在投递**之前**就写了 `credential:<requestId>` 幂等键并把记录切 running，
 * 一旦 supplement 抛错，活其实没送到，但第二条 resume 只会回 `already-resumed`——
 * 任务永久卡住且没人知道。现在幂等键只在**投递成功之后**才写，
 * 中间过程用记录上的 `resume` 表明"已发送/未发送/未知"。
 */
export interface WorkResumeCredentialRequest {
  readonly workId: WorkId
  /** broker 的请求编号（req_…）；用来核对"等的就是这一条"。 */
  readonly requestId: string
  /** 要补进原会话的那句话（由凭据层生成，不含秘密）。 */
  readonly text: string
}

/**
 * 续办投递的结果。
 * 三种结局分开说，避免假装"恰好一次"：
 * · `sending`     —— 正在投递，别人不要抢；
 * · `sent`        —— 原生会话确实收下了，幂等键已落，第二次调用会回 already-resumed；
 * · `undelivered` —— 确定**没送到**（没有会话/在发送前就被中止），可以安全重试；
 * · `unknown`     —— 投递过程中途出错，无法确定对方收没收到；此时**不**自动重发。
 */
export type WorkCredentialDelivery = 'sending' | 'sent' | 'undelivered' | 'unknown'

/** 记录上留的投递痕迹（给人看，也给下一次调用判断）。 */
export interface WorkCredentialResumeState {
  readonly requestId: string
  readonly attempt: WorkCredentialDelivery
  readonly at: string
  readonly error?: string
}

/** 续办返回。 */
export interface WorkResumeCredentialValue {
  readonly work: WorkSnapshot
  /** 会话真的被接上并且投递成功了。 */
  readonly resumed: boolean
  /** 投递结局（与 resumed 一起看：resumed=false 但 delivered='unknown' 时不要重发）。 */
  readonly delivered: WorkCredentialDelivery | 'none'
  /** 说明为什么是现在这个结果。 */
  readonly reason: string
}

/**
 * 用户放弃 / 入口过期 / 处理失败时的收口。
 * ⚠️【不】报告成功，也【不】删用户已提交的东西：只把这张卡从"等你处理"改成
 * 一个**明确且可重试**的状态，让用户能沿现有重试入口再来一次。
 */
export interface WorkAbandonCredentialRequest {
  readonly workId: WorkId
  readonly requestId: string
  /** 为什么收口（会作为失败原因显示给用户）。 */
  readonly reason: string
}

/** 收口返回。`changed:false` 表示这条工作已经不在等这条请求了（幂等）。 */
export interface WorkAbandonCredentialValue {
  readonly work: WorkSnapshot
  readonly changed: boolean
}

/** 订阅帧：第一帧必是 snapshot，其后是增量 changed。 */
export type WorkFollowFrame =
  | {
    readonly type: 'snapshot'
    readonly works: readonly WorkSnapshot[]
    readonly revision: number
  }
  | {
    readonly type: 'changed'
    readonly work: WorkSnapshot
    readonly revision: number
  }

/** 读取成果内容：文字成果给正文，文件成果给 base64 字节。 */
export interface WorkArtifactRequest {
  readonly artifactId: string
}

/** 成果内容（二选一；文件不走 Uint8Array，因为 Remote 只接受无损 JSON）。 */
export type WorkArtifactValue =
  | { readonly kind: 'text'; readonly text: string; readonly mimeType: string }
  | { readonly kind: 'file'; readonly base64: string; readonly mimeType: string; readonly byteLength: number }

/** 成果引用列表（停用显示插件后仍可按引用读取）。 */
export interface WorkArtifactsRequest {
  readonly workId: WorkId
}

/** 成果引用列表返回。 */
export interface WorkArtifactsValue {
  readonly artifacts: readonly ArtifactRef[]
}

/* ================================================================
   计划（F08）—— 复用原生 schedule，DOT 只补"暂停/恢复/关联运行"语义
   为什么只映射到这几种输入：原生 schedule 支持 一次性/固定间隔/每日/每周/cron，
   DOT 不另造第二种时间规则，只在本插件记录"这条计划产生的工作"和"当前是否暂停"。
   ================================================================ */

/** 计划的时间规则：直接复用原生 schedule 的选择器，不新增第二种方言。 */
export type WorkPlanTiming =
  | { readonly kind: 'at'; readonly at: string }
  | { readonly kind: 'every'; readonly everySeconds: number }
  | { readonly kind: 'daily'; readonly time: string; readonly timeZone: string }
  | { readonly kind: 'weekly'; readonly time: string; readonly timeZone: string; readonly weekdays: readonly number[] }
  | { readonly kind: 'cron'; readonly expression: string; readonly timeZone: string }

/** 一条 DOT 计划：原生提醒 + DOT 的暂停态与运行关联。 */
export interface WorkPlanView {
  /**
   * DOT 计划的**稳定身份**：从创建那一刻起永不变，界面/模型的所有动作都用它。
   * 为什么不能直接用原生 scheduleId：原生没有暂停接口，恢复只能"删掉再重建"，
   * 重建后原生 id 必然变（官方 create 不接受自定义 id）。
   * 拿原生 id 当主键，用户点一次暂停再恢复，界面里那张卡片的 id 就失效了。
   */
  readonly planId: string
  /**
   * 当前关联的原生 schedule 任务 ID。
   * 暂停期间它指向"最后一次存在的那条"（已删）；恢复后会换新值。
   * 界面不要拿它当主键，只在需要与原生对账时用。
   */
  readonly scheduleId: string
  /** 计划名（原生 title）。 */
  readonly title: string
  /** 每次触发要交代给 ASTRA 的目标文本。 */
  readonly goal: string
  readonly timing: WorkPlanTiming
  /** 下一次触发时间（ISO-8601）；已停止时可能省略。 */
  readonly nextAt?: string
  /** DOT 侧暂停态：原生没有暂停，删除冒充暂停会丢历史，所以由本插件持有。 */
  readonly paused: boolean
  /**
   * 是否已被取消（墓碑）。
   * 为什么与 `paused` 分开：暂停是"先停一下，之后还能恢复"，取消是"这条职责不要了"。
   * 两者都让原生任务消失，但界面必须给不同动作——取消后【不】能再恢复，
   * 否则用户会以为一条已经放弃的计划还活着。历史与已产生的工作都保留。
   */
  readonly cancelled: boolean
  /** 最近一次由该计划产生的工作。 */
  readonly lastWorkId?: WorkId
  /** 计划绑定的原生会话（原生 schedule 的会话归属）。 */
  readonly sessionId?: string
}

/** 列出计划。 */
export interface WorkPlanListRequest {
  /** 只看这些计划的原生会话；省略表示本机全部。 */
  readonly sessionId?: string
}

/** 计划列表返回。 */
export interface WorkPlanListValue {
  readonly plans: readonly WorkPlanView[]
}

/** 新建计划。 */
export interface WorkPlanCreateRequest {
  readonly title: string
  readonly goal: string
  readonly timing: WorkPlanTiming
  /** 计划触发时把消息投递到哪个原生会话；省略时由 Host 建一个专用会话并记下。 */
  readonly sessionId?: string
  readonly operationId: string
}

/** 新建计划返回。 */
export interface WorkPlanCreateValue {
  readonly plan: WorkPlanView
  readonly created: boolean
}

/** 修改计划：只改 DOT 侧可安全改的字段（原生 update 由本插件转发）。 */
export interface WorkPlanUpdateRequest {
  /** 稳定计划身份（不是原生 scheduleId）。 */
  readonly planId: string
  readonly title?: string
  readonly goal?: string
  readonly timing?: WorkPlanTiming
  readonly operationId: string
}

/** 修改返回。 */
export interface WorkPlanUpdateValue {
  readonly plan: WorkPlanView
}

/** 暂停/恢复计划：DOT 自己的语义，不删除原生任务。 */
export interface WorkPlanPauseRequest {
  /** 稳定计划身份（不是原生 scheduleId）。 */
  readonly planId: string
  readonly operationId: string
}

/** 暂停/恢复返回。 */
export interface WorkPlanPauseValue {
  readonly plan: WorkPlanView
  /** 是否真的改变了暂停态；重复调用返回 `false`。 */
  readonly changed: boolean
}

/** 取消（删除）计划：与原生 delete 同义，历史工作记录保留。 */
export interface WorkPlanCancelRequest {
  /** 稳定计划身份（不是原生 scheduleId）。 */
  readonly planId: string
  readonly operationId: string
}

/** 取消返回。 */
export interface WorkPlanCancelValue {
  readonly planId: string
  readonly scheduleId: string
  /** 原生是否删除了任务行。 */
  readonly deleted: boolean
  /** 已产生的工作记录是否保留（本插件永远保留）。 */
  readonly worksRetained: true
}

/* ================================================================
   持久记录（宿主域表落盘的真实形状）
   ⚠️ 这些类型只给 Host 用；浏览器拿到的永远是 {@link WorkSnapshot} 等 wire 形状。
   ================================================================ */

/** 一件工作的持久记录：权威事实，重启后从这里恢复。 */
export interface WorkRecord {
  readonly id: WorkId
  /** 幂等键：同一次交代的重发命中同一条记录。 */
  readonly operationId: string
  readonly goal: string
  readonly title: string
  readonly status: WorkStatus
  readonly stage: string
  /** 0–1 的可靠进度；算不出时省略，不写 0。 */
  readonly progress?: number
  readonly origin: WorkOrigin
  readonly createdAt: string
  readonly updatedAt: string
  /** 本记录每次变化递增；界面比较它判断新旧。 */
  readonly revision: number
  /** 执行这件工作的原生会话；尚未启动时为 undefined。 */
  readonly sessionId?: string
  readonly steps: readonly WorkStepRecord[]
  readonly artifacts: readonly ArtifactRef[]
  readonly blocked?: WorkBlockedRecord
  /**
   * 最近一次凭据续办的投递痕迹（R2）。
   * 为什么放在工作记录上而不是内存：进程重启后要能看出"上次到底送没送到"，
   * 否则只能二选一——要么无脑重发（可能干两遍），要么当已办（活就丢了）。
   */
  readonly credentialResume?: WorkCredentialResumeState
  readonly error?: string
  readonly queuedReason?: string
  /** 重试来源。 */
  readonly followupOf?: WorkId
  readonly retryOf?: WorkId
  /** 由哪条计划触发（计划工作才有）。 */
  readonly planId?: string
  /** 云端：工作所属账号；只对同账号可见（见 cloud.ts）。 */
  readonly owner?: string
  /** 云端：派活的前台会话；结果回到这个会话由前台转述。 */
  readonly originSessionId?: string
  /** 观察到过的工具名（去重，按首次出现顺序）；被打断后判断能否自动重做。 */
  readonly toolsUsed?: readonly string[]
  /** 请过用户确认/回答；为真则被打断后不自动重做，改发要处理的提醒。 */
  readonly askedUser?: boolean
  /** 观察到的最强外部动作痕迹，用于取消时如实报告。 */
  readonly externalActions: ExternalActionReach
}

/** 步骤记录：骨架，不是模型思考流水。 */
export interface WorkStepRecord {
  readonly index: number
  readonly label: string
  readonly status: 'pending' | 'running' | 'done' | 'failed'
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly error?: string
}

/** 阻塞记录：等什么、稳定码是什么。 */
/**
 * 阻塞说明的持久形状。
 * `action` 是「等你处理」时可点的入口（R1，2026-10-28）：
 * 只放给**用户本人浏览器**打开的地址与按钮字，【不】放任何秘密。
 */
export interface WorkBlockedRecord {
  readonly kind: WorkBlockKind
  readonly message: string
  readonly code: string
  readonly risk?: string
  readonly action?: {
    readonly kind: 'open-url'
    readonly label: string
    readonly url: string
    readonly requestId?: string
  }
}

/** 成果正文的持久落点：文字内联（有上限），文件只存路径与类型。 */
export interface ArtifactRecord {
  readonly id: string
  readonly workId: WorkId
  readonly kind: 'text' | 'file'
  readonly title: string
  readonly createdAt: string
  readonly mimeType: string
  /** 文字成果正文；文件成果为 undefined。 */
  readonly text?: string
  /** 文件成果的绝对路径；文字成果为 undefined。 */
  readonly path?: string
  readonly byteLength?: number
}

/** DOT 计划记录：原生 schedule 的镜像 + DOT 自己的暂停态。 */
export interface PlanRecord {
  /** 稳定计划身份（本插件生成，永不变更）。 */
  readonly planId: string
  /** 最近一次关联的原生任务 ID；恢复重建后会更新。 */
  readonly scheduleId: string
  readonly title: string
  readonly goal: string
  readonly timing: WorkPlanTiming
  readonly paused: boolean
  /** 已取消（墓碑）：不再可恢复，历史保留。 */
  readonly cancelled: boolean
  readonly sessionId?: string
  readonly lastWorkId?: WorkId
  readonly createdAt: string
  readonly updatedAt: string
  readonly revision: number
}

/** 幂等索引记录：operationId → 谁。分开存，避免每次创建都全表扫。 */
export interface OperationRecord {
  readonly operationId: string
  readonly kind: 'create' | 'retry' | 'supplement' | 'plan-create' | 'plan-update' | 'plan-pause' | 'plan-cancel'
  /** 命中的目标（workId 或 scheduleId）。 */
  readonly target: string
  readonly createdAt: string
}
