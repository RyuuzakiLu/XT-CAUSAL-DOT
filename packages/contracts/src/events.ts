/* ================================================================
   DOT 跨插件事件与服务键

   ▍这是什么
   插件之间用到的稳定字符串：Cordis 服务键、事件名、Remote 命名空间。
   集中一处，改一处全链一起改；散落各处就会一句话改漏一个消费者。

   ▍为什么要常量而不是随手写字面量
   服务键写错的表现是"插件一直等不到依赖"，而 Cordis 的失败是静默等待，
   不会报"你把名字拼错了"。把名字钉在这里，拼错在编译期就红。

   ▍修改铁律
   1. 【不】改已发布的服务键/命名空间；改名等于把消费者全断开。
   2. 事件名用 `<域>/<动词过去式>`；服务键用 camelCase 且与 owning 包职责一致。
   ================================================================ */

/** Cordis 服务键：工作领域（Host 侧事实所有者）。 */
export const DOT_WORK_SERVICE = 'dotWork' as const
/** Cordis 服务键：记忆适配（Host 侧，包住独立 XTMEM）。 */
export const DOT_MEMORY_SERVICE = 'dotMemory' as const
/** Cordis 服务键：星邮匣（Host 侧事件与投递记录所有者）。 */
export const DOT_POSTBOX_SERVICE = 'dotPostbox' as const

/** 工作快照变化事件：载荷为 WorkSnapshot。 */
export const DOT_WORK_CHANGED = 'dot-work/changed' as const
/** 星邮匣事件产生事件：载荷为 PostboxEvent。 */
export const DOT_POSTBOX_ADDED = 'dot-postbox/added' as const
/** 星邮匣事件更新（已读/归档/投递结果）：载荷为 PostboxEvent。 */
export const DOT_POSTBOX_UPDATED = 'dot-postbox/updated' as const

/** Remote 命名空间：与 Host 服务键同名，Client 侧通过 `ctx.remote.<ns>` 调用。 */
export const DOT_WORK_REMOTE_NS = 'dotWork' as const
export const DOT_POSTBOX_REMOTE_NS = 'dotPostbox' as const
export const DOT_MEMORY_REMOTE_NS = 'dotMemory' as const

/** 业务防重标识字段名：客户端重试时携带同一值，服务端据此不重复创建。 */
export const OPERATION_ID_FIELD = 'operationId' as const
