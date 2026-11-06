/* ================================================================
   星邮匣 · 服务实现（"邮差"）

   ▍这是什么
   PostboxService：持有打开后的 domain，对外提供
   publish / list / pending / read / archive / preferences / setPreferences /
   retryDelivery / deliveryReceipt / status 这些动作，并在状态变化后推 watch 流。

   ▍为什么所有命令都要 operationId
   手机断线重连、Android 前台服务重启、用户连点两下，都会重复发同一条命令。
   台账（ops 表）记下每个 operationId 的首次结果，重放直接返回第一次的结果，
   "一条事件只产生一次、一条回执只记一次"。这是防重复的唯一支点，不是可选装饰。
   —— 像快递单号：同一单号扫多少次都只是"已签收"，不会多出一个包裹。

   ▍结构
   ★核心★ 构造函数：打开域、拿表、建立 watch 广播
   publishOnce()   事件主写入口（含 dedupeKey 去重与投递初始化）
   runOperation()  台账幂等包装（所有写命令都过它）
   各命令实现
   status()        如实报渠道可用性（不做假成功）

   ▍修改铁律
   1. 【不】绕过 runOperation 直接写状态：那样重放就会重复写。
   2. 【不】在没有渠道回执时把投递写成 delivered（见 transport.ts 铁律）。
   3. 写投递进展必须自增水位（bumpSeq），否则客户端增量拉不到。
   4. 【不】catch 后返回成功；失败抛 PostboxError，由 Remote 层折成域码。
   5. 关闭时只关自己的 domain handle，不清用户数据。
   ================================================================ */
import type { Context } from '@deepseek-ai/cordis'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { OutboundTransport } from './transport.ts'
import { wechatUnavailableReason } from './transport.ts'
import {
  DEFAULT_PREFERENCES, deliveryKey, type DeliveryChannel, type DeliveryRecord, type OperationRecord,
  type PostboxEvent, type PostboxEventView, type PostboxGlobal, type PostboxKind, type PostboxPreferences,
  type PostboxSeverity,
} from './types.ts'
import { POSTBOX_DOMAIN } from './domain.ts'
import {
  defaultSeverityOf, eventIdOf, respectsMinInterval, suppressionOf, visibleInList,
} from './rules.ts'

/** 域失败：由 Remote 层折成稳定错误码，不用自由文本给界面判断。 */
export class PostboxError extends Error {
  readonly code: 'postbox/not-found' | 'postbox/conflict' | 'postbox/unavailable' | 'postbox/invalid-request'
  /**
   * 出错对象（事件 id 等）。Remote 层用它填 `details`。
   * ⚠️【不】让 Remote 层自己猜 id：猜出来的 details 会指向别的对象，
   *   界面按 details 去定位时就会打开错误的信（真发生过的坑）。
   */
  readonly subjectId: string | undefined
  constructor(
    code: 'postbox/not-found' | 'postbox/conflict' | 'postbox/unavailable' | 'postbox/invalid-request',
    message: string,
    subjectId?: string,
  ) {
    super(message)
    this.name = 'PostboxError'
    this.code = code
    this.subjectId = subjectId
  }
}

/** publish 的入参；供 service 与 work 插件（进程内）共用。 */
export interface PublishInput {
  readonly kind: PostboxKind
  readonly severity?: PostboxSeverity
  readonly title: string
  readonly body?: string
  readonly workId?: string
  readonly sessionId?: string
  readonly dedupeKey: string
  readonly origin?: string
  readonly dueAt?: number
  readonly expiresAt?: number
}

/** 列表查询入参。 */
export interface ListQuery {
  readonly cursor?: string
  readonly limit?: number
  readonly unreadOnly?: boolean
  readonly kinds?: readonly PostboxKind[]
  readonly includeArchived?: boolean
}

/** 列表结果。 */
export interface ListResult {
  readonly items: readonly PostboxEventView[]
  readonly nextCursor: string | null
  readonly serverTime: number
}

/** 增量（Android 轮询）结果。 */
export interface PendingResult {
  readonly items: readonly PostboxEventView[]
  readonly cursor: string
  readonly serverTime: number
  /** 本轮被规则挡下、暂不弹出的条数（供 Android 打日志/解释"为什么没弹"）。 */
  readonly suppressed: number
}

