/* ================================================================
   DOT 记忆 · 服务层（"档案管理员"）

   ▍这是什么
   MemoryService：把引擎接口包成"带业务约束"的服务——
   检索结果做形状收敛、变更广播给界面、状态如实反映可用性。
   它不自己解析 Python 输出，那是 engine.ts 的事；云端模式也不自己拼 HTTP，那是
   cloud-engine.ts 的事。

   ▍为什么在服务层再加一道
   引擎返回的语义很丰富（mode/verdict/admission 等），但产品只承诺其中几样稳定字段。
   服务层负责把"能承诺的"和"仅供展示的"分开，避免界面以后依赖引擎内部模式名。
   —— 像图书馆前台：你问它要书，它不会跟你讲编目系统的内部批次号。

   ▍两种装配形态（DOT_CLOUD_MODE 决定，默认个人行为不变）
   · 本地（默认，DOT_CLOUD_MODE 未设）：配置里带 dbPath/actor/namespace，起 CLI 引擎，
     身份固定来自配置。与云端上线前完全一致。
   · 云端（DOT_CLOUD_MODE=1）：【不】建 CLI 引擎（Agent 侧不直跑 Python、不碰库文件；
     引擎在同机独立 data 进程里，只能走 HTTP 问它），
     一律走 cloud-engine.ts 的 HTTP；身份每次调用现读"工牌"，不是配置值。
   —— 本地是自建档案室，云端是拨内线问总部：同一个前台，两种取档方式。

   ▍修改铁律
   1. 【不】在服务层拼 namespace / actor / 库路径；本地它们只来自配置，云端只来自工牌。
   2. 写操作成功后必须广播变更（界面靠它刷新），失败不广播。
   3. 【不】把异常吞成空列表；抛 MemoryEngineError，由 Remote 层折成域码。
   4. 删除前必须能预览（确认闸在引擎里），服务层不得跳过预览直接删。
   5. 云端严禁回落本地 CLI：云模式下就算 config 里带着 dbPath，也【不】用它。
   6. 云端 status 缓存按 actor 分桶——一个进程里多个身份共用服务，缓存串了就是
      "A 看到 B 的域"（比不可用更坏，因为它不报错）。
   7. 云端 watch 订阅按**订阅时**的身份绑定，广播只发给绑定同一身份的人；
      身份缺失就拒订阅，不留一个永远收不到帧的假活流。

   ▍更新记录
   *更新：2026-10-26 · 新增云端模式（DOT_CLOUD_MODE=1）：动态 actor HTTP、status 按 actor 缓存、
     watch 订阅绑定身份；默认个人装配行为不变
   *更新：2026-10-27 · 合入本地共库纠正预检：越域 correct 在读侧拦下，防"先写新条再拒旧条"的半成功。
     该预检与云端动态身份无冲突——this.namespace 在云模式按工牌现算。*
   ================================================================ */
import type { MemoryEngine, MemoryEngineConfig } from './engine.ts'
import { createXtmemEngine, MemoryEngineError } from './engine.ts'
import { isCloudMode } from './deployment-mode.ts'
import type {
  MemoryHit, MemoryWatchFrame,
} from './types.ts'

/** 服务配置 = 引擎配置 + 产品侧少量开关。 */
export interface MemoryServiceConfig extends MemoryEngineConfig {
  /** 检索默认条数（给模型工具与 Remote 共用的默认值）。 */
  readonly defaultTop?: number
  /** 单条记忆写入时的默认重要度。 */
  readonly defaultImportance?: number
  /**
   * 是否云端模式；不传则看 DOT_CLOUD_MODE（'1'/'true'）。
   * 显式传值是为了让测试与装配方不必污染进程环境。
   */
  readonly cloud?: boolean
  /** 云端数据服务根地址（不含 /v1）；不传则读 DOT_DATA_URL。 */
  readonly dataUrl?: string
  /** 云端单次请求超时（毫秒）；不传则 30s。 */
  readonly cloudTimeoutMs?: number
}

/** 服务对外状态。 */
export interface MemoryServiceStatus {
  readonly available: boolean
  readonly actor: string
  readonly namespace: string
  readonly reason?: string | undefined
  readonly engineVersion?: string | undefined
}

/**
 * 记忆服务。
 */
export class MemoryService {
  private readonly engine: MemoryEngine
  private readonly config: MemoryServiceConfig
  private readonly cloudMode: boolean
  /** 监听器 → 订阅时绑定的 actor（本地模式恒为 undefined）。 */
  private readonly listeners = new Map<(frame: MemoryWatchFrame) => void, string | undefined>()
  private lastStatus: MemoryServiceStatus | undefined
  /** 云端状态缓存：按 actor 分桶，防串号。 */
  private readonly cloudStatus = new Map<string, MemoryServiceStatus>()

