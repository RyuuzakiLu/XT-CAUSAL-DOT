/* ================================================================
   星邮匣 · Remote 门面（wire namespace = `dotPostbox`）

   ▍这是什么
   把 PostboxService 的能力按官方 Typert Remote 规则暴露给 Client（WebView / Android）。
   服务继承 `TypertRemoteService`，wire 命名空间与 Cordis 服务键一起在构造函数里绑定。

   ▍为什么每个方法要包一层 `remoteExport*`
   官方生成器要求 Remote 方法参数"具名且必填、不能可选/解构/默认值"；所以对外统一
   收一个请求对象（`{...}` 里都是必填字段，可选语义放在对象内部字段上由 zod 描述），
   再转给业务方法。业务方法保持内部形态不变。
   —— 像柜台：窗口只收填好的表单，后厨怎么切菜不归窗口管。

   ▍修改铁律
   1. 【不】在这些方法里加业务规则；所有判定都在 service/rules 里，本层只做参数搬运。
   2. 失败一律抛 `RemoteError('postbox/xxx')`，不用自定义 {status,data,error} 外壳。
   3. 【不】新增"任意路径/任意库"这类参数；事件域由本包固定声明。
   4. Android 只消费 `pending` 与 `deliveryReceipt`；不要把 pending 的规则再暴露成可配参数，
      否则服务端与壳子会出现两套判定。
   ================================================================ */
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import { PostboxError, type PostboxService } from './service.ts'
/*
 * ⚠️ 这些 Remote 边界类型必须来自 `./types.ts`（包暴露为子路径 `./types`），
 *    不能在本文件里定义——Typert 生成器只认非根子路径导出的类型，写在这里会直接
 *    导致 `./remote` 产物生成失败（Client 侧接口全空）。
 */
import type {
  DeliveryRecord, DotPostboxGetRequest, DotPostboxIdCommandRequest, DotPostboxListRequest,
  DotPostboxListValue, DotPostboxPendingRequest, DotPostboxPendingValue, DotPostboxPreferencesValue,
  DotPostboxReceiptRequest, DotPostboxRetryRequest, DotPostboxSetPreferencesRequest,
  DotPostboxStatusValue, DotPostboxWatchFrame, PostboxEventView,
} from './types.ts'

/* 失败码合并进官方码表：界面按 code 分支，不比较中文。 */
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** 事件不存在。 */
    'postbox/not-found': { readonly eventId: string }
    /** 同一 operationId 被用于另一个动作，或乐观锁版本不符。 */
    'postbox/conflict': { readonly reason: string }
    /** 渠道不可用（微信固定不可用；飞书未配置）。 */
    'postbox/unavailable': { readonly reason: string }
    /** 请求本身不合法（空 operationId、非法游标等）。 */
    'postbox/invalid-request': { readonly reason: string }
  }
}

/** 把域异常折成官方 Remote 失败。 */
function asRemoteFailure(error: unknown): never {
  if (error instanceof PostboxError) {
    switch (error.code) {
      case 'postbox/not-found':
        // details.eventId 必须指向真实出错对象（PostboxError 自带 subjectId），
        // 不能填空串——界面按它定位，空串等于把用户带到"没有那封信"。
        throw new RemoteError('postbox/not-found', error.message, { eventId: error.subjectId ?? '' })
      case 'postbox/conflict':
        throw new RemoteError('postbox/conflict', error.message, { reason: error.message })
      case 'postbox/unavailable':
        throw new RemoteError('postbox/unavailable', error.message, { reason: error.message })
      case 'postbox/invalid-request':
        throw new RemoteError('postbox/invalid-request', error.message, { reason: error.message })
      default:
        throw error
    }
  }
  throw error
}

/**
 * 星邮匣 Remote owner。
 */
export class PostboxRemote extends TypertRemoteService {
  /** 只依赖自己的业务服务；不加额外服务依赖。 */
  static inject = [] as const

  /**
   * ⚠️【勿动】Cordis 服务键必须是 `dotPostboxRemote`，**不能**与业务服务键 `dotPostbox` 相同。
   *   同一个键会在 Cordis 里注册两次（一次是本 Remote，一次是 apply 里的 PostboxService），
   *   装配时直接抛 `service "dotPostbox" has been registered`。
   *   官方惯例同款：JobController 的服务键是 `jobController`，wire namespace 才是 `job`。
   */
  constructor(ctx: Context, private readonly postbox: PostboxService) {
    super(ctx, 'dotPostboxRemote', { namespace: 'dotPostbox' })
  }

  /** 列表（每条带 deliveries 投影）。 */
  @Remote('list')
  remoteExportList(request: DotPostboxListRequest): DotPostboxListValue {
    try {
      return this.postbox.list({
        ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
        ...(request.limit === undefined ? {} : { limit: request.limit }),
        ...(request.unreadOnly === undefined ? {} : { unreadOnly: request.unreadOnly }),
        ...(request.kinds === undefined ? {} : { kinds: request.kinds }),
        ...(request.includeArchived === undefined ? {} : { includeArchived: request.includeArchived }),
      })
    } catch (error: unknown) { return asRemoteFailure(error) }
  }

  /** 增量（Android 前台服务轮询用；规则已在服务端执行）。 */
  @Remote('pending')
  remoteExportPending(request: DotPostboxPendingRequest): DotPostboxPendingValue {
    try {
      return this.postbox.pending(request.since, request.limit ?? 50)
    } catch (error: unknown) { return asRemoteFailure(error) }
  }

