//#region src/ids.ts
/** 仍在推进的状态集合——界面用它决定要不要继续订阅。 */
const ACTIVE_WORK_STATUSES = [
	"queued",
	"running",
	"waiting-input",
	"waiting-approval"
];
/** 终态集合——到达后不再有新的阶段变化。 */
const TERMINAL_WORK_STATUSES = [
	"succeeded",
	"failed",
	"cancelled",
	"interrupted"
];
/**
* 判断一个状态是否仍在推进。
* 为什么单独成函数：界面和通知都要用同一条判定，分散写 `status === 'running'`
* 会漏掉 waiting-input 这类"还没完但不动"的状态。
* @param status - 工作状态
* @returns 仍在推进时为 true
*/
function isActiveWork(status) {
	return ACTIVE_WORK_STATUSES.includes(status);
}
/**
* 把线路/界面来的裸字符串标记成工作 ID。
*
* ▍为什么需要这个函数
* 品牌类型在编译期防止"工作 ID 和成果 ID 互串"，但跨越真实边界（解析后的 JSON、
* 界面列表项、用户输入）时，它就是字符串。边界处显式收口一次，比在调用点撒
* `as WorkId` 安全：类型系统能保证只有经过这个函数的值才被当作 ID，
* 而散落的 `as` 会让编译器彻底失去这条线索。
* @param value - 来自线路或界面的字符串 ID
* @returns 同一字符串，带工作 ID 品牌
*/
function workId(value) {
	return value;
}
/**
* 把裸字符串标记成成果 ID。
* @param value - 来自线路或界面的字符串 ID
* @returns 同一字符串，带成果 ID 品牌
*/
function artifactId(value) {
	return value;
}
/**
* 把裸字符串标记成星邮匣事件 ID。
* @param value - 来自线路或界面的字符串 ID
* @returns 同一字符串，带事件 ID 品牌
*/
function postboxEventId(value) {
	return value;
}
//#endregion
//#region src/work.ts
/**
* 把快照压成列表项。
* 为什么放在契约里：工作空间、临时卡、精灵提示都要同一份投影，
* 各写一遍就会出现"列表说完成了卡片说执行中"。
* @param snapshot - 完整快照
* @returns 列表项
*/
function summarizeWork(snapshot) {
	return {
		id: snapshot.id,
		goal: snapshot.goal,
		status: snapshot.status,
		stage: snapshot.stage,
		updatedAt: snapshot.updatedAt,
		artifactCount: snapshot.artifacts.length
	};
}
//#endregion
//#region src/postbox.ts
/**
* 一条事件是否该在“有新信件”提示里出现。
* 为什么成函数：书房信件入口、精灵气泡、系统通知都要同一条判定，
* 否则会出现"信已读但气泡还在"这类自相矛盾的显示。
* @param event - 事件
* @returns 未读且未归档时为 true
*/
function isUnreadLetter(event) {
	return !event.read && !event.archived;
}
//#endregion
//#region src/events.ts
/** Cordis 服务键：工作领域（Host 侧事实所有者）。 */
const DOT_WORK_SERVICE = "dotWork";
/** Cordis 服务键：记忆适配（Host 侧，包住独立 XTMEM）。 */
const DOT_MEMORY_SERVICE = "dotMemory";
/** Cordis 服务键：星邮匣（Host 侧事件与投递记录所有者）。 */
const DOT_POSTBOX_SERVICE = "dotPostbox";
/** 工作快照变化事件：载荷为 WorkSnapshot。 */
const DOT_WORK_CHANGED = "dot-work/changed";
/** 星邮匣事件产生事件：载荷为 PostboxEvent。 */
const DOT_POSTBOX_ADDED = "dot-postbox/added";
/** 星邮匣事件更新（已读/归档/投递结果）：载荷为 PostboxEvent。 */
const DOT_POSTBOX_UPDATED = "dot-postbox/updated";
/** Remote 命名空间：与 Host 服务键同名，Client 侧通过 `ctx.remote.<ns>` 调用。 */
const DOT_WORK_REMOTE_NS = "dotWork";
const DOT_POSTBOX_REMOTE_NS = "dotPostbox";
const DOT_MEMORY_REMOTE_NS = "dotMemory";
/** 业务防重标识字段名：客户端重试时携带同一值，服务端据此不重复创建。 */
const OPERATION_ID_FIELD = "operationId";
//#endregion
export { ACTIVE_WORK_STATUSES, DOT_MEMORY_REMOTE_NS, DOT_MEMORY_SERVICE, DOT_POSTBOX_ADDED, DOT_POSTBOX_REMOTE_NS, DOT_POSTBOX_SERVICE, DOT_POSTBOX_UPDATED, DOT_WORK_CHANGED, DOT_WORK_REMOTE_NS, DOT_WORK_SERVICE, OPERATION_ID_FIELD, TERMINAL_WORK_STATUSES, artifactId, isActiveWork, isUnreadLetter, postboxEventId, summarizeWork, workId };