/** 渠道状态。 */
export interface PostboxStatus {
  readonly channels: {
    readonly native: { readonly available: boolean; readonly reason?: string }
    readonly feishu: { readonly configured: boolean; readonly reason?: string }
    readonly wechat: { readonly available: false; readonly reason: string }
  }
  readonly preferences: PostboxPreferences
  readonly seq: number
  readonly pendingDeliveries: number
  readonly events: number
}

/** watch 流的一个帧。 */
export interface PostboxWatchFrame {
  readonly type: 'changed'
  readonly seq: number
  /** 本次变化涉及的事件（可能为空：偏好变化）。 */
  readonly eventIds: readonly string[]
}

/** 服务配置。 */
export interface PostboxServiceConfig {
  /** 飞书适配器；不传=不可用（status 如实报）。 */
  readonly feishu?: OutboundTransport
  /** 注入时钟，便于测试；默认 Date.now。 */
  readonly now?: () => number
  /** 列表默认条数。 */
  readonly defaultLimit?: number
}

/**
 * 星邮匣服务：事件与投递记录的唯一所有者。
 */
export class PostboxService {
  private readonly ctx: Context
  private readonly domain: Domain<typeof POSTBOX_DOMAIN>
  private readonly events: KvTable<string, PostboxEvent>
  private readonly deliveries: KvTable<string, DeliveryRecord>
  private readonly ops: KvTable<string, OperationRecord>
  private readonly listeners = new Set<(frame: PostboxWatchFrame) => void>()
  private readonly now: () => number
  private readonly defaultLimit: number
  private readonly feishu: OutboundTransport | undefined
  private readonly deliveryQueue = new Map<string, Promise<unknown>>()
  private closed = false
  /** 间隔到点的一次性叫醒（见 armIntervalWake）；同一时刻只留一个。 */
  private intervalWake: ReturnType<typeof setTimeout> | undefined
  /**
   * 本进程上次把 native 候选交出去的时刻。
   * ⚠️ 只放内存、不落库：它是"这个进程刚才已经弹过"的节流时钟，重启后由投递台账
   *   （delivered/sent 的 updatedAt）继续兜底，两者取较晚的那个（见 nativeLastPopupAt）。
   */
  private lastNativeHandoutAt: number | undefined

  /**
   * 打开域并装配服务。
   * @param ctx - Host 上下文（提供 storageDomain 与 logger）
   * @param config - 服务配置
   * @returns 已就绪的服务；调用方负责 close()
   */
  static async open(ctx: Context, config: PostboxServiceConfig = {}): Promise<PostboxService> {
    const domain = await ctx.storageDomain.open(POSTBOX_DOMAIN)
    return new PostboxService(ctx, domain, config)
  }

  private constructor(
    ctx: Context,
    domain: Domain<typeof POSTBOX_DOMAIN>,
    config: PostboxServiceConfig,
  ) {
    this.ctx = ctx
    this.domain = domain
    this.events = domain.table('events')
    this.deliveries = domain.table('deliveries')
    this.ops = domain.table('ops')
    this.now = config.now ?? (() => Date.now())
    this.defaultLimit = config.defaultLimit ?? 50
    this.feishu = config.feishu
  }

