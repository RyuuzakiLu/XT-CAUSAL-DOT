/* ================================================================
   星邮匣 · 插件入口

   ▍这是什么
   Cordis 插件入口：导出 name / inject / apply / Config。apply 只做组装——
   打开域、起服务、起 Remote owner、把服务挂到 ctx 上，然后登记清理。
   业务算法一律不在本文件。

   ▍为什么 apply 是 async
   打开 storage domain 是异步的（要读后端、校验存量记录）。Cordis 支持 async apply；
   不 await 就对外发布服务，会造出"服务在、数据没打开"的假就绪。
   —— 像开店：先把货上齐再拉卷帘门，不能门开了才去搬货。

   ▍修改铁律
   1. 【不】在模块顶层建单例/定时器/网络连接；一切交 apply + ctx.effect。
   2. 启动失败必须原样抛出（Cordis 会把插件标 FAILED），不许 catch 后冒充成功。
   3. 卸载只关自己的东西；用户数据（事件/投递）一律保留。
   4. 【不】在本文件里读密钥或拼 webhook 地址——那属于装配侧配置。
   ================================================================ */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { PostboxService } from './service.ts'
import { PostboxRemote } from './remote.ts'
import { createFeishuTransport, type OutboundTransport } from './transport.ts'

/** Loader 诊断里显示的名字。 */
export const name = 'dot-postbox'

/** 硬依赖：官方存储域是唯一持久化出口；typert 提供 Remote 注册面。 */
export const inject = ['storageDomain', 'typert']

/**
 * 插件配置。
 * ⚠️【勿动】三个字段声明为必填：schemastery 的 `.default()` 会在校验阶段补齐，
 *   所以 apply 拿到的对象一定有值。写成可选会让下游多出一堆 `| undefined`，
 *   逼着每个使用点再判一次"到底有没有默认值"，等于把默认值语义散到全包。
 */
export interface Config {
  /** 飞书 webhook 地址；留空=飞书渠道明确不可用（不假装发过）。 */
  readonly feishuWebhookUrl: string
  /** 列表默认条数。 */
  readonly defaultLimit: number
  /** 单次外部投递超时（毫秒）。 */
  readonly outboundTimeoutMs: number
}

/** 配置 schema（schemastery：官方插件配置形状）。 */
export const Config: z<Config> = z.object({
  feishuWebhookUrl: z.string().default(''),
  defaultLimit: z.natural().min(1).max(200).default(50),
  outboundTimeoutMs: z.natural().min(1000).max(60000).default(10000),
})

/** 服务键（供运行时/界面注入使用）。 */
export const POSTBOX_SERVICE_KEY = 'dotPostbox' as const

/*
 * 对外再导出：装配侧与测试只从包根拿东西，不直接摸 src/ 内部文件。
 * ⚠️ 这里的再导出是稳定面——增删都算接口变更，消费者会跟着坏。
 */
export { PostboxService, PostboxError } from './service.ts'
/*
 * ⚠️【勿删】必须从包入口静态导出 Remote owner 类。
 *   Typert 生成器靠静态分析入口类型图发现 `@Remote` 方法；只在 apply 里 ctx.plugin 动态挂载，
 *   生成器看不到类 ⇒ `./remote` 产物缺方法 ⇒ Client 的 ctx.remote.dotPostbox.* 落空。
 */
export { PostboxRemote } from './remote.ts'
export type {
  DotPostboxGetRequest, DotPostboxIdCommandRequest, DotPostboxListRequest, DotPostboxListValue,
  DotPostboxPendingRequest, DotPostboxPendingValue, DotPostboxPreferencesValue,
  DotPostboxReceiptRequest, DotPostboxRetryRequest, DotPostboxSetPreferencesRequest,
  DotPostboxStatusValue, DotPostboxWatchFrame,
} from './types.ts'
export type {
  ListQuery, ListResult, PendingResult, PublishInput, PostboxServiceConfig, PostboxStatus,
  PostboxWatchFrame,
} from './service.ts'
export { createFeishuTransport, wechatUnavailableReason } from './transport.ts'
export type { OutboundTransport, TransportResult, FeishuTransportConfig } from './transport.ts'
export {
  defaultSeverityOf, eventIdOf, inDndWindow, isExpired, minuteOfDay, needsAttention,
  respectsMinInterval, suppressionOf, visibleInList,
} from './rules.ts'
export { POSTBOX_DOMAIN } from './domain.ts'
export type {
  DeliveryChannel, DeliveryRecord, DeliveryStatus, DndWindow, OperationRecord, PostboxEvent,
  PostboxEventView, PostboxGlobal, PostboxKind, PostboxPreferences, PostboxSeverity,
} from './types.ts'
/* Remote 边界类型同样从 ./types 出口再导出一次，便于装配侧从包根取；
   生成器认的是 `./types` 子路径本身，这里只是给人用。 */
export { DELIVERY_CHANNELS, POSTBOX_KINDS, POSTBOX_SEVERITIES, DEFAULT_PREFERENCES } from './types.ts'

/**
 * 装配星邮匣。
 * @param ctx - Host 上下文
 * @param config - 插件配置（已由 schemastery 补齐默认值）
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const feishu: OutboundTransport | undefined = config.feishuWebhookUrl !== ''
    ? createFeishuTransport({ webhookUrl: config.feishuWebhookUrl, timeoutMs: config.outboundTimeoutMs })
    : undefined
  const service = await PostboxService.open(ctx, {
    ...(feishu === undefined ? {} : { feishu }),
    defaultLimit: config.defaultLimit,
  })
  // 先登记清理，再发布服务：即使后续装配失败，域也会被关掉，不泄漏句柄。
  ctx.effect(() => () => service.close(), 'dot-postbox: 关闭存储域')
  ctx.effect(() => ctx.reflect.provide(POSTBOX_SERVICE_KEY, service), 'dot-postbox: 服务注册')
  // Remote owner 自己管理自己的 Cordis 生命周期（Service 会在卸载时撤销）。
  ctx.plugin(PostboxRemote, service)
}
