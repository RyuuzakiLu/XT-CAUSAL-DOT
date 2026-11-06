/* ================================================================
   DOT 显示数据对象 · 总导游图
   ▍这是什么
   React 无关的快照来源；原生 Remote 的调用在 apply 里绑定，组件只读派生值。
   ▍结构
   显示类型 → 请求竞态保护 → 按领域独立发布 → 按空间懒取 → 统一错误。
   ▍修改铁律
   1. 【不】持久化服务器事实；每次重连从原服务拉取。
   2. 慢请求不能覆盖新查询，像旧信件不能塞到新信封里。
   3. 每个领域各自发布：工作/邮匣回来就先显示，【不】等记忆列表。
      记忆是 Python 子进程查询，一次能拖三秒；谁都能被它拖住整桌菜。
   4. 【不】在首开非记忆场景主动拉记忆列表；只有进记忆空间才取。
   5. 卸载后旧请求一律丢弃（generation + disposed 双闸），不许往已拆的台子上搬道具。
   ▍外号表
   "领域"   → DataDomain，一块能独立回来的业务数据（工作/计划/记忆/邮匣/能力）
   "空间"   → DataSpace，界面上的房间；进哪个房间才取哪块领域
   "单飞"   → 同一领域同时只允许一个在途请求，后来的只排一次补读
   ▍更新记录
   *更新：2026-10-23 · 建立跨空间真实业务快照消费面*
   *更新：2026-10-24 · 接个人设置真实保存/显示消费与原生能力配置，保留精灵入口*
   *更新：2026-10-25 · 领域独立发布/按空间懒取/成果按需读取/同领域单飞（记忆不再拖住工作与能力）*
================================================================ */
export type WorkRow = {
  id: string; goal: string; status: string; stage: string; updatedAt: string; createdAt?: string;
  progress?: number; error?: string; artifacts: { id: string; title: string; kind?: 'text' | 'file'; text?: string; url?: string }[]
  /**
   * 「等你处理」的说明与入口（原样来自后端 blocked）。
   * 为什么带 url：钥匙只能由用户本人浏览器交（保密表单 / 第三方授权页），
   * 工作空间要能直接给出那一个可点入口，而不是让用户去聊天里翻链接。
   * ⚠️ 这里【不】允许放任何秘密：后端也只写地址与一句人话。
   */
  blocked?: { kind: 'input' | 'approval'; message: string; code: string; risk?: string; action?: { kind: 'open-url'; label: string; url: string; requestId?: string } }
}
/**
 * 记忆行。
 *
 * ⚠️ 2026-10-26 主线02：补 `kind` / `visibility` / `state` / `supersededBy` / `retireReason`。
 * 没有这几样，界面就只能把"假设"和"正式决定"画成一样、把"已删除归档"当普通条目。
 */
export type MemoryRow = {
  id: string; text: string; updatedAt?: string; source?: string
  /** 种类（事实/讨论/假设/待办/决定）；未标注时 undefined（不猜）。 */
  kind?: string
  /** 可见性原样（private / shared / shared-with:...）。 */
  visibility?: string
  /** 状态：active / superseded / archived。正常列表里应是 active 或 undefined。 */
  state?: string
  /** 被哪条取代（纠正后旧版本的指针）。 */
  supersededBy?: string
  /** 退役原因：forget=可恢复；superseded=被纠正（不可当归档恢复）。 */
  retireReason?: string
}
/** severity：星邮匣原有的轻重（normal / important / urgent），「重要提醒 › 查看全部」据此列出。 */
export type LetterRow = { id: string; title: string; body: string; workId?: string; read: boolean; archived: boolean; createdAt: string; delivery?: string; severity?: string;
  /** 信件类别（work-blocked / work-waiting-approval / reminder / info …）；决定它算不算「要你动手」。 */
  kind?: string;
  /** 由服务端稳定的主动问候事件键识别，供色卡区分主动问候。 */
  proactive?: boolean;
  /** 这一条最近一次有新动态的时间（ms）；精灵角标用它判断「看过没有」。 */
  at?: number;
  /** 知序待办：同一任务的同步信在服务端折成一条，状态取知序任务实时值（见 scripts/dot-cloud-postbox.mjs）。 */
  todo?: LetterTodo }
