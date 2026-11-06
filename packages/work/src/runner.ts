/* ================================================================
   DOT 工作插件 · 真实执行引擎（每件工作一个 Runner）

   ▍这是什么
   ① 干什么：把"一件工作"变成真实的 DSH 会话回合——建原生会话、投一条 prompt、
      监听该会话的 session/event，直到 turn/end 给出真实结局；期间把
      turn/step/tool/approval 事实翻译成工作的阶段、步骤、阻塞与外部动作痕迹。
   ② 技术栈：Cordis 服务注入 + 原生 SessionController（建会话/prompt/cancel）+ 原生事件。
      这里【不】自己发 HTTP、不自己驱动模型、不自己造轮子式任务调度。
   ③ 依赖：ctx.sessionController（原生会话业务面）、ctx.agents / ctx.sessions（只读事实）、
      以及服务层给的三个回调（状态更新、成果登记、终态通知）。
   ④ 给谁看：改执行语义的人（先读这里的"结局映射表"）、排查"为什么这件工作卡在 running"的人。

   ▍结构（从上到下）
   结局映射表        —— turn/end 的 reason → 工作状态；这是唯一判定入口
   观察者            —— 单会话事件订阅，产出"事实增量"回调
   DotWorkRunner     —— 启动/取消/补充/释放 四个动作，全部走原生会话

   ▍修改铁律
   1. 【不】在这里猜结局：只有 turn/end（或进程重启后的"说不准"）能决定 succeeded/failed。
      "没等到回信"不等于"没执行"，也不等于"成功"。
   2. 【不】取消后谎称撤回：取消只中止回合；已发生的工具调用记进 externalActions 交给界面。
   3. 【不】在观察者里 catch 后静默返回：异常要么翻成 failed（带原因），要么记日志后上抛。
   4. 每启动一条订阅都必须能释放；插件卸载与工作终态都要走 `dispose()`。
   5. 【不】用轮询代替事件：原生已经有 session/event 与 turn/end，再轮询只是多一份真相。

   ▍外号表
   "回合"   → 原生 Agent 的一次 turn（turn/start … turn/end）
   "脚本"   → 本文件的 DotWorkRunner 实例，一件工作一个
   "外部手" → 已经发生、撤不回来的工具动作（记数后交给 externalReachOf）

   ▍更新记录
   2026-10-23 · 建立：原生会话回合驱动 + 事件观察 + 结局映射 + 取消/补充。
   ================================================================ */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import { outcomeOfTurnEnd } from './domain.ts'
import type { WorkId, WorkStatus } from '@xtcausal/dot-contracts'
import type { WorkBlockKind } from './types.ts'
import { registerWorkSession, workerModel, WORKER_UNCONFIGURED } from './cloud.ts'

/** 原生 prompt 的客户端幂等身份类型（DSH 的品牌字符串）。 */
type SessionRequestId = Parameters<Context['sessionController']['prompt']>[0]['requestId']

/** 一件工作在执行期发生的、需要写回记录的事实增量。 */
export interface RunnerFacts {
  /** 阶段描述变化（给人看）。 */
  readonly stage?: string
  /** 状态变化；只有结局判定与阻塞变化会带这个字段。 */
  readonly status?: WorkStatus
  /** 新增步骤（追加到尾部）。 */
  readonly pushStep?: string
  /** 结束当前进行中的步骤。 */
  readonly finishStep?: { readonly status: 'done' | 'failed'; readonly error?: string }
  /** 阻塞说明；`null` 表示解除阻塞。 */
  readonly blocked?: { readonly kind: WorkBlockKind; readonly message: string; readonly code: string; readonly risk?: string } | null
  /** 失败原因（仅 failed 时给）。 */
  readonly error?: string
  /** 观察到的工具调用次数累加（用于取消时如实报告外部动作）。 */
  readonly toolCalls?: number
  /** 本回合最终助手文本；作为文字成果的候选正文。 */
  readonly finalText?: string
  /** present 工具声明过的文件路径（成功回合才登记为文件成果）。 */
  readonly presentedFiles?: readonly { readonly path: string; readonly description?: string }[]
  /** 这次观察到的工具名（被打断后判断"只读、可自动重做"用，见 service.recover）。 */
  readonly toolName?: string
  /** 这次请过用户确认/回答（审批或 ask_user_question）；一旦为真，被打断后不自动重做。 */
  readonly askedUser?: boolean
}

