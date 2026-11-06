import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
/** Loader 诊断里显示的名字。 */
export declare const name = "dot-postbox";
/** 硬依赖：官方存储域是唯一持久化出口；typert 提供 Remote 注册面。 */
export declare const inject: string[];
/**
 * 插件配置。
 * ⚠️【勿动】三个字段声明为必填：schemastery 的 `.default()` 会在校验阶段补齐，
 *   所以 apply 拿到的对象一定有值。写成可选会让下游多出一堆 `| undefined`，
 *   逼着每个使用点再判一次"到底有没有默认值"，等于把默认值语义散到全包。
 */
export interface Config {
    /** 飞书 webhook 地址；留空=飞书渠道明确不可用（不假装发过）。 */
    readonly feishuWebhookUrl: string;
    /** 列表默认条数。 */
    readonly defaultLimit: number;
    /** 单次外部投递超时（毫秒）。 */
    readonly outboundTimeoutMs: number;
}
/** 配置 schema（schemastery：官方插件配置形状）。 */
export declare const Config: z<Config>;
/** 服务键（供运行时/界面注入使用）。 */
export declare const POSTBOX_SERVICE_KEY: "dotPostbox";
export { PostboxService, PostboxError } from './service.ts';
export { PostboxRemote } from './remote.ts';
export type { DotPostboxGetRequest, DotPostboxIdCommandRequest, DotPostboxListRequest, DotPostboxListValue, DotPostboxPendingRequest, DotPostboxPendingValue, DotPostboxPreferencesValue, DotPostboxReceiptRequest, DotPostboxRetryRequest, DotPostboxSetPreferencesRequest, DotPostboxStatusValue, DotPostboxWatchFrame, } from './types.ts';
export type { ListQuery, ListResult, PendingResult, PublishInput, PostboxServiceConfig, PostboxStatus, PostboxWatchFrame, } from './service.ts';
export { createFeishuTransport, wechatUnavailableReason } from './transport.ts';
export type { OutboundTransport, TransportResult, FeishuTransportConfig } from './transport.ts';
export { defaultSeverityOf, eventIdOf, inDndWindow, isExpired, minuteOfDay, needsAttention, respectsMinInterval, suppressionOf, visibleInList, } from './rules.ts';
export { POSTBOX_DOMAIN } from './domain.ts';
export type { DeliveryChannel, DeliveryRecord, DeliveryStatus, DndWindow, OperationRecord, PostboxEvent, PostboxEventView, PostboxGlobal, PostboxKind, PostboxPreferences, PostboxSeverity, } from './types.ts';
export { DELIVERY_CHANNELS, POSTBOX_KINDS, POSTBOX_SEVERITIES, DEFAULT_PREFERENCES } from './types.ts';
/**
 * 装配星邮匣。
 * @param ctx - Host 上下文
 * @param config - 插件配置（已由 schemastery 补齐默认值）
 */
export declare function apply(ctx: Context, config: Config): Promise<void>;