/** 星邮匣里的一条知序待办。status 只跟知序任务走；读没读过只看 LetterRow.read，两者互不影响。 */
export type LetterTodo = {
  taskId: string; status: 'pending' | 'in_progress' | 'done' | 'canceled'; statusLabel: string;
  done: boolean; closed: boolean; progress: string;
  updates: { id: string; title: string; body: string; at: string; read: boolean }[] }
export type CapabilityRow = { id: string; title: string; available: boolean; reason?: string; enabled?: boolean }
export type PlanRow = { planId: string; scheduleId: string; title: string; goal: string; paused: boolean; cancelled: boolean; nextAt?: string }
export type ProviderRow = { id: string; name: string; active: boolean; endpoint?: string; error?: string; models: { id: string; name: string; selected?: boolean; reasoning?: string[] }[] }
export type ReminderSettings = { personalReminders?: boolean | undefined; preferences: import('@xtcausal/dot-postbox/types').PostboxPreferences; rev: number }
/** 能独立回来的业务块。记忆单独一块，别让它跟工作挤同一班车。 */
export type DataDomain = 'work' | 'plans' | 'memory' | 'postbox' | 'capabilities'
export type DataSpace = 'study' | 'conversation' | 'work' | 'memory' | 'capabilities' | 'postbox'
export type DataSnapshot = {
  sessions: { id: string; title: string }[]; works: WorkRow[]; plans: PlanRow[]; memories: MemoryRow[]; letters: LetterRow[]; capabilities: CapabilityRow[];
  /** 历史条目（含 archived/superseded）：只在用户打开"历史"时取，不参与正常召回。 */
  memoryHistory?: MemoryRow[];
  /** 历史是否查全；false = 扫描面用完或被 limit 截断，界面必须提示"可能还有更早的"。 */
  memoryHistoryComplete?: boolean;
  /**
   * 历史这一块自己的失败原因（连接没挂上/对端没这个接口/查询报错）。
   * ⚠️ 独立字段，【不】并进全局 `error`：历史是可选功能，它不可用不该让整个壳顶红条，
   * 更不该把精灵状态打成"出了点状况"（2026-10-26 实测踩过）。
   */
  memoryHistoryError?: string | undefined;
  /** 首屏（工作领域）是否在取；【不】再被慢记忆拖住，记忆看 domainLoading.memory。 */
  loading: boolean; error: string | null; connected: boolean; busy: boolean; dnd: boolean; noticeId: string | null;
  /** 原生连接服务的恢复状态（connection.state）：简洁版顶栏的在线 / 连接中 / 未连接灯用它（lite/link-status.ts）。 */
  link?: 'connected' | 'connecting' | 'disconnected';
  /** 各领域自己的在途标记；场景空态优先读本领域，没接线时回退到 loading。 */
  domainLoading?: Partial<Record<DataDomain, boolean>>;
  reminderSettings?: ReminderSettings; memoryStatus?: { available: boolean; reason?: string | undefined; engineVersion?: string | undefined; sharedLibrary?: boolean };
  channelStatus?: { feishuConfigured: boolean; reason?: string }; providers?: ProviderRow[]; providerError?: string | null;
}
export type DataPort = {
  load(): Promise<Partial<DataSnapshot>>
  search(query: string): Promise<MemoryRow[]>
  command(action: string, value: Record<string, unknown>): Promise<void>
  /** 只取一块领域；老实现不提供时，模型退回整包 load()。 */
  loadDomain?(domain: DataDomain): Promise<Partial<DataSnapshot>>
  /** 按工作编号读成果正文；界面真正打开那张卡时才调。 */
  readArtifacts?(workId: string): Promise<{ id: string; text?: string; url?: string }[]>
  /**
   * 读记忆历史（含 archived/superseded）；用户点"历史"时才调，不参与首屏。
   * `options.project` 走引擎侧真实可用的过滤（正本 lookup 没有 --project，
   * 由 DOT 适配器在扫描面内筛，**可能不全**——`complete=false` 要显示出来）。
   */
  readMemoryHistory?(options: { query?: string; limit?: number; project?: string }): Promise<{ rows: MemoryRow[]; complete: boolean; scanned: number }>
}