/** 服务层交给执行引擎的能力面（引擎不直接写存储，避免两份真相）。 */
export interface RunnerHost {
  /** 读当前持久记录里的会话绑定与已观察到的工具调用数。 */
  readonly factsOf: (workId: WorkId) => Promise<{ readonly sessionId?: string; readonly toolCalls: number }>
  /** 写回一次事实增量并持久化；返回是否仍然存活（工作未被取消/删除）。 */
  readonly apply: (workId: WorkId, facts: RunnerFacts) => Promise<void>
  /** 回合结束、工作已落终态时的通知（用于排队出队与星邮匣）。 */
  readonly settled: (workId: WorkId) => void
  /**
   * 新建后台会话时要带的参数（`cwd` = 个人工作区、`agentPreset` = ASTRA）。
   * ⚠️ 不能在这里自己拼 `process.cwd()`：那是工程根，模型关掉终端后还能读到项目配置，
   * 用户想让它写的文件也不在"他的文件区"。文件根只能由部署配置决定。
   */
  readonly createRequest: () => { readonly cwd?: string; readonly agentPreset?: string }
}

/**
 * 从 `tool/result` 的 tool-private `meta` 里认出"刚创建了一个文件成果"。
 * 为什么走 meta 而不是解析中文正文：meta 是原生持久化的结构化载荷（`dot.artifact` 标记），
 * 文案改了也不会断；而 `dot_write_artifact` 的 render 文本是给人看的，不该被机器解析。
 * @param meta - 事件里的 `meta` 字段（任意 JSON）
 * @returns 命中的文件引用；不是成果创建、或字段不合法时 undefined
 */
export function artifactMetaOf(meta: unknown): { readonly path: string; readonly title?: string; readonly bytes?: number; readonly mimeType?: string } | undefined {
  if (meta === null || typeof meta !== 'object') return undefined
  const typed = meta as {
    readonly dot?: unknown
    readonly kind?: unknown
    readonly path?: unknown
    readonly title?: unknown
    readonly bytes?: unknown
    readonly mimeType?: unknown
  }
  // 只认约定标记：`dot === 'artifact'` 且 `kind === 'file-created'`（成功创建才发）。
  if (typed.dot !== 'artifact' || typed.kind !== 'file-created') return undefined
  if (typeof typed.path !== 'string' || typed.path.length === 0) return undefined
  return {
    path: typed.path,
    ...(typeof typed.title === 'string' && typed.title.length > 0 ? { title: typed.title } : {}),
    ...(typeof typed.bytes === 'number' ? { bytes: typed.bytes } : {}),
    ...(typeof typed.mimeType === 'string' && typed.mimeType.length > 0 ? { mimeType: typed.mimeType } : {}),
  }
}

/** 从一条 assistant/message 事件里取出纯文本（拼接所有 text block）。 */
function assistantTextOf(event: unknown): string | undefined {
  const message = (event as { message?: { content?: unknown } }).message
  const content = message?.content
  if (!Array.isArray(content)) return undefined
  const parts: string[] = []
  for (const block of content) {
    const typed = block as { type?: unknown; text?: unknown }
    if (typed.type === 'text' && typeof typed.text === 'string') parts.push(typed.text)
  }
  return parts.length === 0 ? undefined : parts.join('\n')
}

/** 解析 present 工具的参数（模型给的是 JSON 字符串）；解析失败返回空，不猜。 */
function presentedFilesOf(rawArguments: unknown): readonly { path: string; description?: string }[] {
  if (typeof rawArguments !== 'string') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(rawArguments)
  } catch {
    return []
  }
  const files = (parsed as { files?: unknown }).files
  if (!Array.isArray(files)) return []
  const result: { path: string; description?: string }[] = []
  for (const file of files) {
    const typed = file as { path?: unknown; description?: unknown }
    if (typeof typed.path !== 'string' || typed.path.length === 0) continue
    result.push({
      path: typed.path,
      ...(typeof typed.description === 'string' ? { description: typed.description } : {}),
    })
  }
  return result
}

