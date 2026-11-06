/* ================================================================
   DOT 记忆 · Remote 门面（wire namespace = `dotMemory`）

   ▍这是什么
   把 MemoryService 暴露给 Client（WebView / Android / PC）。服务继承 `TypertRemoteService`，
   namespace 与 Cordis 服务键一起绑定。

   ▍为什么请求对象里没有 namespace / cross / 库路径
   身份、默认域、库路径都由插件配置给定；模型/前端能传就等于能读别人的私有记忆、
   能连生产库。这是硬边界（SPEC F09、约定 §7「普通工具不让模型任意选数据库路径或跨域」）。
   —— 前台窗口只收"查什么/记什么/改哪条/删哪条"，不能填"帮我打开哪个档案柜"。

   ▍修改铁律
   1. 【不】给任何请求类型加 namespace / cross / dbPath / actor 字段。
   2. 失败统一抛 RemoteError('memory/xxx')，由 Gateway 编码上 wire；不自定义外壳。
   3. 删除默认只预览（confirmed 缺省）；真删必须显式 confirmed:true。
   4. 状态如实报不可用（引擎缺失/库不可写），不假成功。
   ================================================================ */
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import { MemoryEngineError } from './engine.ts'
import type { MemoryService } from './service.ts'
/* ⚠️ Remote 边界类型必须来自 `./types.ts`（包暴露为 `./types` 子路径）：
   写在 remote.ts 里只有包根可见，Typert 生成器会拒绝生成 `./remote` 产物。 */
import type {
  MemoryCorrectRequest, MemoryCorrectValue, MemoryForgetRequest, MemoryForgetValue,
  MemoryGetRequest, MemoryGetValue, MemoryHit, MemoryListRequest, MemoryListValue,
  MemorySearchRequest, MemorySearchValue, MemoryStatusValue, MemoryStoreRequest,
  MemoryStoreValue, MemoryWatchFrame,
} from './types.ts'

/* 失败码合并进官方码表。 */
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** 引擎不可用（缺 CLI、缺引擎目录、Python 起不来）。 */
    'memory/engine-unavailable': { readonly reason: string }
    /** 引擎执行失败或输出无法解析。 */
    'memory/engine-failed': { readonly reason: string }
    /** 引擎超时。 */
    'memory/engine-timeout': { readonly reason: string }
    /** 引擎明确拒绝（重复内容、跨域纠正、旧条目不存在等）。 */
    'memory/rejected': { readonly reason: string }
  }
}

/** 把引擎异常折成官方 Remote 失败。 */
function asRemoteFailure(error: unknown): never {
  if (error instanceof MemoryEngineError) {
    throw new RemoteError(error.code, error.message, { reason: error.message })
  }
  const message = error instanceof Error ? error.message : String(error)
  throw new RemoteError('memory/engine-failed', message, { reason: message })
}

/**
 * 记忆 Remote owner。
 */
export class MemoryRemote extends TypertRemoteService {
  /**
   * ⚠️【勿动】Cordis 服务键必须是 `dotMemoryRemote`，**不能**与业务服务键 `dotMemory` 相同：
   *   同一个键注册两次会在装配时抛 `service "dotMemory" has been registered`。
   *   官方惯例同款：JobController 服务键 `jobController` / wire namespace `job`。
   */
  constructor(ctx: Context, private readonly service: MemoryService) {
    super(ctx, 'dotMemoryRemote', { namespace: 'dotMemory' })
  }

  /** 语义检索。 */
  @Remote('search')
  async remoteExportSearch(request: MemorySearchRequest): Promise<MemorySearchValue> {
    try {
      const result = await this.service.search(request.query, {
        ...(request.top === undefined ? {} : { top: request.top }),
        ...(request.project === undefined ? {} : { project: request.project }),
      })
      return {
        ok: true,
        query: request.query,
        count: result.hits.length,
        hits: result.hits,
        mode: result.mode,
        ...(result.verdict === undefined ? {} : { verdict: result.verdict }),
      }
    } catch (error: unknown) { return asRemoteFailure(error) }
  }

  /** 保存。 */
  @Remote('store')
  async remoteExportStore(request: MemoryStoreRequest): Promise<MemoryStoreValue> {
    try {
      const result = await this.service.store({
        text: request.text,
        operationId: request.operationId,
        ...(request.project === undefined ? {} : { project: request.project }),
        ...(request.importance === undefined ? {} : { importance: request.importance }),
        ...(request.tags === undefined ? {} : { tags: request.tags }),
      })
      return {
        ok: result.action !== 'rejected',
        ...(result.id === undefined ? {} : { id: result.id }),
        action: result.action,
        namespace: this.service.namespace,
        ...(result.reason === undefined ? {} : { reason: result.reason }),
      }
    } catch (error: unknown) { return asRemoteFailure(error) }
  }