  /**
   * @param config - 本地：身份/域/库/路径配置；云端：只需 dataUrl（身份走工牌）
   * @param engine - 可替换的引擎（测试可注入替身；生产按模式自建）
   */
  constructor(config: MemoryServiceConfig, engine?: MemoryEngine) {
    this.config = config
    this.cloudMode = config.cloud ?? isCloudMode()
    if (this.cloudMode) throw new Error('Cloud memory adapter is not included in this source distribution')
    this.engine = engine ?? createXtmemEngine(config)
  }

  /** 是否云端装配（界面/装配方可据此改文案，不参与业务分支判断以外的用途）。 */
  get isCloud(): boolean { return this.cloudMode }

  /**
   * 订阅变更（界面刷新用）；返回取消函数。
   * ⚠️ 云端模式按订阅时的身份绑定：之后即使"工牌"换了人，这条订阅也只听原来那个 actor 的帧。
   */
  subscribe(listener: (frame: MemoryWatchFrame) => void): () => void {
    const boundActor = this.cloudMode ? this.currentActorOrThrow('订阅变更流') : undefined
    this.listeners.set(listener, boundActor)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * 广播变更。
   * @param frame - 变更帧
   * @param actor - 云端模式下"这次变更属于谁"；本地模式忽略
   */
  private emit(frame: MemoryWatchFrame, actor?: string): void {
    for (const [listener, boundActor] of this.listeners) {
      // 云端：只发给绑定同一身份的订阅者（防 A 的写入把 B 的界面刷出新数据）。
      if (this.cloudMode && boundActor !== actor) continue
      // 监听方异常不得影响已完成的写入。
      try { listener(frame) } catch { /* 忽略：界面订阅是尽力而为 */ }
    }
  }

  /**
   * 取当前身份；云端缺身份即拒（memory/rejected）。
   * @param action - 用于错误文案的动作名
   * @returns actor
   * @throws MemoryEngineError('memory/rejected') 云端无身份时
   */
  private currentActorOrThrow(action: string): string {
    // ⚠️ 必须用 MemoryEngineError('memory/rejected')：Remote 层按 code 折域码，
    //    抛裸 Error 会被当成 engine-failed，界面就会把"没登录"报成"引擎挂了"。
    throw new MemoryEngineError('memory/rejected', `缺少本端身份，拒绝${action}`)
  }

  /** 默认条数。 */
  get defaultTop(): number {
    return this.config.defaultTop ?? 5
  }

  /** 检索。 */
  async search(query: string, options: { top?: number; project?: string } = {}): Promise<{
    hits: readonly MemoryHit[]
    mode: string
    verdict?: string | undefined
  }> {
    const trimmed = query.trim()
    if (trimmed === '') return { hits: [], mode: 'empty-query' }
    if (this.cloudMode) this.currentActorOrThrow('发起检索')
    return this.engine.search(trimmed, options)
  }

  /** 保存（引擎 operationId 幂等；成功后广播）。 */
  async store(input: {
    text: string
    operationId: string
    project?: string
    importance?: number
    tags?: readonly string[]
  }): Promise<{ id?: string | undefined; action: 'created' | 'idempotent' | 'skipped' | 'rejected'; reason?: string | undefined }> {
    const text = input.text.trim()
    if (text === '') return { action: 'rejected', reason: 'text 不能为空' }
    // ⚠️ 云端必须在调用**之前**抓住身份：引擎内部会再读一次工牌，但广播要按"发起人"算，
    //    否则一次并发换人会让帧发错人。
    const actor = this.cloudMode ? this.currentActorOrThrow('写入记忆') : undefined
    const result = await this.engine.store({
      text,
      operationId: input.operationId,
      ...(input.project === undefined ? {} : { project: input.project }),
      importance: input.importance ?? this.config.defaultImportance ?? 0.5,
      ...(input.tags === undefined ? {} : { tags: input.tags }),
    })
    if (result.action !== 'rejected' && result.id !== undefined) {
      this.emit({ type: 'changed', action: 'store', ids: [result.id] }, actor)
    }
    return result
  }

  /** 纠正（引擎：新条目 + 旧条目退役）。 */
  async correct(input: { id: string; text: string; operationId: string; reason?: string }): Promise<{
    id: string
    supersededId: string
    action: 'corrected'
  }> {
    const text = input.text.trim()
    if (text === '') throw new Error('text 不能为空')
    const actor = this.cloudMode ? this.currentActorOrThrow('纠正记忆') : undefined
    /*
     * ⚠️ 2026-10-27 合入本地共库纠正预检：纠正前先验目标条目是不是本域的。
     * ▍为什么必须有这道预检
     * 共库开启后，dot_memory_search 会带回**别域共享条目**的 id；模型拿着它调 correct 时，
     * 引擎的顺序是"先 store 新条（落在本域，会成功）→ 再 supersede 旧条（越域，被拒）"
     * ——结果是一次**半成功**：别人那条原封不动，本域却多出一条没人要的复制条目。
     * 引擎的 cmd_supersede 有同域硬闸（old.namespace != actor 即拒），但它管不住前一半。
     * 这里在读侧就把越域纠正拦下（get 走引擎可见性闸，读不到的不用拦——引擎自己会报找不到）。
     * ▍为什么不顺手套在 forget/restore 上
     * 引擎 cmd_forget / cmd_restore 在**任何副作用之前**就做同域校验（零副作用拒绝），
     * 引擎侧已经是干净的；只有 correct 的副作用顺序会先写后拒。
     * ▍与云端动态身份的关系
     * this.namespace 在云模式下是动态 getter（按"工牌"现算），本地是配置值；
     * 两个模式共用同一条闸，不需要为云端加分支。
     */
    const target = await this.engine.get(input.id)
    if (target !== undefined && target.namespace !== undefined && target.namespace !== ''
        && target.namespace !== this.namespace) {
      throw new MemoryEngineError('memory/rejected',
        `${input.id} 属于域 ${target.namespace}，不是本域（${this.namespace}）记忆；别人的条目只能引用，不能纠正`)
    }
    const result = await this.engine.correct({
      id: input.id,
      text,
      operationId: input.operationId,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    })
    this.emit({ type: 'changed', action: 'correct', ids: [result.id, result.supersededId] }, actor)
    return result
  }

  /** 删除（未确认只预览；确认才真删）。 */
  async forget(input: { id: string; confirmed: boolean }): Promise<{
    removed: number
    pending?: number | undefined
    preview?: readonly string[] | undefined
    tombstoneRegistered?: boolean | undefined
  }> {
    const actor = this.cloudMode ? this.currentActorOrThrow('删除记忆') : undefined
    const result = await this.engine.forget(input)
    if (input.confirmed && result.removed > 0) {
      this.emit({ type: 'changed', action: 'forget', ids: [input.id] }, actor)
    }
    return result
  }

  /** 单条读取。 */
  async get(id: string): Promise<MemoryHit | undefined> {
    if (this.cloudMode) this.currentActorOrThrow('读取记忆')
    return this.engine.get(id)
  }

  /** 列表。 */
  async list(options: { query?: string; limit?: number; project?: string } = {}): Promise<readonly MemoryHit[]> {
    if (this.cloudMode) this.currentActorOrThrow('列出记忆')
    return this.engine.list(options)
  }

  /**
   * 状态（本地：一次短缓存；云端：按 actor 分桶缓存）。
   * @param fresh - true 强制重新探测
   * @returns 状态
   */
  async status(fresh = false): Promise<MemoryServiceStatus> {
    if (this.cloudMode) {
      // 云端：无身份也要如实报不可用（不抛），界面才知道"我没登录"而不是"引擎挂了"。
      const actor: string = ''
      if (!fresh && actor !== '') {
        const cached = this.cloudStatus.get(actor)
        if (cached !== undefined) return cached
      }
      const engineStatus = await this.engine.status()
      const configured = this.config.namespace
      const namespace = engineStatus.namespace !== ''
        ? engineStatus.namespace
        : (actor !== '' ? actor : configured)
      const value: MemoryServiceStatus = {
        available: engineStatus.available,
        actor,
        namespace,
        ...(engineStatus.reason === undefined ? {} : { reason: engineStatus.reason }),
        ...(engineStatus.engineVersion === undefined ? {} : { engineVersion: engineStatus.engineVersion }),
      }
      if (actor !== '') this.cloudStatus.set(actor, value)
      return value
    }

    if (!fresh && this.lastStatus !== undefined) return this.lastStatus
    const engineStatus = await this.engine.status()
    const actor = this.config.actor
    this.lastStatus = {
      available: engineStatus.available,
      actor,
      // ⚠️ 用引擎回报的**有效域**，不用配置原值：二者可能不同（配置写成别的名字时会收敛到
      //    actor）。界面显示"配置值"而实际读写另一个域 = 用户以为记在这里、其实在那里。
      namespace: engineStatus.namespace,
      ...(engineStatus.reason === undefined ? {} : { reason: engineStatus.reason }),
      ...(engineStatus.engineVersion === undefined ? {} : { engineVersion: engineStatus.engineVersion }),
    }
    return this.lastStatus
  }

  /** 本端身份（只读展示用）。云端按当前工牌现读。 */
  get actor(): string {
    if (this.cloudMode) return ''
    return this.config.actor
  }

  /**
   * 默认域（只读展示用）。
   * ⚠️ 返回**有效域**：缓存过 status 就用引擎回报值，否则按与引擎相同的收敛规则现算，
   *   保证"界面显示什么域 = 实际读写什么域"，绝不出现两个值。
   */
  get namespace(): string {
    if (this.cloudMode) {
      const actor: string | undefined = undefined
      if (actor === undefined) return ''
      // 先看该 actor 自己的缓存桶（不串号），没有就按"域=身份"的约定现算。
      const cached = this.cloudStatus.get(actor)
      return cached !== undefined && cached.namespace !== '' ? cached.namespace : actor
    }
    const configured = this.config.namespace
    const actor = this.config.actor
    const effective = configured === actor || configured === 'knowledge' ? configured : actor
    return this.lastStatus?.namespace ?? effective
  }
}