/**
 * 一件工作的执行脚本：启动一次原生会话回合，观察它到终局，然后释放订阅。
 * ⚠️ 一个实例只服务一件工作的一段执行；重试会新建工作、新建脚本。
 */
export function inputRequestId(workId: string, sessionId: string, operationId: string): string {
  return 'dot-input:' + createHash('sha256').update(JSON.stringify([workId, sessionId, operationId])).digest('hex')
}

export class DotWorkRunner {
  private disposeObserver: (() => void) | undefined
  /** 本回合观察到的工具调用计数（不含历史）。 */
  private toolCalls = 0
  /** 本回合最终助手文本（可能有多段，取最后一段非空）。 */
  private finalText: string | undefined
  /**
   * 本回合登记为文件成果的候选，按**路径去重**。
   * 为什么必须去重：模型常常先用 `dot_write_artifact` 写文件，再 `present` 同一条路径；
   * 不去重会登记两份指向同一文件的成果，界面上就出现"两个一模一样的结果"。
   */
  private readonly presentedByPath = new Map<string, { path: string; description?: string }>()
  /** 用户是否已要求取消：决定中止原因是"用户取消"还是"宿主中断"。 */
  private cancelRequested = false
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
  private readonly initialDispatch = Promise.withResolvers<boolean>()
  private settledCount = 0
  // A queued prompt becomes part of a turn only when DSH emits its user/message.
  private readonly queuedInputs = new Set<string>()
  private deferredEnd: { data: unknown } | undefined

  /** 是否已经为**当前这一轮**交出过终局。 */
  private get settled(): boolean {
    return this.settledCount > 0
  }
  /**
   * 本脚本绑定的原生会话。
   * ⚠️ 为什么要自己记一份：记录里的 `sessionId` 是异步写回的，
   * "刚进入 running、会话已建好但记录还没写完"这段窗口里，
   * 用户点取消/补充会读到没有会话的旧记录而失败——脚本自己记着就不会。
   */
  private boundSession: SessionId | undefined
  /** 当前是否处于等确认（approval 问出未答）。 */
  private awaitingApproval = false
  /** 当前是否处于等用户回答（ask_user_question 工具未返回）。 */
  private awaitingInput = false
  /**
   * 事件串行队列。
   * 为什么必须串：`session/event` 是同步 emit，密集的 tool/call 与 turn/end 会挤在同一
   * 微任务里；而每次写回都要 await 存储。若不排队，turn/end 的终局写可能抢在
   * 前面的事实写之前落盘，导致最终文本丢失或出现非法状态迁移。
   */
  private chain: Promise<void> = Promise.resolve()

  /**
   * @param ctx - Host 上下文（用 sessionController 建会话/prompt/cancel，用 events 观察）
   * @param workId - 这件工作的稳定 ID
   * @param host - 服务层给的回写能力（含新建会话的 cwd / preset）
   */
  constructor(
    private readonly ctx: Context,
    private readonly workId: WorkId,
    private readonly host: RunnerHost,
  ) {}

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
  async start(
    goal: string,
    signal: AbortSignal,
    onSession?: (sessionId: SessionId) => Promise<void>,
  ): Promise<SessionId> {
    try {
      return await this.startSession(goal, signal, onSession)
    } catch (error) {
      this.initialDispatch.resolve(false)
      throw error
    }
  }

  private async startSession(goal: string, signal: AbortSignal,
    onSession?: (sessionId: SessionId) => Promise<void>): Promise<SessionId> {
    const facts = await this.host.factsOf(this.workId)
    this.toolCalls = facts.toolCalls
    let sessionId = facts.sessionId as SessionId | undefined
    if (sessionId !== undefined) this.boundSession = sessionId
    registerWorkSession(sessionId)
    if (sessionId === undefined) {
      // DOT 云端：后台只用配置好的 Worker 模型，且必须带账号身份才开工。
      const worker = workerModel()
      if (worker === undefined) throw new Error(WORKER_UNCONFIGURED)
      if ((globalThis as any)[Symbol.for('dot.cloud.identity')]?.getStore?.()?.actor === undefined) throw new Error('后台会话缺少账号身份，拒绝开工')
      const created = await this.ctx.sessionController.create(this.host.createRequest())
      sessionId = created.sessionId
      registerWorkSession(sessionId)
      await this.ctx.sessionController.selectModel({ sessionId, provider: worker.provider, model: worker.model } as never)
      this.boundSession = sessionId
      await onSession?.(sessionId)
      await this.host.apply(this.workId, { stage: '已建立后台会话，正在交代任务' })
    }
    this.observe(sessionId, signal)
    await this.host.apply(this.workId, {
      stage: 'ASTRA 正在处理',
      status: 'running',
      pushStep: '理解目标并开始执行',
      blocked: null,
    })
    const firstPrompt = this.prompt(sessionId, goal, signal)
    this.initialDispatch.resolve(true)
    await firstPrompt
    return sessionId
  }