  /** 纠正（新条目 + 旧条目退役）。 */
  @Remote('correct')
  async remoteExportCorrect(request: MemoryCorrectRequest): Promise<MemoryCorrectValue> {
    try {
      const result = await this.service.correct({
        id: request.id,
        text: request.text,
        operationId: request.operationId,
        ...(request.reason === undefined ? {} : { reason: request.reason }),
      })
      return { ok: true, id: result.id, supersededId: result.supersededId, action: result.action }
    } catch (error: unknown) { return asRemoteFailure(error) }
  }

  /** 删除（默认只预览）。 */
  @Remote('forget')
  async remoteExportForget(request: MemoryForgetRequest): Promise<MemoryForgetValue> {
    try {
      const confirmed = request.confirmed === true
      const result = await this.service.forget({ id: request.id, confirmed })
      return {
        ok: true,
        confirmed,
        removed: result.removed,
        ...(result.pending === undefined ? {} : { pending: result.pending }),
        ...(result.preview === undefined ? {} : { preview: result.preview }),
        ...(result.tombstoneRegistered === undefined ? {} : { tombstoneRegistered: result.tombstoneRegistered }),
      }
    } catch (error: unknown) { return asRemoteFailure(error) }
  }

  /** 单条读取。 */
  @Remote('get')
  async remoteExportGet(request: MemoryGetRequest): Promise<MemoryGetValue> {
    try {
      const hit = await this.service.get(request.id)
      return hit === undefined ? { ok: false } : { ok: true, hit }
    } catch (error: unknown) { return asRemoteFailure(error) }
  }

  /** 列表（无 query = 按重要度/时间列最近）。 */
  @Remote('list')
  async remoteExportList(request: MemoryListRequest): Promise<MemoryListValue> {
    try {
      const hits: readonly MemoryHit[] = await this.service.list({
        ...(request.query === undefined ? {} : { query: request.query }),
        ...(request.limit === undefined ? {} : { limit: request.limit }),
        ...(request.project === undefined ? {} : { project: request.project }),
      })
      return { ok: true, count: hits.length, hits }
    } catch (error: unknown) { return asRemoteFailure(error) }
  }

  /** 能力状态（缺配置如实不可用）。 */
  @Remote('status')
  async remoteExportStatus(): Promise<MemoryStatusValue> {
    const status = await this.service.status()
    return {
      available: status.available,
      engine: 'xtmem',
      actor: status.actor,
      namespace: status.namespace,
      dbIsolated: true,
      ...(status.reason === undefined ? {} : { reason: status.reason }),
      ...(status.engineVersion === undefined ? {} : { engineVersion: status.engineVersion }),
    }
  }

  /** 变化流：界面订阅后重取快照。 */
  /* ⚠️ 显式给导出名 'watch'：不带 name 时 endpoint 会回落成 `remoteExportWatch`。 */
  @Remote({ name: 'watch', mode: 'stream' })
  remoteExportWatch(signal: AbortSignal): AsyncIterable<MemoryWatchFrame> {
    return watchStream(this.service, signal)
  }
}

/**
 * 把服务订阅桥成 AsyncIterable（与 postbox 同款；创建者负责退订）。
 * @param service - 记忆服务
 * @param signal - carrier 取消信号
 * @returns 帧流
 */
async function* watchStream(service: MemoryService, signal: AbortSignal): AsyncIterable<MemoryWatchFrame> {
  /*
   * ⚠️【勿动顺序】先订阅、再发 ready、最后进循环。
   *   async generator 在两次 next() 之间挂起；若先 yield ready 再 subscribe，
   *   调用方拿到 ready 之后、再调 next() 之前的变化会被永久丢掉（实测卡死）。
   */
  const queue: MemoryWatchFrame[] = []
  let wake: (() => void) | undefined
  const unsubscribe = service.subscribe((frame) => {
    queue.push(frame)
    wake?.()
    wake = undefined
  })
  signal.addEventListener('abort', () => { wake?.(); wake = undefined }, { once: true })
  try {
    // 第一帧：开流确认。官方流协议没有开流确认帧，客户端靠它确认订阅生效。
    yield { type: 'ready' }
    while (!signal.aborted) {
      const frame = queue.shift()
      if (frame !== undefined) { yield frame; continue }
      await new Promise<void>((resolve) => { wake = resolve })
    }
  } finally {
    unsubscribe()
  }
}