  /** 单条读取。 */
  @Remote('get')
  remoteExportGet(request: DotPostboxGetRequest): PostboxEventView {
    try {
      return this.postbox.get(request.id)
    } catch (error: unknown) { return asRemoteFailure(error) }
  }

  /** 标记已读。 */
  @Remote('read')
  async remoteExportRead(request: DotPostboxIdCommandRequest): Promise<PostboxEventView> {
    try {
      const event = await this.postbox.read(request.id, request.operationId)
      return this.postbox.get(event.id)
    } catch (error: unknown) { return asRemoteFailure(error) }
  }

  /** 归档。 */
  @Remote('archive')
  async remoteExportArchive(request: DotPostboxIdCommandRequest): Promise<PostboxEventView> {
    try {
      const event = await this.postbox.archive(request.id, request.operationId)
      return this.postbox.get(event.id)
    } catch (error: unknown) { return asRemoteFailure(error) }
  }

  /** 读偏好。 */
  @Remote('preferences')
  remoteExportPreferences(): DotPostboxPreferencesValue {
    return this.postbox.preferences()
  }

  /** 写偏好（rev 乐观锁可选）。 */
  @Remote('setPreferences')
  async remoteExportSetPreferences(request: DotPostboxSetPreferencesRequest): Promise<DotPostboxPreferencesValue> {
    try {
      return await this.postbox.setPreferences(
        request.preferences, request.operationId, request.rev,
      )
    } catch (error: unknown) { return asRemoteFailure(error) }
  }

  /** 回执（native 弹完/飞书确认后回写；同 operationId 幂等）。 */
  @Remote('deliveryReceipt')
  async remoteExportDeliveryReceipt(request: DotPostboxReceiptRequest): Promise<DeliveryRecord> {
    try {
      return await this.postbox.deliveryReceipt(
        request.id, request.channel, request.status, request.operationId, request.detail,
      )
    } catch (error: unknown) { return asRemoteFailure(error) }
  }

  /** 重试投递（飞书真发；native 只标记已交给前端队列）。 */
  @Remote('retryDelivery')
  async remoteExportRetry(request: DotPostboxRetryRequest): Promise<DeliveryRecord> {
    try {
      return await this.postbox.retryDelivery(request.id, request.channel, request.operationId)
    } catch (error: unknown) { return asRemoteFailure(error) }
  }

  /** 渠道与整体状态。 */
  @Remote('status')
  remoteExportStatus(): DotPostboxStatusValue {
    return this.postbox.status()
  }

  /** 变化流：Client 订阅后按 seq 主动拉快照/增量。 */
  /* ⚠️ 显式给导出名 'watch'：`@Remote({mode:'stream'})` 不带 name 时，endpoint 名会回落成
     方法名 `remoteExportWatch`，Client 侧 `ctx.remote.dotPostbox.watch` 就找不到它。 */
  @Remote({ name: 'watch', mode: 'stream' })
  remoteExportWatch(signal: AbortSignal): AsyncIterable<DotPostboxWatchFrame> {
    return watchStream(this.postbox, signal)
  }
}

/**
 * 把服务订阅桥成 AsyncIterable。
 *
 * 为什么不用轮询：官方 Remote 流自带取消与背压；轮询会在这条链上再造一个定时器。
 * 断开时通过 signal 收尾，不留下悬挂的监听（生命周期交给 carrier）。
 *
 * ★先发一帧 `ready`★（2026-10-23 实测教训）：官方流协议没有"开流确认"帧，
 *   item 就是唯一信号。若订阅后暂无变化，客户端**收不到任何字节**，只能靠超时判断，
 *   看起来像"流没开起来"。所以开流立刻推一帧 ready（带当前水位），
 *   客户端据此确认订阅生效、并按 seq 拉首次快照。
 * @param postbox - 业务服务
 * @param signal - carrier 取消信号
 * @returns 帧流
 */
async function* watchStream(
  postbox: PostboxService,
  signal: AbortSignal,
): AsyncIterable<DotPostboxWatchFrame> {
  /*
   * ⚠️【勿动顺序】先订阅、再发 ready、最后进循环。
   *   若把 subscribe 放在 `yield ready` 之后，async generator 在两次 next() 之间是
   *   挂起的——调用方拿到 ready 后、再调 next() 之前发生的业务变化**会被永久丢掉**
   *   （实测：本地帧序测试卡死 120s，因为 publish 落在订阅建立之前）。
   *   订阅先行才能保证"ready 之后的所有变化都进队列"。
   */
  const queue: DotPostboxWatchFrame[] = []
  let wake: (() => void) | undefined
  const unsubscribe = postbox.subscribe((frame) => {
    queue.push(frame)
    wake?.()
    wake = undefined
  })
  signal.addEventListener('abort', () => { wake?.(); wake = undefined }, { once: true })
  try {
    // 第一帧：开流确认 + 当前水位（客户端据此拉首次快照）。
    yield { type: 'ready', seq: postbox.status().seq, eventIds: [] }
    while (!signal.aborted) {
      const frame = queue.shift()
      if (frame !== undefined) { yield frame; continue }
      await new Promise<void>((resolve) => { wake = resolve })
    }
  } finally {
    // 创建者负责关闭：流结束（含取消）时立刻退订，防止监听器堆积。
    unsubscribe()
  }
}