  /**
   * 重启后重新接上原会话：只恢复观察，不再投递目标。
   * 为什么不能再投一次：上一次可能已经把外部动作做出去了，重发等于干两遍。
   * @param sessionId - 记录里绑定的原生会话
   * @param signal - 生命周期信号
   */
  reattach(sessionId: SessionId, signal: AbortSignal): void {
    registerWorkSession(sessionId)
    this.boundSession = sessionId
    this.observe(sessionId, signal)
    this.initialDispatch.resolve(true)
  }

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
  async supplement(text: string, signal: AbortSignal, operationId?: string): Promise<void> {
    if (!await this.initialDispatch.promise) throw new Error('后台会话尚未启动')
    const facts = await this.host.factsOf(this.workId)
    const sessionId = this.boundSession ?? facts.sessionId
    if (sessionId === undefined) throw new Error('这件工作还没有绑定会话，无法补充说明')
    if (this.settledCount > 0) {
      /* 新一轮开始：清掉上一轮的终局标记，并把观察者接回同一个原生会话。 */
      this.settledCount = 0
      this.cancelRequested = false
      this.awaitingApproval = false
      this.awaitingInput = false
      this.finalText = undefined
      this.presentedByPath.clear()
      this.observe(sessionId as SessionId, signal)
    }
    const requestId = this.requestId(sessionId as SessionId, operationId)
    const queued = !this.awaitingInput && !this.awaitingApproval
    if (queued) this.queuedInputs.add(requestId)
    this.awaitingInput = false
    try {
      await this.host.apply(this.workId, {
        status: 'running',
        stage: '已收到补充说明，继续处理',
        blocked: null,
      })
      await this.prompt(sessionId as SessionId, text, signal, requestId)
    } catch (error) {
      this.queuedInputs.delete(requestId)
      this.chain = this.chain.then(async () => {
        if (this.deferredEnd && !this.queuedInputs.size && !this.settled) {
          const end = this.deferredEnd
          this.deferredEnd = undefined
          await this.settle(end.data)
        }
      })
      throw error
    }
  }

  /**
   * 请求取消：先向原生会话请求中止，再如实记录"能不能撤回"。
   * ⚠️ 不在这里写终态——终态由 turn/end（或会话已不在）决定，避免"取消了但回合还在跑"的双话。
   * @param signal - 生命周期信号
   * @returns 是否成功把中止请求交给原生 Agent
   */
  async cancel(signal: AbortSignal): Promise<boolean> {
    void signal
    const facts = await this.host.factsOf(this.workId)
    const sessionId = this.boundSession ?? facts.sessionId
    if (sessionId === undefined) return false
    this.cancelRequested = true
    try {
      // 原生 cancel 只接受"已存在/可恢复"的会话；会话已释放时它会给出稳定错误码。
      this.ctx.sessionController.cancel({ sessionId: sessionId as SessionId })
      return true
    } catch (error: unknown) {
      this.ctx.logger.warn(`dot-work: cancel of work "${this.workId}" was refused: ${String(error)}`)
      return false
    }
  }

  /** 释放观察者。插件卸载、工作终态、重试替换时都必须调。 */
  dispose(): void {
    this.disposeObserver?.()
    this.disposeObserver = undefined
  }

  /* ----------------------------------------------------------------
     内部：原生 prompt
     ---------------------------------------------------------------- */

