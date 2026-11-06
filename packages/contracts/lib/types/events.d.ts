/** Cordis 服务键：工作领域（Host 侧事实所有者）。 */
export declare const DOT_WORK_SERVICE: "dotWork";
/** Cordis 服务键：记忆适配（Host 侧，包住独立 XTMEM）。 */
export declare const DOT_MEMORY_SERVICE: "dotMemory";
/** Cordis 服务键：星邮匣（Host 侧事件与投递记录所有者）。 */
export declare const DOT_POSTBOX_SERVICE: "dotPostbox";
/** 工作快照变化事件：载荷为 WorkSnapshot。 */
export declare const DOT_WORK_CHANGED: "dot-work/changed";
/** 星邮匣事件产生事件：载荷为 PostboxEvent。 */
export declare const DOT_POSTBOX_ADDED: "dot-postbox/added";
/** 星邮匣事件更新（已读/归档/投递结果）：载荷为 PostboxEvent。 */
export declare const DOT_POSTBOX_UPDATED: "dot-postbox/updated";
/** Remote 命名空间：与 Host 服务键同名，Client 侧通过 `ctx.remote.<ns>` 调用。 */
export declare const DOT_WORK_REMOTE_NS: "dotWork";
export declare const DOT_POSTBOX_REMOTE_NS: "dotPostbox";
export declare const DOT_MEMORY_REMOTE_NS: "dotMemory";
/** 业务防重标识字段名：客户端重试时携带同一值，服务端据此不重复创建。 */
export declare const OPERATION_ID_FIELD: "operationId";