/* 进哪个房间取哪块领域。首页/对话要工作进度和未读信，所以带 work+postbox；
   记忆只在记忆空间取 —— 这一条是首开提速的关键（研究 §6）。 */
const SPACE_DOMAINS: Record<DataSpace, readonly DataDomain[]> = {
  study: ['work', 'postbox'],
  conversation: ['work', 'postbox'],
  work: ['work', 'plans'],
  memory: ['memory'],
  postbox: ['postbox'],
  capabilities: ['capabilities'],
}

/* 每个房间的"主领域"：旧字段 loading 跟着它走，场景不改也能显示合理文案。 */
const PRIMARY_DOMAIN: Record<DataSpace, DataDomain> = {
  study: 'work', conversation: 'work', work: 'work', memory: 'memory', postbox: 'postbox', capabilities: 'capabilities',
}
/* 半接线兜底：主端还没调 setSpace 时，整包 load 仍按老样子取全部。 */
const ALL_DOMAINS: readonly DataDomain[] = ['work', 'plans', 'memory', 'postbox', 'capabilities']

/* 一个实例属于一个插件 fiber，取消只是阻止过期显示，不谎称取消服务器动作。 */
export class DotDataModel {
  private snapshot: DataSnapshot = { sessions: [], works: [], plans: [], memories: [], letters: [], capabilities: [], loading: false, error: null, connected: false, busy: false, dnd: false, noticeId: null }
  private listeners = new Set<() => void>()
  private generation = 0
  private searchGeneration = 0
  private disposed = false
  private refreshPending: Promise<void> | null = null
  private refreshAgain = false
  private query: string | null = null
  /* 领域单飞：在途 + 最多一次补读；各领域各算各的，互不排队。 */
  private readonly domainFlight = new Map<DataDomain, Promise<void>>()
  private readonly domainAgain = new Set<DataDomain>()
  private readonly domainGen: Partial<Record<DataDomain, number>> = {}
  private readonly loadedDomains = new Set<DataDomain>()
  /* 每个领域各自的失败原因。合并不是覆盖：能力域成功不能把记忆域的失败擦成 null。 */
  private readonly domainErrors: Partial<Record<DataDomain, string>> = {}
  private domainSource: DataPort | null = null
  private space: DataSpace = 'study'
  /* 只有主端/场景真正调过 setSpace 才算"按空间取数"已接线。
     没接线时 refresh() 仍走老整包 load，否则记忆页的刷新按钮会刷到别的领域去。 */
  private spaceWired = false
  private openWork: string | null = null
  /* 成果正文按【成果 id】记成功，不按工作 id 提前记账：
     打开失败要能重试；工作列表刷新只带回元信息时，已取到的正文也不算"没取过"。 */
  private readonly artifactLoaded = new Set<string>()
  private readonly artifactContent = new Map<string, { text?: string; url?: string }>()
  /* 在途成果读取按工作 id 登记，并记住"是谁发起的"：
     重连换了新 source 后，同一张卡可以重新发；旧 source 的 finally 不许抹掉新占位。 */
  private readonly artifactFlight = new Map<string, { source: DataPort; token: symbol }>()