  private requestId(sessionId: SessionId, operationId?: string): SessionRequestId {
    return brandString<SessionRequestId>(operationId === undefined
      ? `${this.workId}:${String(Date.now())}:${Math.random().toString(36).slice(2, 8)}`
      : inputRequestId(this.workId, sessionId, operationId))
  }

  private async prompt(sessionId: SessionId, text: string, signal: AbortSignal,
    requestId = this.requestId(sessionId)): Promise<void> {
    signal.throwIfAborted()
    await this.ctx.sessionController.prompt({
      requestId,
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text }],
    }, signal)
  }

  /* ----------------------------------------------------------------
     内部：事件观察
     ---------------------------------------------------------------- */

  /**
   * 订阅该会话的原生事件，把回合事实翻译成工作事实。
   * @param sessionId - 目标会话
   * @param signal - 生命周期信号（中止时自动释放）
   */
  private observe(sessionId: SessionId, signal: AbortSignal): void {
    const listener = (session: Session, event: { type: string; data?: unknown }): void => {
      if (session.id !== sessionId) return
      // 串行化：前一条事件的事实写完之后才处理下一条，turn/end 永远排在它前面的事件之后。
      this.chain = this.chain.then(() => this.onEvent(event)).catch((error: unknown) => {
        // 单条事件的写回失败不能变成 unhandled rejection；记下来，工作状态由 turn/end 兜底。
        this.ctx.logger.warn(`dot-work: runner "${this.workId}" failed to apply one event: ${String(error)}`)
      })
    }
    this.disposeObserver = this.ctx.on('session/event', listener)
    const release = (): void => { this.disposeObserver?.(); this.disposeObserver = undefined }
    if (signal.aborted) release()
    else signal.addEventListener('abort', release, { once: true })
  }

  /**
   * 单条事件 → 事实增量。
   * ⚠️ 这里【不】做终局以外的状态跳跃：中间只更新阶段、步骤与阻塞。
   * @param event - 原生会话事件（结构化读取，未知类型静默忽略）
   */
  private async onEvent(event: { type: string; data?: unknown }): Promise<void> {
    if (this.settled) return
    switch (event.type) {
      case 'user/message': {
        const src = (event.data as { source?: { kind?: string; rpcId?: string } }).source
        if (src?.kind === 'user' && src.rpcId) this.queuedInputs.delete(src.rpcId)
        return
      }
      case 'turn/start': {
        if (this.deferredEnd) {
          this.deferredEnd = undefined
          this.finalText = undefined
        }
        /* 迟到的 turn/start 不能把"等你交钥匙"改回 running——守卫在服务层 applyFacts 里统一做。 */
        await this.host.apply(this.workId, { status: 'running', stage: 'ASTRA 正在处理', blocked: null })
        return
      }
      case 'tool/call': {
        const name = (event.data as { name?: unknown }).name
        this.toolCalls += 1
        if (name === 'present') {
          const args = (event.data as { arguments?: unknown }).arguments
          for (const file of presentedFilesOf(args)) {
            if (!this.presentedByPath.has(file.path)) this.presentedByPath.set(file.path, file)
          }
        }
        if (name === 'ask_user_question') {
          this.awaitingInput = true
          await this.host.apply(this.workId, {
            status: 'waiting-input',
            stage: '等你补充信息',
            blocked: { kind: 'input', code: 'ask-user-question', message: 'ASTRA 有一个问题需要你回答' },
            toolCalls: 1,
            toolName: name,
            askedUser: true,
          })
          return
        }
        await this.host.apply(this.workId, {
          stage: typeof name === 'string' ? `正在执行：${name}` : '正在执行工具',
          toolCalls: 1,
          ...(typeof name === 'string' && name.length > 0 ? { toolName: name } : {}),
        })
        return
      }
      case 'tool/result': {
        // ① 先认"这次工具生成了一个文件成果"：`dot_write_artifact` 之类工具在 meta 里
        //    带上 `{ dot: 'artifact', kind: 'file-created', path }`。这样模型写了文件但忘了
        //    present，工作卡里也照样有这个文件——不靠中文正文，也不靠模型自觉。
        const created = artifactMetaOf((event.data as { meta?: unknown }).meta)
        if (created !== undefined && !this.presentedByPath.has(created.path)) {
          this.presentedByPath.set(created.path, {
            path: created.path,
            ...(created.title === undefined ? {} : { description: created.title }),
          })
        }
        // ② 工具返回即代表"人已经答过了/动作已经做完"：必须从 waiting-* 回到 running 并清掉阻塞，
        // 否则后续 turn/end 的 succeeded 会撞上非法迁移（waiting-input → succeeded）被拒。
        if (this.awaitingApproval || this.awaitingInput) {
          this.awaitingApproval = false
          this.awaitingInput = false
          await this.host.apply(this.workId, { status: 'running', stage: 'ASTRA 正在处理', blocked: null })
        }
        return
      }
      case 'assistant/message': {
        const text = assistantTextOf(event.data)
        if (text !== undefined) this.finalText = text
        return
      }
      case 'approval/asked': {
        this.awaitingApproval = true
        const toolName = (event.data as { toolName?: unknown }).toolName
        const reason = (event.data as { reason?: unknown }).reason
        await this.host.apply(this.workId, {
          status: 'waiting-approval',
          stage: '等你确认后继续',
          blocked: {
            kind: 'approval',
            code: 'approval-request',
            message: typeof reason === 'string' && reason.length > 0
              ? reason
              : `需要确认：${typeof toolName === 'string' ? toolName : '一项外部动作'}`,
          },
          askedUser: true,
        })
        return
      }
      case 'approval/decided': {
        if (!this.awaitingApproval) return
        this.awaitingApproval = false
        await this.host.apply(this.workId, { status: 'running', stage: '已确认，继续处理', blocked: null })
        return
      }
      case 'turn/end': {
        if (this.queuedInputs.size && !this.cancelRequested &&
          outcomeOfTurnEnd((event.data as { reason?: unknown }).reason).status === 'succeeded') {
          this.deferredEnd = { data: event.data }
          return
        }
        await this.settle(event.data)
        return
      }
      default:
        return
    }
  }

  /**
   * 落终局：把 turn/end 的 reason 翻成状态，并交出成果候选。
   * 判定顺序：用户取消优先（中止是取消造成的），再按原生 reason。
   * @param data - turn/end 的事件载荷
   */
  private async settle(data: unknown): Promise<void> {
    const reason = (data as { reason?: unknown }).reason
    const outcome = outcomeOfTurnEnd(reason)
    let status = outcome.status
    let error = outcome.error
    if (this.cancelRequested && (status === 'interrupted' || status === 'unknown')) {
      status = 'cancelled'
      error = undefined
    }
    this.settledCount += 1
    this.dispose()
    // ⚠️ 这里【不】能 await this.chain：settle 自己就跑在这条链上，等自己=死锁。
    // 顺序保证来自链本身——turn/end 排在所有先前事件之后执行，所以此处的写入天然是最后一步。
    await this.host.apply(this.workId, {
      status,
      stage: status === 'succeeded'
        ? '已完成'
        : status === 'cancelled'
          ? '已取消（已发生的外部动作不随取消撤回）'
          : status === 'failed'
            ? '执行失败'
            : status === 'waiting-input'
              ? '等你补充信息'
              : '状态待核实',
      ...(error === undefined ? {} : { error }),
      finishStep: { status: status === 'succeeded' ? 'done' : 'failed', ...(error === undefined ? {} : { error }) },
      ...(status === 'succeeded' && this.finalText !== undefined ? { finalText: this.finalText } : {}),
      ...(status === 'succeeded' && this.presentedByPath.size > 0
        ? { presentedFiles: [...this.presentedByPath.values()] }
        : {}),
      toolCalls: 0,
    })
    this.host.settled(this.workId)
  }
}

/**
 * 读取一个 Agent 是否还存在（用于重启后判断"说不准"）。
 * 为什么只读 registry 而不是 resolveAgent：恢复期不该为了判断状态而唤醒会话、消耗模型。
 * @param ctx - Host 上下文
 * @param sessionId - 会话身份
 * @returns 是否有活 Agent
 */
export function hasLiveAgent(ctx: Context, sessionId: string): boolean {
  const agent: Agent | undefined = ctx.agents.get(sessionId as SessionId)
  return agent !== undefined
}
