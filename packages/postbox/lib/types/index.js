import z from '@deepseek-ai/schemastery';
import { PostboxService } from "./service.js";
import { PostboxRemote } from "./remote.js";
import { createFeishuTransport } from "./transport.js";
/** Loader 诊断里显示的名字。 */
export const name = 'dot-postbox';
/** 硬依赖：官方存储域是唯一持久化出口；typert 提供 Remote 注册面。 */
export const inject = ['storageDomain', 'typert'];
/** 配置 schema（schemastery：官方插件配置形状）。 */
export const Config = z.object({
    feishuWebhookUrl: z.string().default(''),
    defaultLimit: z.natural().min(1).max(200).default(50),
    outboundTimeoutMs: z.natural().min(1000).max(60000).default(10000),
});
/** 服务键（供运行时/界面注入使用）。 */
export const POSTBOX_SERVICE_KEY = 'dotPostbox';
/*
 * 对外再导出：装配侧与测试只从包根拿东西，不直接摸 src/ 内部文件。
 * ⚠️ 这里的再导出是稳定面——增删都算接口变更，消费者会跟着坏。
 */
export { PostboxService, PostboxError } from "./service.js";
/*
 * ⚠️【勿删】必须从包入口静态导出 Remote owner 类。
 *   Typert 生成器靠静态分析入口类型图发现 `@Remote` 方法；只在 apply 里 ctx.plugin 动态挂载，
 *   生成器看不到类 ⇒ `./remote` 产物缺方法 ⇒ Client 的 ctx.remote.dotPostbox.* 落空。
 */
export { PostboxRemote } from "./remote.js";
export { createFeishuTransport, wechatUnavailableReason } from "./transport.js";
export { defaultSeverityOf, eventIdOf, inDndWindow, isExpired, minuteOfDay, needsAttention, respectsMinInterval, suppressionOf, visibleInList, } from "./rules.js";
export { POSTBOX_DOMAIN } from "./domain.js";
/* Remote 边界类型同样从 ./types 出口再导出一次，便于装配侧从包根取；
   生成器认的是 `./types` 子路径本身，这里只是给人用。 */
export { DELIVERY_CHANNELS, POSTBOX_KINDS, POSTBOX_SEVERITIES, DEFAULT_PREFERENCES } from "./types.js";
/**
 * 装配星邮匣。
 * @param ctx - Host 上下文
 * @param config - 插件配置（已由 schemastery 补齐默认值）
 */
export async function apply(ctx, config) {
    const feishu = config.feishuWebhookUrl !== ''
        ? createFeishuTransport({ webhookUrl: config.feishuWebhookUrl, timeoutMs: config.outboundTimeoutMs })
        : undefined;
    const service = await PostboxService.open(ctx, {
        ...(feishu === undefined ? {} : { feishu }),
        defaultLimit: config.defaultLimit,
    });
    // 先登记清理，再发布服务：即使后续装配失败，域也会被关掉，不泄漏句柄。
    ctx.effect(() => () => service.close(), 'dot-postbox: 关闭存储域');
    ctx.effect(() => ctx.reflect.provide(POSTBOX_SERVICE_KEY, service), 'dot-postbox: 服务注册');
    // Remote owner 自己管理自己的 Cordis 生命周期（Service 会在卸载时撤销）。
    ctx.plugin(PostboxRemote, service);
}