  constructor(private readonly port: DataPort) {}
  getSnapshot = (): DataSnapshot => this.snapshot
  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  /* 替换同一来源并通知，快照身份只在内容变化时改变。 */
  update(value: Partial<DataSnapshot>): void {
    if (this.disposed) return
    this.snapshot = { ...this.snapshot, ...value }
    for (const fn of this.listeners) fn()
  }
  /* 用户点「刷新」/重连的入口。接了领域源后只重取当前空间那几块，
     【不】再整包拉（记忆空间的刷新不该把工作+邮件+能力也重查一遍）。 */
  async refresh(): Promise<void> {
    if (this.domainSource?.loadDomain && this.spaceWired) {
      for (const domain of SPACE_DOMAINS[this.space]) await this.refreshDomain(domain)
      return
    }
    const generation = ++this.generation
    this.update({ loading: true })
    try {
      const searchGeneration = this.searchGeneration
      const value = await this.port.load()
      if (this.query !== null) {
        const memories = await this.port.search(this.query)
        if (searchGeneration === this.searchGeneration) value.memories = memories
        else delete value.memories
      }
      if (generation === this.generation) this.update({ ...value, loading: false, error: value.error ?? null })
    } catch (error) {
      if (generation === this.generation) this.update({ loading: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  /* 高频阶段事件合并为一次在途刷新和一次补读，不为每个字都重新开 Python 引擎。 */
  refreshCoalesced(): Promise<void> {
    if (this.refreshPending) { this.refreshAgain = true; return this.refreshPending }
    this.refreshPending = (async () => {
      do { this.refreshAgain = false; await this.refresh() } while (this.refreshAgain && !this.disposed)
    })().finally(() => { this.refreshPending = null })
    return this.refreshPending
  }
  /* 搜索保留失败事实，不把请求失败显示为空库。 */
  async search(query: string): Promise<void> {
    this.query = query
    const generation = ++this.searchGeneration
    try { const memories = await this.port.search(query); if (generation === this.searchGeneration && !this.disposed) this.update({ memories, error: null }) }
    catch (error) { if (generation === this.searchGeneration && !this.disposed) this.update({ error: error instanceof Error ? error.message : String(error) }) }
  }
  /**
   * 读记忆历史（含已取代/已归档）。
   *
   * ⚠️ 刻意与 `search` 分开：历史里混着 superseded 的旧版本，
   * 若和正常列表共用 `memories` 字段，界面必然把旧版本当"当前记忆"显示——
   * 那正是卡 §3 第 4 条要防的。所以单独放 `memoryHistory`。
   *
   * ⚠️ 2026-10-26 R1：带 `complete` 一起回。正本 lookup 不支持 --project，
   * 项目过滤只能在适配器侧做——只筛一页就说过滤好了会**静默漏条目**。
   * 不完整就必须在界面上说出来，不能让用户把"没查到"当"不存在"。
   *
   * 🔴 2026-10-26 R2：历史查询能力挂在 `domainSource`（remote-adapter 连上后才挂的那个完整
   * port），跟 `readArtifacts` 同一条路。构造时传进来的 `this.port` 只有 load/search/command，
   * 从它身上找永远找不到——老实现因此恒定判定"当前连接不提供记忆历史查询"。
   *
   * ⚠️ 失败只写 `memoryHistoryError`（历史面板自己显示），【不】并进 `domainErrors.memory`、
   * 也不写全局 `error`：历史是可选功能，它不可用不该让记忆页顶红条，更不该把精灵状态
   * 打成"出了点状况"（2026-10-26 实测：一进记忆页精灵就变脸，根因就是这条被当成了全库故障）。
   */
  async readHistory(query?: string, project?: string): Promise<void> {
    const source = this.domainSource
    const read = source?.readMemoryHistory?.bind(source)
    if (!read) {
      /* 连接还没挂上，或者这一版对端确实没这个接口；两种情况都只影响记忆历史这一块。 */
      this.update({ memoryHistoryError: '当前连接不提供记忆历史查询' })
      return
    }
    try {
      const page = await read({
        ...(query === undefined || query === '' ? {} : { query }),
        ...(project === undefined || project === '' ? {} : { project }),
        limit: 100,
      })
      /* 成功才清原因：失败原因不清，用户关掉再打开还能看到为什么。 */
      if (!this.disposed) this.update({ memoryHistory: page.rows, memoryHistoryComplete: page.complete, ...(this.snapshot.memoryHistoryError === undefined ? {} : { memoryHistoryError: undefined }) })
    } catch (error) {
      if (!this.disposed) this.update({ memoryHistoryError: error instanceof Error ? error.message : String(error) })
    }
  }
  /* 点击与工具最终指向同一个 Host 业务服务；这里不重写业务规则。 */
  async command(action: string, value: Record<string, unknown> = {}): Promise<void> {
    try {
      await this.port.command(action, value)
      /* 动作只重取它动过的那块（建工作→工作+计划，读信→邮匣…）。
         以前这里一律整包 refresh，等于用户点一下「新建工作」也要等记忆引擎三秒。 */
      const domain = this.affectedDomain(action)
      if (this.domainSource?.loadDomain) {
        /* 不认识的动作用"当前空间要的那几块"兜底，绝不顺手把记忆也拉一遍。 */
        const domains = domain ? [domain] : SPACE_DOMAINS[this.space]
        for (const item of domains) await this.refreshDomain(item)
      } else await this.refresh()
    }
    catch (error) { this.update({ error: error instanceof Error ? error.message : String(error) }); throw error }
  }

  /* 动作 → 被它改写的领域；不认识的返回 null 走"当前空间"兜底。
     settings.reminders 改的是星邮匣偏好，所以归 postbox，不归设置。 */
  private affectedDomain(action: string): DataDomain | null {
    if (action.startsWith('work.')) return 'work'
    if (action.startsWith('plan.')) return 'plans'
    if (action.startsWith('memory.')) return 'memory'
    if (action.startsWith('postbox.')) return 'postbox'
    if (action === 'settings.reminders') return 'postbox'
    return null
  }

  /* ---------------- 领域取数（2026-10-25 新增，旧接口原样保留） ---------------- */

  /** remote-adapter 连上后把带 loadDomain/readArtifacts 的 port 挂进来；返回卸载时摘钩子。
      摘钩子要清掉"这块取过了"的记账：重连后是新连接、新事实，
      不清的话 warmSpace 会全命中旧缓存，首屏永远拿重连前的老数据。 */
  attachDomainSource(source: DataPort): () => void {
    this.domainSource = source
    return () => {
      if (this.domainSource !== source) return
      this.domainSource = null
      /* 代数 +1：已经发出的旧响应回来也没资格写（这条是"旧连接不覆盖新连接"的闸）。 */
      for (const domain of Object.keys(this.domainGen) as DataDomain[]) this.domainGen[domain] = (this.domainGen[domain] ?? 0) + 1
      this.domainFlight.clear()
      this.domainAgain.clear()
      this.loadedDomains.clear()
      this.artifactFlight.clear()
      this.artifactLoaded.clear()
      this.artifactContent.clear()
      for (const domain of Object.keys(this.domainErrors) as DataDomain[]) delete this.domainErrors[domain]
    }
  }
  getSpace(): DataSpace { return this.space }
  /** 当前空间要取哪几块。主端还没接 setSpace 时返回全部：老调用方（整包 load）
      行为保持不变，接了以后才收窄到本空间，免得有人半接线时功能被砍掉。 */
  spaceDomains(): readonly DataDomain[] { return this.spaceWired ? SPACE_DOMAINS[this.space] : ALL_DOMAINS }
  /** 该领域是否已经取过一次（决定流事件要不要跟着刷新，免得后台空转）。 */
  hasDomain(domain: DataDomain): boolean { return this.loadedDomains.has(domain) }

  /** 切空间：只补齐这个房间要用的领域；同房间重复进入不重复请求。
      重复通知（界面重载/订阅抖动）落在 ensureDomain 的去重上，这里不再额外判断。 */
  setSpace(space: DataSpace): void {
    if (this.disposed) return
    this.space = space
    this.spaceWired = true
    for (const domain of SPACE_DOMAINS[space]) this.ensureDomain(domain)
  }

  /** 业务连接刚就绪时补一次首屏取数。只取"当前空间"那几块；
      主端接上 setSpace 之前，space 停留在默认的 study（工作+邮匣），
      记忆页仍可用刷新按钮按需取（那条走整包 load，是老行为）。 */
  warmSpace(): void {
    if (this.disposed) return
    for (const domain of SPACE_DOMAINS[this.space]) this.ensureDomain(domain)
  }

  /** 强制刷新一块领域（流事件/用户刷新用）；同领域在途时合并为一次补读。 */
  refreshDomain(domain: DataDomain): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const running = this.domainFlight.get(domain)
    if (running) { this.domainAgain.add(domain); return running }
    const flight = (async () => {
      do {
        this.domainAgain.delete(domain)
        await this.loadDomainOnce(domain)
      } while (this.domainAgain.has(domain) && !this.disposed)
    })().finally(() => { this.domainFlight.delete(domain) })
    this.domainFlight.set(domain, flight)
    return flight
  }

  /** 打开临时工作卡才读成果正文。
      ⚠️ 记账单位是【成果 id 成功过】，不是"这张工作打开过"：
        ① 关掉卡再打开要能直接看到已取到的正文（列表刷新只带元信息，会把它冲掉）；
        ② 取失败不算成功，重新打开要能重试；
        ③ 后来新增的成果没缓存，再次打开仍要补取。 */
  setOpenWork(workId: string | null): void {
    this.openWork = workId
    if (this.disposed || !workId) return
    /* 先把已缓存的正文补回快照：即便工作列表刚被元信息覆盖，重开也能立刻看到。 */
    this.applyArtifactCache()
    const row = this.snapshot.works.find(value => value.id === workId)
    /* ⚠️ 工作列表还没到（row 为空）时也要取：用户可能先点了卡再等数据；
       等列表到了再由 applyArtifactCache 按 id 拼回去。 */
    const missing = row ? row.artifacts.filter(item => !this.artifactLoaded.has(item.id)) : null
    if (missing && !missing.length) return
    const source = this.domainSource
    if (!source?.readArtifacts || this.artifactFlight.has(workId)) return
    const token = Symbol('artifact')
    this.artifactFlight.set(workId, { source, token })
    void source.readArtifacts(workId).then(contents => {
      /* ⚠️ 只判 disposed 不够：detach/换 source 后旧连接的结果已经不代表当前事实，
         正文和错误都不许写进快照（否则重连后会被断线前的老东西覆盖）。 */
      if (this.disposed || this.domainSource !== source) return
      /* 成功一个记一个；整次成功也允许"部分成果读失败"由上层返回空，不在这儿编造。 */
      for (const content of contents) {
        this.artifactLoaded.add(content.id)
        this.artifactContent.set(content.id, { ...(content.text === undefined ? {} : { text: content.text }), ...(content.url === undefined ? {} : { url: content.url }) })
      }
      this.applyArtifactCache()
      /* 这一块取成功就把工作域的旧错误撤掉；别的领域失败不受影响。 */
      delete this.domainErrors.work
      this.update({ error: this.errorText() })
    }).catch(error => {
      /* 失败【不】记成功、【不】缓存：用户再打开同一张卡应该重试。同理，旧 source 的失败也不许写。 */
      if (this.disposed || this.domainSource !== source) return
      this.domainErrors.work = error instanceof Error ? error.message : String(error)
      this.update({ error: this.errorText() })
    }).finally(() => {
      /* 只清自己那次的占位：新 source 可能已经为同一工作 id 重新发了请求。 */
      if (this.artifactFlight.get(workId)?.token === token) this.artifactFlight.delete(workId)
    })
  }

  /* 把已取到的成果正文按 id 拼回快照；列表刷新只带元信息时靠它保住正文。
     只在真的补进内容时才通知，避免每次打开卡片都白刷一轮订阅者。 */
  private applyArtifactCache(): void {
    if (!this.artifactContent.size) return
    let changed = false
    const works = this.snapshot.works.map(row => ({
      ...row,
      artifacts: row.artifacts.map(item => {
        const cached = this.artifactContent.get(item.id)
        if (!cached || (item.text === cached.text && item.url === cached.url)) return item
        changed = true
        return { ...item, ...cached }
      }),
    }))
    if (changed) this.update({ works })
  }

  /* 各领域失败拼成一条给人看的话；没有任何失败时才是 null，
     不能因为某块成功就把别人的失败擦掉。 */
  private errorText(): string | null {
    const values = Object.values(this.domainErrors).filter((value): value is string => Boolean(value))
    return values.length ? values.join('\n') : null
  }

  /* 已取过的领域不再自动重取；想强刷走 refreshDomain。 */
  private ensureDomain(domain: DataDomain): void {
    if (this.loadedDomains.has(domain) || this.domainFlight.has(domain)) return
    /* 业务连接还没接上（首屏早于 Remote 就绪）：什么都别发，
       否则只会把「尚未就绪」的占位错误糊到首页；接上后适配器会重放一次 setSpace。 */
    if (!this.domainSource) return
    /* 老实现只有整包 load：只让它替工作领域兜底一次，避免每进一个房间就全量重拉。 */
    if (!this.domainSource.loadDomain) { if (domain === 'work') void this.refresh(); return }
    void this.refreshDomain(domain)
  }

  /* 单块领域的一次取数：只发布这块，不碰别的领域。 */
  private async loadDomainOnce(domain: DataDomain): Promise<void> {
    const generation = (this.domainGen[domain] ?? 0) + 1
    this.domainGen[domain] = generation
    this.setDomainLoading(domain, true)
    try {
      const source = this.domainSource
      const value = source?.loadDomain ? await source.loadDomain(domain) : await this.port.load()
      if (this.disposed || generation !== this.domainGen[domain]) return
      /* 记忆列表回来时如果用户已经改搜过，就别拿旧列表覆盖搜索结果。 */
      const searchGeneration = this.searchGeneration
      if (domain === 'memory' && this.query !== null) {
        const memories = await this.port.search(this.query)
        if (searchGeneration === this.searchGeneration) value.memories = memories
        else delete value.memories
        if (this.disposed || generation !== this.domainGen[domain]) return
      }
      this.loadedDomains.add(domain)
      /* 适配器可能"局部失败但仍返回上一份真值"（safely 兜底），失败原因放在 value.error 里。
         这里把它记进本领域的错误簿：既不丢这条失败，也不拿 null 擦掉别的领域。 */
      const reported = typeof value.error === 'string' && value.error ? value.error : null
      if (reported) this.domainErrors[domain] = reported
      else delete this.domainErrors[domain]
      this.update({ ...value, error: this.errorText() })
      /* 工作列表只带成果元信息，会把已取到的正文冲掉；按 id 缓存补回来。 */
      if (domain === 'work') this.applyArtifactCache()
    } catch (error) {
      if (this.disposed || generation !== this.domainGen[domain]) return
      this.domainErrors[domain] = error instanceof Error ? error.message : String(error)
      this.update({ error: this.errorText() })
    } finally {
      if (!this.disposed) this.setDomainLoading(domain, false)
    }
  }

  /* domainLoading 是真相；旧字段 loading 只跟随"当前空间的主领域"，
     这样老场景（能力页的「正在读取能力…」、记忆页空态）不用改也有合理文案，
     而记忆慢的时候不会再把首页/工作页点亮成加载中。 */
  private setDomainLoading(domain: DataDomain, value: boolean): void {
    const next = { ...(this.snapshot.domainLoading ?? {}) }
    if (value) next[domain] = true
    else delete next[domain]
    this.update({ domainLoading: next, loading: Boolean(next[PRIMARY_DOMAIN[this.space]]) })
  }

  dispose(): void {
    this.disposed = true
    ++this.generation
    ++this.searchGeneration
    for (const domain of Object.keys(this.domainGen) as DataDomain[]) this.domainGen[domain] = (this.domainGen[domain] ?? 0) + 1
    this.domainSource = null
    this.listeners.clear()
  }
}
