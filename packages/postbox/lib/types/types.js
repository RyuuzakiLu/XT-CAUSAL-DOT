/* ================================================================
   星邮匣 · 业务类型与记录 schema

   ▍这是什么
   事件的"人看/机器判定"字段、投递记录、免打扰偏好、操作台账，以及它们落库时的
   zod schema。类型给 TypeScript，schema 给 `ctx.storageDomain` 在打开域时校验。

   ▍为什么要两套（类型 + schema）
   domain 在 open 时会把每条存量记录过一遍 schema；只写类型等于把校验交给未来调用方，
   一条手改坏的文件就能让整个域打不开。schema 是那道门。
   —— 像小区门禁：门牌（类型）告诉你去哪户，门禁（schema）保证进门的人不是伪造的。

   ▍修改铁律
   1. 【不】删已有字段、不改字段语义；历史记录读不出来时整个域 open 会失败。
      要淘汰就保留字段并标 deprecated，等迁移脚本清完再删。
   2. 【不】把事件正文塞进投递记录或偏好（重复真相会打架）。
   3. 渠道取值域只增不减；新增渠道必须同时有 status 里的可用性说明，不许"能选不能用"。
   ================================================================ */
import { z } from 'zod';
/** 全部事件类别；用于校验与列表筛选。 */
export const POSTBOX_KINDS = [
    'work-completed', 'work-failed', 'work-blocked', 'work-waiting-approval', 'reminder', 'info',
];
/** 全部重要程度取值。 */
export const POSTBOX_SEVERITIES = ['normal', 'important', 'urgent'];
/** 全部渠道取值。 */
export const DELIVERY_CHANNELS = ['native', 'feishu', 'wechat'];
/** 默认偏好：免打扰关、渠道关（未配置不得假装已开）。 */
export const DEFAULT_PREFERENCES = {
    dnd: { enabled: false, startMinute: 22 * 60, endMinute: 7 * 60, timezone: 'Asia/Shanghai' },
    channels: { native: true, feishu: false },
    feishu: { enabled: false },
    native: { minIntervalMs: 0, maxAgeMs: 24 * 60 * 60 * 1000 },
};
/** 默认全局水位。 */
export const DEFAULT_GLOBAL = { seq: 0, preferences: DEFAULT_PREFERENCES };
/* ---------- zod 记录 schema（落库校验的唯一门） ---------- */
const severitySchema = z.enum(['normal', 'important', 'urgent']);
const kindSchema = z.enum([
    'work-completed', 'work-failed', 'work-blocked', 'work-waiting-approval', 'reminder', 'info',
]);
const channelSchema = z.enum(['native', 'feishu', 'wechat']);
const statusSchema = z.enum(['pending', 'sent', 'delivered', 'failed', 'suppressed']);
/** 事件记录 schema。 */
export const eventSchema = z.object({
    id: z.string().min(1),
    seq: z.number().int().nonnegative(),
    kind: kindSchema,
    severity: severitySchema,
    title: z.string().min(1),
    body: z.string().optional(),
    workId: z.string().optional(),
    sessionId: z.string().optional(),
    createdAt: z.number().nonnegative(),
    updatedAt: z.number().nonnegative(),
    read: z.boolean(),
    archived: z.boolean(),
    dueAt: z.number().nonnegative().optional(),
    expiresAt: z.number().nonnegative().optional(),
    origin: z.string().min(1),
    dedupeKey: z.string().min(1),
});
/** 投递记录 schema。 */
export const deliverySchema = z.object({
    eventId: z.string().min(1),
    channel: channelSchema,
    status: statusSchema,
    attempts: z.number().int().nonnegative(),
    updatedAt: z.number().nonnegative(),
    detail: z.string().optional(),
    externalId: z.string().optional(),
});
/** 操作台账 schema。 */
export const operationSchema = z.object({
    operationId: z.string().min(1),
    action: z.string().min(1),
    result: z.string(),
    at: z.number().nonnegative(),
});
/** 全局槽 schema（跨域共用一个水位与偏好）。 */
export const globalSchema = z.object({
    seq: z.number().int().nonnegative(),
    preferences: z.object({
        dnd: z.object({
            enabled: z.boolean(),
            startMinute: z.number().int().min(0).max(1439),
            endMinute: z.number().int().min(0).max(1439),
            timezone: z.string().min(1),
            until: z.number().finite().nonnegative().optional(),
            allowUrgent: z.boolean().optional(),
        }),
        events: z.object({ completed: z.boolean(), attention: z.boolean(), failed: z.boolean() }).optional(),
        channels: z.object({ native: z.boolean(), feishu: z.boolean() }),
        feishu: z.object({ enabled: z.boolean(), target: z.string().optional() }),
        native: z.object({
            minIntervalMs: z.number().int().nonnegative(),
            // ⚠️【勿删 default】旧版本写入的全局槽没有这个字段；不加 default 会让**整个域打不开**
            //    （domain open 会用 schema 校验存量记录，缺字段 = invalid-record）。
            //    默认 24h：关掉通知一整晚后不该被陈年旧信淹没。
            maxAgeMs: z.number().int().nonnegative().default(24 * 60 * 60 * 1000),
        }),
    }),
});
/** 投递记录在表里的键（同一事件同一渠道只允许一条）。 */
export function deliveryKey(eventId, channel) {
    return `${eventId}::${channel}`;
}