  /** 关闭域句柄；已被别处关闭时幂等。 */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    if (this.intervalWake !== undefined) { clearTimeout(this.intervalWake); this.intervalWake = undefined }
    this.listeners.clear()
    await this.domain.close()
  }

  /** 订阅变化；返回取消函数。 */
  subscribe(listener: (frame: PostboxWatchFrame) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /* ---------- 内部：水位与广播 ---------- */

  /** 读全局槽。 */
  private global(): PostboxGlobal {
    return this.domain.global.get()
  }

  /**
   * 分配下一个序号并广播。
   * ⚠️【勿动】必须先 set(global) 再广播：客户端收到帧就按 seq 拉增量，
   *   若先广播后落水位，客户端可能拿旧水位拉不到刚写的事件。
   * @param eventIds - 本次变化涉及的事件
   * @returns 新的水位
   */
  private async bumpSeq(eventIds: readonly string[]): Promise<number> {
    const current = this.global()
    const next = current.seq + 1
    await this.domain.global.set({ ...current, seq: next })
    const frame: PostboxWatchFrame = { type: 'changed', seq: next, eventIds: [...eventIds] }
    for (const listener of this.listeners) {
      // 监听方异常不影响已提交的写入（与官方 domain 的事件语义一致）。
      try { listener(frame) } catch (error: unknown) {
        this.ctx.logger?.warn?.('dot-postbox: watch listener failed: %s', error instanceof Error ? error.message : String(error))
      }
    }
    return next
  }

  /**
   * 台账幂等包装：同一 operationId 只执行一次，重放返回首次结果。
   * @param operationId - 客户端稳定标识
   * @param action - 动作码（便于审计）
   * @param run - 首次执行体
   * @returns 首次（或重放的）结果
   */
  private async runOperation<T>(operationId: string, action: string, run: () => Promise<T>): Promise<T> {
    if (operationId.length === 0) throw new PostboxError('postbox/invalid-request', 'operationId 不能为空')
    const prior = this.ops.get(operationId)
    if (prior !== undefined) {
      if (prior.action !== action) {
        // 同号不同动作 = 调用方 bug；明确拒绝而不是含糊返回别人的结果。
        throw new PostboxError('postbox/conflict', `operationId ${operationId} 已用于 ${prior.action}`)
      }
      return JSON.parse(prior.result) as T
    }
    const value = await run()
    await this.ops.put(operationId, {
      operationId, action, result: JSON.stringify(value), at: this.now(),
    })
    return value
  }

  /* ---------- 事件写入 ---------- */

  /**
   * 写一条事件（带 dedupeKey 去重）。已存在同 dedupeKey 时返回原事件并标记重复。
   * @param input - 事件内容
   * @param operationId - 可选台账号；进程内工作插件可不传
   * @returns 事件 + 是否重复
   */
  async publish(input: PublishInput, operationId?: string): Promise<{ event: PostboxEvent; duplicate: boolean }> {
    const run = async (): Promise<{ event: PostboxEvent; duplicate: boolean }> => {
      const existing = this.findByDedupeKey(input.dedupeKey)
      if (existing !== undefined) {
        // 重放/重复提醒：不新建事件，但可以刷新 updatedAt 供列表重排。
        const touched: PostboxEvent = { ...existing, updatedAt: this.now() }
        await this.events.put(existing.id, touched)
        return { event: touched, duplicate: true }
      }
      const at = this.now()
      const seq = this.global().seq + 1
      const event: PostboxEvent = {
        id: eventIdOf(seq),
        seq,
        kind: input.kind,
        severity: input.severity ?? defaultSeverityOf(input.kind),
        title: input.title,
        ...(input.body === undefined ? {} : { body: input.body }),
        ...(input.workId === undefined ? {} : { workId: input.workId }),
        ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
        createdAt: at,
        updatedAt: at,
        read: false,
        archived: false,
        ...(input.dueAt === undefined ? {} : { dueAt: input.dueAt }),
        ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
        origin: input.origin ?? 'host',
        dedupeKey: input.dedupeKey,
      }
      await this.events.put(event.id, event)
      // 事件落库后才建投递条：先有信，再有信封。
      for (const channel of this.channelsFor(event)) {
        await this.deliveries.put(deliveryKey(event.id, channel), {
          eventId: event.id, channel, status: 'pending', attempts: 0, updatedAt: at,
        })
      }
      await this.bumpSeq([event.id])
      return { event, duplicate: false }
    }
    return operationId === undefined ? run() : this.runOperation(operationId, 'publish', run)
  }

  /**
   * 该事件此刻应为哪些渠道建投递条。
   * 为什么不在这里真发：投递由消费端（Android / 适配器）或显式 retryDelivery 驱动，
   * 本服务只保证"该有哪几条记录"，不假装送达。
   * @param event - 事件
   * @returns 渠道清单（免打扰只影响状态，不阻止建条——用户关掉免打扰后要能补发）
   */
  private channelsFor(event: PostboxEvent): readonly DeliveryChannel[] {
    const prefs = this.global().preferences
    const channels: DeliveryChannel[] = []
    if (prefs.channels.native) channels.push('native')
    if (prefs.channels.feishu && prefs.feishu.enabled && this.feishu?.available() === true) channels.push('feishu')
    // 微信不建条：没有实现就绝不产生"等着发"的记录。
    return channels
  }

  /** 按 dedupeKey 找已有事件（事件量小，线性扫比维护索引简单且不会错）。 */
  private findByDedupeKey(dedupeKey: string): PostboxEvent | undefined {
    for (const event of this.events.entries()) {
      if (event[1].dedupeKey === dedupeKey) return event[1]
    }
    return undefined
  }

  /* ---------- 查询 ---------- */

  /**
   * 列表查询（按 seq 倒序，游标是上一页最后一个 seq 的字符串形式）。
   * @param query - 查询条件
   * @returns 事件页（每条附带 deliveries 投影）
   */
  list(query: ListQuery = {}): ListResult {
    const at = this.now()
    const limit = Math.min(Math.max(query.limit ?? this.defaultLimit, 1), 200)
    const cursor = query.cursor === undefined ? undefined : Number(query.cursor)
    if (cursor !== undefined && !Number.isFinite(cursor)) {
      throw new PostboxError('postbox/invalid-request', `非法游标 ${query.cursor}`)
    }
    const kinds = query.kinds === undefined ? undefined : new Set(query.kinds)
    const rows = [...this.events.entries()]
      .map(entry => entry[1])
      .filter(event => visibleInList(event, at, query.includeArchived === true))
      .filter(event => query.unreadOnly === true ? !event.read : true)
      .filter(event => kinds === undefined ? true : kinds.has(event.kind))
      .filter(event => cursor === undefined ? true : event.seq < cursor)
      .sort((left, right) => right.seq - left.seq)
    const page = rows.slice(0, limit)
    const nextCursor = rows.length > limit ? String(page[page.length - 1]?.seq ?? '') : null
    return {
      items: page.map(event => this.viewOf(event)),
      nextCursor: nextCursor === '' ? null : nextCursor,
      serverTime: at,
    }
  }

  /**
   * 同一渠道"最近一次真的投出去"的时刻。
   *
   * ▍为什么必须按渠道取、不能按事件取（2026-10-28 修 minIntervalMs 只存不生效）
   * 旧写法把 `record?.updatedAt`（**这一条事件自己**的投递条时间）喂给
   * respectsMinInterval。可候选池里绝大多数事件是"第一次出现、还没有投递条"，
   * lastAt 为 undefined 就直接放行——于是 minIntervalMs 设多少都拦不住，
   * 只能拦住"同一条事件的第二次投递"，而那本来就是不该重复弹的东西。
   * 实测（minIntervalMs=5000，两封信同时到）：等够 5 秒后一次交出 2 条，
   * 用户在同一个瞬间被弹两条 = 设置形同虚设。
   *
   * 现口径：本渠道所有 delivered/sent 投递条里最大的 updatedAt。
   * 不新增字段、不新增表，就用现有投递台账。
   * ⚠️ suppressed / failed 不算投出去——只有 delivered/sent 代表客户端接下了。
   * @param channel - 渠道
   * @returns 毫秒时间戳；该渠道从没投过返回 undefined
   */
  private lastChannelDeliveryAt(channel: DeliveryChannel): number | undefined {
    let latest: number | undefined
    for (const entry of this.deliveries.entries()) {
      const record = entry[1]
      if (record.channel !== channel) continue
      if (record.status !== 'delivered' && record.status !== 'sent') continue
      if (latest === undefined || record.updatedAt > latest) latest = record.updatedAt
    }
    return latest
  }

  /**
   * "上一次弹出去"的判定基准 = max(投递台账里的 delivered/sent 时刻, 本进程上次交出的时刻)。
   *
   * ▍为什么两个都要
   * 只靠投递台账不够：客户端拿到 items 到写回执之间有往返，这段时间里再拉一次
   * （重连、页面抖动、多端同时 watch）会重复拿到同一条 → 用户看到两条一模一样的通知。
   * 只靠内存不够：进程重启后内存清零，节流会瞬时空窗。
   * 取较晚的那个，两种坑一起堵住；0 分支不碰这两个值，行为与旧版逐字节一致。
   */
  private nativeLastPopupAt(): number | undefined {
    const delivered = this.lastChannelDeliveryAt('native')
    const handed = this.lastNativeHandoutAt
    if (delivered === undefined) return handed
    if (handed === undefined) return delivered
    return Math.max(delivered, handed)
  }

  /**
   * 间隔未过时安排一次"到点叫醒"（2026-10-28）。
   *
   * ▍为什么必须有：谁会再喊一次 pending？
   * 消费端拿到 items 才弹、弹完才回执、回执才 bumpSeq、bumpSeq 才有 watch 帧，
   * 有帧才回来拉 pending。若这一轮被间隔整批挡下，就**没有任何东西再触发下一轮**
   * ——被延后的信会静静躺在池子里，用户体感是"提醒不响了"，比扎堆更糟。
   * 所以这里补一发一次性定时器：间隔一过推一格水位（空帧），消费端自然回来取。
   * ⚠️ 只推水位，不动任何事件的投递状态——没有弹过就绝不写成已弹。
   * ⚠️ 关服务后定时器可能晚到：闭包先查 this.closed，避免往已关的域里写。
   */
  private armIntervalWake(delayMs: number): void {
    if (this.intervalWake !== undefined) return
    const timer = setTimeout(() => {
      this.intervalWake = undefined
      if (this.closed) return
      void this.bumpSeq([]).catch(() => { /* 域已关或写失败：没有要叫醒的人 */ })
    }, Math.max(50, delayMs))
    /* 不能为一个节流定时器把 Host 进程吊住。⚠️ Node 返回 Timeout 带 unref，浏览器语义是 number，
       两边类型不一致，所以先过 unknown 再探一次（不写 any）。 */
    const maybeUnref = (timer as unknown as { unref?: () => void }).unref
    if (typeof maybeUnref === 'function') maybeUnref.call(timer)
    this.intervalWake = timer
  }

  /**
   * 增量查询：给 Android 前台服务轮询用。
   *
   * ★规则在这里，不在原生壳里★：免打扰、渠道关闭、过期、最小间隔、已读/归档一律
   * 由本方法判定；原生壳只负责"拿到 items 就弹、弹完回执"，不自己再判一遍——
   * 两处各判一次必然出现"服务端说该弹、壳子说太吵"的互相打架。
   *
   * ★★ since 是"新件发现水位"，不是"投递过滤条件" ★★（2026-10-23 修两轮真实断点）
   *   旧实现三重丢信，主端逐个点出来了：
   *     ① `event.seq > since` ⇒ 通知投递失败（权限被拒/断线/系统吞）后客户端仍推进 cursor，
   *        那条信落在 since 后面，**永不再投**；
   *     ② 返回 `cursor = 全局 seq`（哪怕只回了 limit 条）⇒ 51 条时后 1 条永远拿不到；
   *     ③ DND 抑制期间水位照涨 ⇒ 免打扰结束后被抑制的旧件全部跳过。
   *   现口径（三条一起解决）：
   *     · **候选池 = 全部"未投递成功"的未读未归档事件**（不看 seq 大小）；
   *     · since 只影响**排序优先级**（新件先发），并用于计算"这一页扫到哪儿"；
   *     · 返回的 cursor **只推进到本页实际扫过的最后一条事件 seq**，未扫到的留到下次；
   *       若本页一条候选都没有（全被规则挡下或全都投递过），才推 global seq。
   *   —— 像派件：昨天的失败件还在车上，今天的新件排前面，但都不会凭空消失。
   *
   * ⚠️ 语义边界：返回 items 只表示"现在应该弹通知"；Android 调 deliveryReceipt
   *    (delivered) 只证明系统通知管理器接受了这条通知，**不证明用户看过，也不保证
   *    锁屏一定展示**（系统省电/勿扰/渠道设置都可能吞掉）。文档与界面不得写成"已送达用户"。
   * @param since - 上次拿到的扫描水位（字符串）；只决定"哪些算新件"和分页起点
   * @param limit - 最多几条
   * @returns 增量页 + 新水位 + 被抑制条数
   */
  pending(since?: string, limit = 50): PendingResult {
    const at = this.now()
    const watermark = since === undefined || since === '' ? 0 : Number(since)
    if (!Number.isFinite(watermark)) {
      throw new PostboxError('postbox/invalid-request', `非法 since ${since}`)
    }
    const prefs = this.global().preferences
    const pageSize = Math.min(Math.max(limit, 1), 200)

    // 候选池：所有"还没成功投递"的未读未归档事件。⚠️【不】按 seq 过滤，见方法头 ①③。
    const candidates = [...this.events.entries()]
      .map(entry => entry[1])
      .filter(event => !event.read && !event.archived)
      .filter(event => this.deliveries.get(deliveryKey(event.id, 'native'))?.status !== 'delivered')
      // 新件（seq > 水位）排前面；同组按发生时间正序，用户读到自然顺序。
      .sort((left, right) => {
        const leftNew = left.seq > watermark ? 0 : 1
        const rightNew = right.seq > watermark ? 0 : 1
        if (leftNew !== rightNew) return leftNew - rightNew
        return left.createdAt - right.createdAt
      })

    const items: PostboxEventView[] = []
    let suppressed = 0
    // 本页实际扫过的最高 seq：cursor 只推进到这里（解决 ②）。
    let scanned = -1
    /* 最小间隔看"上次真弹出去"的时刻，不看待前这一条自己的投递条（见 nativeLastPopupAt）。 */
    const nativeLastAt = this.nativeLastPopupAt()
    const minInterval = prefs.native.minIntervalMs
    // 有间隔时一轮最多交一条：客户端拿到几条就一批全弹，"最短间隔"等于没做。
    const intervalCap = minInterval > 0 ? 1 : pageSize
    let deferredByInterval = 0
    for (const event of candidates) {
      scanned = Math.max(scanned, event.seq)
      // 过了新鲜期（默认 24h）不再主动弹：用户关掉通知一整晚后不该被陈年旧信淹没。
      // 旧件仍在 list 里可查，只是不再打断。0 = 不限。
      if (prefs.native.maxAgeMs > 0 && at - event.createdAt > prefs.native.maxAgeMs) {
        suppressed += 1
        continue
      }
      const reason = suppressionOf(event, 'native', prefs, at)
      if (reason !== undefined) { suppressed += 1; continue }
      /* ⚠️ minIntervalMs=0 时这段恒为假（respectsMinInterval 对 <=0 直接放真，intervalCap=pageSize），
         行为与旧版逐字节一致。 */
      if (!respectsMinInterval(nativeLastAt, minInterval, at) || items.length >= intervalCap) {
        /* 被间隔挡下：计 suppressed（调用方要能解释"为什么没弹"），但【不】动投递状态、
           也不从池子里剔除——下一轮它还是候选。 */
        suppressed += 1
        deferredByInterval += 1
        continue
      }
      items.push(this.viewOf(event))
      if (items.length >= pageSize) break
    }
    /* 交出了就记下时刻：从交出到写回执之间有往返，只靠回执计时会被重连打断（见 nativeLastPopupAt）。 */
    if (minInterval > 0 && items.length > 0) this.lastNativeHandoutAt = at
    /* 有信被间隔留在池里就得安排一次到点叫醒，否则没人会再来拉（见 armIntervalWake）。 */
    if (minInterval > 0 && deferredByInterval > 0) {
      const waitMs = items.length > 0
        ? minInterval
        : (nativeLastAt === undefined ? 0 : Math.max(0, minInterval - (at - nativeLastAt)))
      this.armIntervalWake(waitMs)
    }
    // 一条候选都没有（空池或全被规则挡）：说明这一轮把所有候选都看过了，可以推到全局水位。
    const cursor = scanned >= 0 ? String(scanned) : String(this.global().seq)
    return { items, cursor, serverTime: at, suppressed }
  }

  /** 把事件本体投影成前端视图（附投递条）。 */
  private viewOf(event: PostboxEvent): PostboxEventView {
    return { ...event, deliveries: this.deliveriesOf(event.id) }
  }

/** 单条读取（附投递条）。 */
get(id: string): PostboxEventView {
  return this.viewOf(this.requireEvent(id))
}

/**
 * 取持久事件本体（不含投递投影）。
 * ⚠️【勿动】写路径必须用它，不能用 get()：get() 的返回值带 `deliveries`，
 *   写回 events 表会把投影字段也持久化，等于在事实表里造第二份真相。
 * @param id - 事件 id
 * @returns 事件本体
 */
private requireEvent(id: string): PostboxEvent {
  const event = this.events.get(id)
  if (event === undefined) throw new PostboxError('postbox/not-found', `没有事件 ${id}`, id)
  return event
}

  /** 某事件的全部投递记录。 */
  deliveriesOf(id: string): readonly DeliveryRecord[] {
    return [...this.deliveries.entries()]
      .map(entry => entry[1])
      .filter(record => record.eventId === id)
      .sort((left, right) => left.channel.localeCompare(right.channel))
  }

  /* ---------- 命令 ---------- */

  /** 标记已读（幂等）。 */
  async read(id: string, operationId: string): Promise<PostboxEvent> {
    return this.runOperation(operationId, 'read', async () => {
      const event = this.requireEvent(id)
      if (event.read) return event
      const next: PostboxEvent = { ...event, read: true, updatedAt: this.now() }
      await this.events.put(id, next)
      await this.bumpSeq([id])
      return next
    })
  }

  /** 归档（幂等；不删除事实与投递历史）。 */
  async archive(id: string, operationId: string): Promise<PostboxEvent> {
    return this.runOperation(operationId, 'archive', async () => {
      const event = this.requireEvent(id)
      if (event.archived) return event
      const next: PostboxEvent = { ...event, archived: true, updatedAt: this.now() }
      await this.events.put(id, next)
      await this.bumpSeq([id])
      return next
    })
  }

  /** 读偏好与水位。 */
  preferences(): { preferences: PostboxPreferences; rev: number; personalReminders: boolean } {
    const g = this.global()
    return { preferences: g.preferences, rev: g.seq, personalReminders: true }
  }

  /**
   * 写偏好（整体替换语义；rev 可选乐观锁）。
   * @param preferences - 新偏好
   * @param operationId - 台账号
   * @param rev - 期望水位；与当前不符时拒绝（防两端互相覆盖）
   * @returns 新偏好与水位
   */
  async setPreferences(
    preferences: PostboxPreferences,
    operationId: string,
    rev?: number,
  ): Promise<{ preferences: PostboxPreferences; rev: number }> {
    return this.runOperation(operationId, 'set-preferences', async () => {
      const current = this.global()
      if (rev !== undefined && rev !== current.seq) {
        throw new PostboxError('postbox/conflict', `偏好已被别处修改（期望 ${rev}，当前 ${current.seq}）`)
      }
      await this.domain.global.set({ ...current, preferences })
      const seq = await this.bumpSeq([])
      return { preferences, rev: seq }
    })
  }

  private async deliveryOperation(id: string, channel: DeliveryChannel, operationId: string, action: string,
    run: () => Promise<DeliveryRecord>): Promise<DeliveryRecord> {
    if (channel !== 'feishu') return this.runOperation(operationId, action, run)
    const key = deliveryKey(id, channel)
    const prior = this.deliveryQueue.get(key) ?? Promise.resolve()
    const next = prior.catch(() => {}).then(() => this.runOperation(operationId, action, run))
    this.deliveryQueue.set(key, next)
    try {
      const value = await next
      if (value.eventId !== id || value.channel !== channel) throw new PostboxError('postbox/conflict', '回执属于另一项投递')
      return value
    } finally {
      if (this.deliveryQueue.get(key) === next) this.deliveryQueue.delete(key)
    }
  }

  /**
   * 记录一次渠道投递结果（Android 弹完系统通知、飞书拿到确认都走这里）。
   * @param id - 事件
   * @param channel - 渠道
   * @param status - 结果
   * @param operationId - 台账号（同一条回执重放不重复记）
   * @param detail - 失败/抑制原因
   * @returns 更新后的投递条
   */
  async deliveryReceipt(
    id: string,
    channel: DeliveryChannel,
    status: DeliveryRecord['status'],
    operationId: string,
    detail?: string,
  ): Promise<DeliveryRecord> {
    return this.deliveryOperation(id, channel, operationId, 'delivery-receipt', async () => {
      const event = this.requireEvent(id)
      const key = deliveryKey(id, channel)
      const prior = this.deliveries.get(key)
      if (channel === 'feishu' && prior?.status === 'delivered') return prior
      if (prior === undefined && channel === 'wechat') {
        throw new PostboxError('postbox/unavailable', wechatUnavailableReason())
      }
      const attempts = (prior?.attempts ?? 0) + (status === 'suppressed' || (channel === 'feishu' && prior?.status === 'sent') ? 0 : 1)
      const next: DeliveryRecord = {
        eventId: event.id,
        channel,
        status,
        attempts: prior === undefined ? (status === 'suppressed' ? 0 : 1) : attempts,
        updatedAt: this.now(),
        ...(detail === undefined ? {} : { detail }),
        ...(prior?.externalId === undefined ? {} : { externalId: prior.externalId }),
      }
      await this.deliveries.put(key, next)
      await this.bumpSeq([id])
      return next
    })
  }

  /**
   * 重试一次投递：真调用渠道（只有飞书可外发；native 由 Android 自己拉 pending 完成）。
   * @param id - 事件
   * @param channel - 渠道
   * @param operationId - 台账号
   * @returns 更新后的投递条
   */
  async retryDelivery(id: string, channel: DeliveryChannel, operationId: string): Promise<DeliveryRecord> {
    return this.deliveryOperation(id, channel, operationId, 'retry-delivery', async () => {
      const event = this.requireEvent(id)
      const at = this.now()
      const prefs = this.global().preferences
      const suppression = suppressionOf(event, channel, prefs, at)
      const key = deliveryKey(id, channel)
      const prior = this.deliveries.get(key)
      if (channel === 'feishu' && (prior?.status === 'sent' || prior?.status === 'delivered')) return prior
      if (suppression !== undefined) {
        // 抑制不是失败：不改 attempts，理由写进 detail 供界面解释。
        const suppressed: DeliveryRecord = {
          eventId: id, channel, status: 'suppressed', attempts: prior?.attempts ?? 0, updatedAt: at, detail: suppression,
        }
        await this.deliveries.put(key, suppressed)
        await this.bumpSeq([id])
        return suppressed
      }
      if (channel === 'native') {
        // native 的真投递由 Android 前台服务完成并回写 receipt；这里只标记"已交给前端队列"。
        const sent: DeliveryRecord = {
          eventId: id, channel, status: 'sent',
          attempts: (prior?.attempts ?? 0) + 1, updatedAt: at,
          ...(prior?.externalId === undefined ? {} : { externalId: prior.externalId }),
        }
        await this.deliveries.put(key, sent)
        await this.bumpSeq([id])
        return sent
      }
      if (channel === 'wechat') throw new PostboxError('postbox/unavailable', wechatUnavailableReason())
      if (this.feishu === undefined || !this.feishu.available()) {
        const failed: DeliveryRecord = {
          eventId: id, channel, status: 'failed', attempts: (prior?.attempts ?? 0) + 1, updatedAt: at,
          detail: this.feishu?.unavailableReason() ?? '未装配飞书适配器',
        }
        await this.deliveries.put(key, failed)
        await this.bumpSeq([id])
        return failed
      }
      // ⚠️【不】把原生通知的 minInterval 套到飞书上：那是"系统通知别刷屏"的节奏，
      //   与外部渠道无关。飞书的节流应来自渠道自身配额，不在这里凭空加规则。
      // Persist the uncertain attempt before calling the external transport. An interrupted
      // sender can then be reconciled by receipt without submitting the same letter again.
      const attempt: DeliveryRecord = {
        eventId: id, channel, status: 'sent', attempts: (prior?.attempts ?? 0) + 1,
        updatedAt: this.now(), detail: '外发结果待核对',
      }
      await this.deliveries.put(key, attempt)
      await this.bumpSeq([id])
      const result = await this.feishu.send({ title: event.title, body: event.body ?? '' })
      if (result.uncertain) return attempt
      const record: DeliveryRecord = {
        eventId: id, channel, status: result.ok ? 'delivered' : 'failed',
        attempts: attempt.attempts, updatedAt: this.now(),
        ...(result.ok ? {} : { detail: result.error ?? '渠道拒绝投递' }),
        ...(result.externalId === undefined ? {} : { externalId: result.externalId }),
      }
      await this.deliveries.put(key, record)
      await this.bumpSeq([id])
      return record
    })
  }

  /** 渠道与整体状态（缺配置如实报不可用，不假成功）。 */
  status(): PostboxStatus {
    const prefs = this.global().preferences
    const feishuConfigured = this.feishu !== undefined && this.feishu.available()
    let pendingDeliveries = 0
    for (const entry of this.deliveries.entries()) {
      if (entry[1].status === 'pending' || entry[1].status === 'sent') pendingDeliveries += 1
    }
    return {
      channels: {
        native: { available: true },
        feishu: feishuConfigured
          ? { configured: true }
          : { configured: false, reason: this.feishu?.unavailableReason() ?? '未装配飞书适配器' },
        wechat: { available: false, reason: wechatUnavailableReason() },
      },
      preferences: prefs,
      seq: this.global().seq,
      pendingDeliveries,
      events: this.events.size,
    }
  }

  /** 默认偏好（UI 初始化用；写回要显式 setPreferences）。 */
  static defaults(): PostboxPreferences {
    return DEFAULT_PREFERENCES
  }
}
