import z from "@deepseek-ai/schemastery";
import { z as z$1 } from "zod";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { Remote, RemoteError, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
//#region lib/types/transport.js
/**
* 构造飞书适配器。
* 未配置 webhook 时 available() 恒 false，send() 明确拒绝——不假装发过。
* @param config - 配置
* @returns 适配器实例
*/
function createFeishuTransport(config) {
	const url = typeof config.webhookUrl === "string" ? config.webhookUrl.trim() : "";
	const doFetch = config.fetch ?? (typeof fetch === "function" ? fetch : void 0);
	const timeoutMs = config.timeoutMs ?? 1e4;
	return {
		channel: "feishu",
		available: () => url.length > 0 && doFetch !== void 0,
		unavailableReason: () => url.length === 0 ? "未配置飞书 webhook 地址" : doFetch === void 0 ? "运行时没有可用的 fetch" : void 0,
		async send(message) {
			if (url.length === 0) return {
				ok: false,
				error: "未配置飞书 webhook 地址"
			};
			if (doFetch === void 0) return {
				ok: false,
				error: "运行时没有可用的 fetch"
			};
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeoutMs);
			try {
				const response = await doFetch(url, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						msg_type: "text",
						content: { text: `${message.title}\n${message.body}`.slice(0, 3500) }
					}),
					signal: controller.signal
				});
				if (!response.ok) return {
					ok: false,
					uncertain: response.status >= 500 || response.status === 408,
					error: `HTTP ${response.status}`
				};
				const payload = await response.json().catch(() => void 0);
				const code = payload?.code ?? payload?.StatusCode;
				if (typeof code !== "number") return {
					ok: false,
					uncertain: true,
					error: "渠道未返回确认码"
				};
				if (code !== 0) return {
					ok: false,
					error: `飞书返回 code=${code} ${payload?.msg ?? payload?.StatusMessage ?? ""}`.trim()
				};
				return { ok: true };
			} catch {
				return {
					ok: false,
					uncertain: true,
					error: controller.signal.aborted ? "请求超时" : "未收到渠道回执"
				};
			} finally {
				clearTimeout(timer);
			}
		}
	};
}
/** 微信状态：本包不提供实现，如实报告不可用。 */
function wechatUnavailableReason() {
	return "未接入微信通道（本人当前没有可用且已授权的接入），按设计明确不可用";
}
//#endregion
//#region lib/types/types.js
/** 全部事件类别；用于校验与列表筛选。 */
const POSTBOX_KINDS = [
	"work-completed",
	"work-failed",
	"work-blocked",
	"work-waiting-approval",
	"reminder",
	"info"
];
/** 全部重要程度取值。 */
const POSTBOX_SEVERITIES = [
	"normal",
	"important",
	"urgent"
];
/** 全部渠道取值。 */
const DELIVERY_CHANNELS = [
	"native",
	"feishu",
	"wechat"
];
/** 默认偏好：免打扰关、渠道关（未配置不得假装已开）。 */
const DEFAULT_PREFERENCES = {
	dnd: {
		enabled: false,
		startMinute: 1320,
		endMinute: 420,
		timezone: "Asia/Shanghai"
	},
	channels: {
		native: true,
		feishu: false
	},
	feishu: { enabled: false },
	native: {
		minIntervalMs: 0,
		maxAgeMs: 1440 * 60 * 1e3
	}
};
/** 默认全局水位。 */
const DEFAULT_GLOBAL = {
	seq: 0,
	preferences: DEFAULT_PREFERENCES
};
const severitySchema = z$1.enum([
	"normal",
	"important",
	"urgent"
]);
const kindSchema = z$1.enum([
	"work-completed",
	"work-failed",
	"work-blocked",
	"work-waiting-approval",
	"reminder",
	"info"
]);
const channelSchema = z$1.enum([
	"native",
	"feishu",
	"wechat"
]);
const statusSchema = z$1.enum([
	"pending",
	"sent",
	"delivered",
	"failed",
	"suppressed"
]);
/** 事件记录 schema。 */
const eventSchema = z$1.object({
	id: z$1.string().min(1),
	seq: z$1.number().int().nonnegative(),
	kind: kindSchema,
	severity: severitySchema,
	title: z$1.string().min(1),
	body: z$1.string().optional(),
	workId: z$1.string().optional(),
	sessionId: z$1.string().optional(),
	createdAt: z$1.number().nonnegative(),
	updatedAt: z$1.number().nonnegative(),
	read: z$1.boolean(),
	archived: z$1.boolean(),
	dueAt: z$1.number().nonnegative().optional(),
	expiresAt: z$1.number().nonnegative().optional(),
	origin: z$1.string().min(1),
	dedupeKey: z$1.string().min(1)
});
/** 投递记录 schema。 */
const deliverySchema = z$1.object({
	eventId: z$1.string().min(1),
	channel: channelSchema,
	status: statusSchema,
	attempts: z$1.number().int().nonnegative(),
	updatedAt: z$1.number().nonnegative(),
	detail: z$1.string().optional(),
	externalId: z$1.string().optional()
});
/** 操作台账 schema。 */
const operationSchema = z$1.object({
	operationId: z$1.string().min(1),
	action: z$1.string().min(1),
	result: z$1.string(),
	at: z$1.number().nonnegative()
});
/** 全局槽 schema（跨域共用一个水位与偏好）。 */
const globalSchema = z$1.object({
	seq: z$1.number().int().nonnegative(),
	preferences: z$1.object({
		dnd: z$1.object({
			enabled: z$1.boolean(),
			startMinute: z$1.number().int().min(0).max(1439),
			endMinute: z$1.number().int().min(0).max(1439),
			timezone: z$1.string().min(1),
			until: z$1.number().finite().nonnegative().optional(),
			allowUrgent: z$1.boolean().optional()
		}),
		events: z$1.object({
			completed: z$1.boolean(),
			attention: z$1.boolean(),
			failed: z$1.boolean()
		}).optional(),
		channels: z$1.object({
			native: z$1.boolean(),
			feishu: z$1.boolean()
		}),
		feishu: z$1.object({
			enabled: z$1.boolean(),
			target: z$1.string().optional()
		}),
		native: z$1.object({
			minIntervalMs: z$1.number().int().nonnegative(),
			maxAgeMs: z$1.number().int().nonnegative().default(1440 * 60 * 1e3)
		})
	})
});
/** 投递记录在表里的键（同一事件同一渠道只允许一条）。 */
function deliveryKey(eventId, channel) {
	return `${eventId}::${channel}`;
}
//#endregion
//#region lib/types/domain.js
/** 星邮匣域：名固定 `dot_postbox`（UNIT_NAME_RE 要求小写字母开头、仅小写/数字/下划线）。 */
const POSTBOX_DOMAIN = defineDomain({
	name: "dot_postbox",
	version: 1,
	tables: {
		/** 事件主表：键是事件 id。 */
		events: domainTable(eventSchema),
		/** 投递表：键是 `eventId::channel`，同一事件同一渠道只有一条。 */
		deliveries: domainTable(deliverySchema),
		/** 操作台账：键是 operationId，重放同一 operationId 直接取首次结果。 */
		ops: domainTable(operationSchema)
	},
	global: {
		schema: globalSchema,
		initial: DEFAULT_GLOBAL
	}
});
//#endregion
//#region lib/types/rules.js
/** 事件类别的默认重要程度。 */
function defaultSeverityOf(kind) {
	switch (kind) {
		case "work-failed": return "urgent";
		case "work-blocked":
		case "work-waiting-approval": return "important";
		case "work-completed":
		case "reminder":
		case "info": return "normal";
		default: return "normal";
	}
}
/** 该类别是否需要用户介入（决定是否"值得打断"）。 */
function needsAttention(kind) {
	return kind === "work-failed" || kind === "work-blocked" || kind === "work-waiting-approval";
}
/**
* 判断某一时刻是否落在免打扰窗口内。
* 为什么不用 Date#getHours：窗口自带 IANA 时区，服务器可能跑在别的时区上。
* @param dnd - 免打扰窗口
* @param at - 毫秒时间戳
* @returns 在窗口内为 true（窗口关闭时恒 false）
*/
function inDndWindow(dnd, at) {
	if (!dnd.enabled) return false;
	if (dnd.until !== void 0) return at < dnd.until;
	const minutes = minuteOfDay(dnd.timezone, at);
	if (minutes === void 0) return false;
	if (dnd.startMinute === dnd.endMinute) return false;
	if (dnd.startMinute < dnd.endMinute) return minutes >= dnd.startMinute && minutes < dnd.endMinute;
	return minutes >= dnd.startMinute || minutes < dnd.endMinute;
}
/**
* 取某时区下"当天第几分钟"。
* 时区名非法时返回 undefined（调用方按"不在窗口内"处理，不抛——一条坏偏好
* 不该让整条通知链崩掉）。
* @param timezone - IANA 时区名
* @param at - 毫秒时间戳
* @returns 0..1439，或 undefined
*/
function minuteOfDay(timezone, at) {
	try {
		const parts = new Intl.DateTimeFormat("en-US", {
			timeZone: timezone,
			hour: "2-digit",
			minute: "2-digit",
			hour12: false
		}).formatToParts(new Date(at));
		const hour = Number(parts.find((part) => part.type === "hour")?.value);
		const minute = Number(parts.find((part) => part.type === "minute")?.value);
		if (!Number.isFinite(hour) || !Number.isFinite(minute)) return void 0;
		return hour % 24 * 60 + minute;
	} catch {
		return;
	}
}
/** 事件是否已过期（只影响主动弹出与默认列表，不影响是否可查）。 */
function isExpired(event, at) {
	if (event.expiresAt !== void 0 && at >= event.expiresAt) return true;
	if (event.dueAt !== void 0 && at >= event.dueAt && event.kind === "reminder") return true;
	return false;
}
/**
* 某渠道此刻应当投递还是抑制。
* 抑制不是失败：免打扰/渠道关闭都记 suppressed，便于事后解释"为什么没弹"。
* @param event - 事件
* @param channel - 渠道
* @param preferences - 当前偏好
* @param at - 毫秒时间戳
* @returns 抑制原因；可投递时返回 undefined
*/
function suppressionOf(event, channel, preferences, at) {
	if (event.archived) return "archived";
	if (channel === "native" && !preferences.channels.native) return "channel-disabled";
	if (channel === "feishu" && (!preferences.channels.feishu || !preferences.feishu.enabled)) return "channel-disabled";
	if (channel === "wechat") return "channel-unavailable";
	const category = event.kind === "work-completed" ? "completed" : event.kind === "work-failed" ? "failed" : event.kind === "work-blocked" || event.kind === "work-waiting-approval" ? "attention" : void 0;
	if (category && preferences.events?.[category] === false) return "event-disabled";
	if ((event.severity !== "urgent" || preferences.dnd.allowUrgent === false) && inDndWindow(preferences.dnd, at)) return "do-not-disturb";
	if (isExpired(event, at)) return "expired";
}
/**
* 计算"下一次可投递时间"的最小间隔是否已过（防刷屏）。
* @param lastAt - 同一渠道上次成功投递时间；可空
* @param minIntervalMs - 最小间隔
* @param at - 当前时间
* @returns 允许投递时为 true
*/
function respectsMinInterval(lastAt, minIntervalMs, at) {
	if (lastAt === void 0 || minIntervalMs <= 0) return true;
	return at - lastAt >= minIntervalMs;
}
/**
* 生成事件 id。
* 为什么不用随机数：可读、可排序、能一眼看出是邮匣产生；同 input 可复现，便于测试。
* @param seq - 该事件的序号（全局单调递增，天然唯一）
* @returns `postbox-<seq>` 形态的稳定 id
*/
function eventIdOf(seq) {
	return `postbox-${String(seq).padStart(6, "0")}`;
}
/** 一条事件是否在默认列表中可见（归档/过期不算失败，只是不默认显示）。 */
function visibleInList(event, at, includeArchived) {
	if (!includeArchived && event.archived) return false;
	if (event.expiresAt !== void 0 && at >= event.expiresAt) return false;
	return true;
}
//#endregion
//#region lib/types/service.js
/** 域失败：由 Remote 层折成稳定错误码，不用自由文本给界面判断。 */
var PostboxError = class extends Error {
	code;
	/**
	* 出错对象（事件 id 等）。Remote 层用它填 `details`。
	* ⚠️【不】让 Remote 层自己猜 id：猜出来的 details 会指向别的对象，
	*   界面按 details 去定位时就会打开错误的信（真发生过的坑）。
	*/
	subjectId;
	constructor(code, message, subjectId) {
		super(message);
		this.name = "PostboxError";
		this.code = code;
		this.subjectId = subjectId;
	}
};
/**
* 星邮匣服务：事件与投递记录的唯一所有者。
*/
var PostboxService = class PostboxService {
	ctx;
	domain;
	events;
	deliveries;
	ops;
	listeners = /* @__PURE__ */ new Set();
	now;
	defaultLimit;
	feishu;
	deliveryQueue = /* @__PURE__ */ new Map();
	closed = false;
	/** 间隔到点的一次性叫醒（见 armIntervalWake）；同一时刻只留一个。 */
	intervalWake;
	/**
	* 本进程上次把 native 候选交出去的时刻。
	* ⚠️ 只放内存、不落库：它是"这个进程刚才已经弹过"的节流时钟，重启后由投递台账
	*   （delivered/sent 的 updatedAt）继续兜底，两者取较晚的那个（见 nativeLastPopupAt）。
	*/
	lastNativeHandoutAt;
	/**
	* 打开域并装配服务。
	* @param ctx - Host 上下文（提供 storageDomain 与 logger）
	* @param config - 服务配置
	* @returns 已就绪的服务；调用方负责 close()
	*/
	static async open(ctx, config = {}) {
		const domain = await ctx.storageDomain.open(POSTBOX_DOMAIN);
		return new PostboxService(ctx, domain, config);
	}
	constructor(ctx, domain, config) {
		this.ctx = ctx;
		this.domain = domain;
		this.events = domain.table("events");
		this.deliveries = domain.table("deliveries");
		this.ops = domain.table("ops");
		this.now = config.now ?? (() => Date.now());
		this.defaultLimit = config.defaultLimit ?? 50;
		this.feishu = config.feishu;
	}
	/** 关闭域句柄；已被别处关闭时幂等。 */
	async close() {
		if (this.closed) return;
		this.closed = true;
		if (this.intervalWake !== void 0) {
			clearTimeout(this.intervalWake);
			this.intervalWake = void 0;
		}
		this.listeners.clear();
		await this.domain.close();
	}
	/** 订阅变化；返回取消函数。 */
	subscribe(listener) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	/** 读全局槽。 */
	global() {
		return this.domain.global.get();
	}
	/**
	* 分配下一个序号并广播。
	* ⚠️【勿动】必须先 set(global) 再广播：客户端收到帧就按 seq 拉增量，
	*   若先广播后落水位，客户端可能拿旧水位拉不到刚写的事件。
	* @param eventIds - 本次变化涉及的事件
	* @returns 新的水位
	*/
	async bumpSeq(eventIds) {
		const current = this.global();
		const next = current.seq + 1;
		await this.domain.global.set({
			...current,
			seq: next
		});
		const frame = {
			type: "changed",
			seq: next,
			eventIds: [...eventIds]
		};
		for (const listener of this.listeners) try {
			listener(frame);
		} catch (error) {
			this.ctx.logger?.warn?.("dot-postbox: watch listener failed: %s", error instanceof Error ? error.message : String(error));
		}
		return next;
	}
	/**
	* 台账幂等包装：同一 operationId 只执行一次，重放返回首次结果。
	* @param operationId - 客户端稳定标识
	* @param action - 动作码（便于审计）
	* @param run - 首次执行体
	* @returns 首次（或重放的）结果
	*/
	async runOperation(operationId, action, run) {
		if (operationId.length === 0) throw new PostboxError("postbox/invalid-request", "operationId 不能为空");
		const prior = this.ops.get(operationId);
		if (prior !== void 0) {
			if (prior.action !== action) throw new PostboxError("postbox/conflict", `operationId ${operationId} 已用于 ${prior.action}`);
			return JSON.parse(prior.result);
		}
		const value = await run();
		await this.ops.put(operationId, {
			operationId,
			action,
			result: JSON.stringify(value),
			at: this.now()
		});
		return value;
	}
	/**
	* 写一条事件（带 dedupeKey 去重）。已存在同 dedupeKey 时返回原事件并标记重复。
	* @param input - 事件内容
	* @param operationId - 可选台账号；进程内工作插件可不传
	* @returns 事件 + 是否重复
	*/
	async publish(input, operationId) {
		const run = async () => {
			const existing = this.findByDedupeKey(input.dedupeKey);
			if (existing !== void 0) {
				const touched = {
					...existing,
					updatedAt: this.now()
				};
				await this.events.put(existing.id, touched);
				return {
					event: touched,
					duplicate: true
				};
			}
			const at = this.now();
			const seq = this.global().seq + 1;
			const event = {
				id: eventIdOf(seq),
				seq,
				kind: input.kind,
				severity: input.severity ?? defaultSeverityOf(input.kind),
				title: input.title,
				...input.body === void 0 ? {} : { body: input.body },
				...input.workId === void 0 ? {} : { workId: input.workId },
				...input.sessionId === void 0 ? {} : { sessionId: input.sessionId },
				createdAt: at,
				updatedAt: at,
				read: false,
				archived: false,
				...input.dueAt === void 0 ? {} : { dueAt: input.dueAt },
				...input.expiresAt === void 0 ? {} : { expiresAt: input.expiresAt },
				origin: input.origin ?? "host",
				dedupeKey: input.dedupeKey
			};
			await this.events.put(event.id, event);
			for (const channel of this.channelsFor(event)) await this.deliveries.put(deliveryKey(event.id, channel), {
				eventId: event.id,
				channel,
				status: "pending",
				attempts: 0,
				updatedAt: at
			});
			await this.bumpSeq([event.id]);
			return {
				event,
				duplicate: false
			};
		};
		return operationId === void 0 ? run() : this.runOperation(operationId, "publish", run);
	}
	/**
	* 该事件此刻应为哪些渠道建投递条。
	* 为什么不在这里真发：投递由消费端（Android / 适配器）或显式 retryDelivery 驱动，
	* 本服务只保证"该有哪几条记录"，不假装送达。
	* @param event - 事件
	* @returns 渠道清单（免打扰只影响状态，不阻止建条——用户关掉免打扰后要能补发）
	*/
	channelsFor(event) {
		const prefs = this.global().preferences;
		const channels = [];
		if (prefs.channels.native) channels.push("native");
		if (prefs.channels.feishu && prefs.feishu.enabled && this.feishu?.available() === true) channels.push("feishu");
		return channels;
	}
	/** 按 dedupeKey 找已有事件（事件量小，线性扫比维护索引简单且不会错）。 */
	findByDedupeKey(dedupeKey) {
		for (const event of this.events.entries()) if (event[1].dedupeKey === dedupeKey) return event[1];
	}
	/**
	* 列表查询（按 seq 倒序，游标是上一页最后一个 seq 的字符串形式）。
	* @param query - 查询条件
	* @returns 事件页（每条附带 deliveries 投影）
	*/
	list(query = {}) {
		const at = this.now();
		const limit = Math.min(Math.max(query.limit ?? this.defaultLimit, 1), 200);
		const cursor = query.cursor === void 0 ? void 0 : Number(query.cursor);
		if (cursor !== void 0 && !Number.isFinite(cursor)) throw new PostboxError("postbox/invalid-request", `非法游标 ${query.cursor}`);
		const kinds = query.kinds === void 0 ? void 0 : new Set(query.kinds);
		const rows = [...this.events.entries()].map((entry) => entry[1]).filter((event) => visibleInList(event, at, query.includeArchived === true)).filter((event) => query.unreadOnly === true ? !event.read : true).filter((event) => kinds === void 0 ? true : kinds.has(event.kind)).filter((event) => cursor === void 0 ? true : event.seq < cursor).sort((left, right) => right.seq - left.seq);
		const page = rows.slice(0, limit);
		const nextCursor = rows.length > limit ? String(page[page.length - 1]?.seq ?? "") : null;
		return {
			items: page.map((event) => this.viewOf(event)),
			nextCursor: nextCursor === "" ? null : nextCursor,
			serverTime: at
		};
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
	lastChannelDeliveryAt(channel) {
		let latest;
		for (const entry of this.deliveries.entries()) {
			const record = entry[1];
			if (record.channel !== channel) continue;
			if (record.status !== "delivered" && record.status !== "sent") continue;
			if (latest === void 0 || record.updatedAt > latest) latest = record.updatedAt;
		}
		return latest;
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
	nativeLastPopupAt() {
		const delivered = this.lastChannelDeliveryAt("native");
		const handed = this.lastNativeHandoutAt;
		if (delivered === void 0) return handed;
		if (handed === void 0) return delivered;
		return Math.max(delivered, handed);
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
	armIntervalWake(delayMs) {
		if (this.intervalWake !== void 0) return;
		const timer = setTimeout(() => {
			this.intervalWake = void 0;
			if (this.closed) return;
			this.bumpSeq([]).catch(() => {});
		}, Math.max(50, delayMs));
		const maybeUnref = timer.unref;
		if (typeof maybeUnref === "function") maybeUnref.call(timer);
		this.intervalWake = timer;
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
	pending(since, limit = 50) {
		const at = this.now();
		const watermark = since === void 0 || since === "" ? 0 : Number(since);
		if (!Number.isFinite(watermark)) throw new PostboxError("postbox/invalid-request", `非法 since ${since}`);
		const prefs = this.global().preferences;
		const pageSize = Math.min(Math.max(limit, 1), 200);
		const candidates = [...this.events.entries()].map((entry) => entry[1]).filter((event) => !event.read && !event.archived).filter((event) => this.deliveries.get(deliveryKey(event.id, "native"))?.status !== "delivered").sort((left, right) => {
			const leftNew = left.seq > watermark ? 0 : 1;
			const rightNew = right.seq > watermark ? 0 : 1;
			if (leftNew !== rightNew) return leftNew - rightNew;
			return left.createdAt - right.createdAt;
		});
		const items = [];
		let suppressed = 0;
		let scanned = -1;
		const nativeLastAt = this.nativeLastPopupAt();
		const minInterval = prefs.native.minIntervalMs;
		const intervalCap = minInterval > 0 ? 1 : pageSize;
		let deferredByInterval = 0;
		for (const event of candidates) {
			scanned = Math.max(scanned, event.seq);
			if (prefs.native.maxAgeMs > 0 && at - event.createdAt > prefs.native.maxAgeMs) {
				suppressed += 1;
				continue;
			}
			if (suppressionOf(event, "native", prefs, at) !== void 0) {
				suppressed += 1;
				continue;
			}
			if (!respectsMinInterval(nativeLastAt, minInterval, at) || items.length >= intervalCap) {
				suppressed += 1;
				deferredByInterval += 1;
				continue;
			}
			items.push(this.viewOf(event));
			if (items.length >= pageSize) break;
		}
		if (minInterval > 0 && items.length > 0) this.lastNativeHandoutAt = at;
		if (minInterval > 0 && deferredByInterval > 0) {
			const waitMs = items.length > 0 ? minInterval : nativeLastAt === void 0 ? 0 : Math.max(0, minInterval - (at - nativeLastAt));
			this.armIntervalWake(waitMs);
		}
		return {
			items,
			cursor: scanned >= 0 ? String(scanned) : String(this.global().seq),
			serverTime: at,
			suppressed
		};
	}
	/** 把事件本体投影成前端视图（附投递条）。 */
	viewOf(event) {
		return {
			...event,
			deliveries: this.deliveriesOf(event.id)
		};
	}
	/** 单条读取（附投递条）。 */
	get(id) {
		return this.viewOf(this.requireEvent(id));
	}
	/**
	* 取持久事件本体（不含投递投影）。
	* ⚠️【勿动】写路径必须用它，不能用 get()：get() 的返回值带 `deliveries`，
	*   写回 events 表会把投影字段也持久化，等于在事实表里造第二份真相。
	* @param id - 事件 id
	* @returns 事件本体
	*/
	requireEvent(id) {
		const event = this.events.get(id);
		if (event === void 0) throw new PostboxError("postbox/not-found", `没有事件 ${id}`, id);
		return event;
	}
	/** 某事件的全部投递记录。 */
	deliveriesOf(id) {
		return [...this.deliveries.entries()].map((entry) => entry[1]).filter((record) => record.eventId === id).sort((left, right) => left.channel.localeCompare(right.channel));
	}
	/** 标记已读（幂等）。 */
	async read(id, operationId) {
		return this.runOperation(operationId, "read", async () => {
			const event = this.requireEvent(id);
			if (event.read) return event;
			const next = {
				...event,
				read: true,
				updatedAt: this.now()
			};
			await this.events.put(id, next);
			await this.bumpSeq([id]);
			return next;
		});
	}
	/** 归档（幂等；不删除事实与投递历史）。 */
	async archive(id, operationId) {
		return this.runOperation(operationId, "archive", async () => {
			const event = this.requireEvent(id);
			if (event.archived) return event;
			const next = {
				...event,
				archived: true,
				updatedAt: this.now()
			};
			await this.events.put(id, next);
			await this.bumpSeq([id]);
			return next;
		});
	}
	/** 读偏好与水位。 */
	preferences() {
		const g = this.global();
		return {
			preferences: g.preferences,
			rev: g.seq,
			personalReminders: true
		};
	}
	/**
	* 写偏好（整体替换语义；rev 可选乐观锁）。
	* @param preferences - 新偏好
	* @param operationId - 台账号
	* @param rev - 期望水位；与当前不符时拒绝（防两端互相覆盖）
	* @returns 新偏好与水位
	*/
	async setPreferences(preferences, operationId, rev) {
		return this.runOperation(operationId, "set-preferences", async () => {
			const current = this.global();
			if (rev !== void 0 && rev !== current.seq) throw new PostboxError("postbox/conflict", `偏好已被别处修改（期望 ${rev}，当前 ${current.seq}）`);
			await this.domain.global.set({
				...current,
				preferences
			});
			return {
				preferences,
				rev: await this.bumpSeq([])
			};
		});
	}
	async deliveryOperation(id, channel, operationId, action, run) {
		if (channel !== "feishu") return this.runOperation(operationId, action, run);
		const key = deliveryKey(id, channel);
		const next = (this.deliveryQueue.get(key) ?? Promise.resolve()).catch(() => {}).then(() => this.runOperation(operationId, action, run));
		this.deliveryQueue.set(key, next);
		try {
			const value = await next;
			if (value.eventId !== id || value.channel !== channel) throw new PostboxError("postbox/conflict", "回执属于另一项投递");
			return value;
		} finally {
			if (this.deliveryQueue.get(key) === next) this.deliveryQueue.delete(key);
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
	async deliveryReceipt(id, channel, status, operationId, detail) {
		return this.deliveryOperation(id, channel, operationId, "delivery-receipt", async () => {
			const event = this.requireEvent(id);
			const key = deliveryKey(id, channel);
			const prior = this.deliveries.get(key);
			if (channel === "feishu" && prior?.status === "delivered") return prior;
			if (prior === void 0 && channel === "wechat") throw new PostboxError("postbox/unavailable", wechatUnavailableReason());
			const attempts = (prior?.attempts ?? 0) + (status === "suppressed" || channel === "feishu" && prior?.status === "sent" ? 0 : 1);
			const next = {
				eventId: event.id,
				channel,
				status,
				attempts: prior === void 0 ? status === "suppressed" ? 0 : 1 : attempts,
				updatedAt: this.now(),
				...detail === void 0 ? {} : { detail },
				...prior?.externalId === void 0 ? {} : { externalId: prior.externalId }
			};
			await this.deliveries.put(key, next);
			await this.bumpSeq([id]);
			return next;
		});
	}
	/**
	* 重试一次投递：真调用渠道（只有飞书可外发；native 由 Android 自己拉 pending 完成）。
	* @param id - 事件
	* @param channel - 渠道
	* @param operationId - 台账号
	* @returns 更新后的投递条
	*/
	async retryDelivery(id, channel, operationId) {
		return this.deliveryOperation(id, channel, operationId, "retry-delivery", async () => {
			const event = this.requireEvent(id);
			const at = this.now();
			const prefs = this.global().preferences;
			const suppression = suppressionOf(event, channel, prefs, at);
			const key = deliveryKey(id, channel);
			const prior = this.deliveries.get(key);
			if (channel === "feishu" && (prior?.status === "sent" || prior?.status === "delivered")) return prior;
			if (suppression !== void 0) {
				const suppressed = {
					eventId: id,
					channel,
					status: "suppressed",
					attempts: prior?.attempts ?? 0,
					updatedAt: at,
					detail: suppression
				};
				await this.deliveries.put(key, suppressed);
				await this.bumpSeq([id]);
				return suppressed;
			}
			if (channel === "native") {
				const sent = {
					eventId: id,
					channel,
					status: "sent",
					attempts: (prior?.attempts ?? 0) + 1,
					updatedAt: at,
					...prior?.externalId === void 0 ? {} : { externalId: prior.externalId }
				};
				await this.deliveries.put(key, sent);
				await this.bumpSeq([id]);
				return sent;
			}
			if (channel === "wechat") throw new PostboxError("postbox/unavailable", wechatUnavailableReason());
			if (this.feishu === void 0 || !this.feishu.available()) {
				const failed = {
					eventId: id,
					channel,
					status: "failed",
					attempts: (prior?.attempts ?? 0) + 1,
					updatedAt: at,
					detail: this.feishu?.unavailableReason() ?? "未装配飞书适配器"
				};
				await this.deliveries.put(key, failed);
				await this.bumpSeq([id]);
				return failed;
			}
			const attempt = {
				eventId: id,
				channel,
				status: "sent",
				attempts: (prior?.attempts ?? 0) + 1,
				updatedAt: this.now(),
				detail: "外发结果待核对"
			};
			await this.deliveries.put(key, attempt);
			await this.bumpSeq([id]);
			const result = await this.feishu.send({
				title: event.title,
				body: event.body ?? ""
			});
			if (result.uncertain) return attempt;
			const record = {
				eventId: id,
				channel,
				status: result.ok ? "delivered" : "failed",
				attempts: attempt.attempts,
				updatedAt: this.now(),
				...result.ok ? {} : { detail: result.error ?? "渠道拒绝投递" },
				...result.externalId === void 0 ? {} : { externalId: result.externalId }
			};
			await this.deliveries.put(key, record);
			await this.bumpSeq([id]);
			return record;
		});
	}
	/** 渠道与整体状态（缺配置如实报不可用，不假成功）。 */
	status() {
		const prefs = this.global().preferences;
		const feishuConfigured = this.feishu !== void 0 && this.feishu.available();
		let pendingDeliveries = 0;
		for (const entry of this.deliveries.entries()) if (entry[1].status === "pending" || entry[1].status === "sent") pendingDeliveries += 1;
		return {
			channels: {
				native: { available: true },
				feishu: feishuConfigured ? { configured: true } : {
					configured: false,
					reason: this.feishu?.unavailableReason() ?? "未装配飞书适配器"
				},
				wechat: {
					available: false,
					reason: wechatUnavailableReason()
				}
			},
			preferences: prefs,
			seq: this.global().seq,
			pendingDeliveries,
			events: this.events.size
		};
	}
	/** 默认偏好（UI 初始化用；写回要显式 setPreferences）。 */
	static defaults() {
		return DEFAULT_PREFERENCES;
	}
};
//#endregion
//#region lib/types/remote.js
var __runInitializers = function(thisArg, initializers, value) {
	var useValue = arguments.length > 2;
	for (var i = 0; i < initializers.length; i++) value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
	return useValue ? value : void 0;
};
var __esDecorate = function(ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
	function accept(f) {
		if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected");
		return f;
	}
	var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
	var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
	var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
	var _, done = false;
	for (var i = decorators.length - 1; i >= 0; i--) {
		var context = {};
		for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
		for (var p in contextIn.access) context.access[p] = contextIn.access[p];
		context.addInitializer = function(f) {
			if (done) throw new TypeError("Cannot add initializers after decoration has completed");
			extraInitializers.push(accept(f || null));
		};
		var result = (0, decorators[i])(kind === "accessor" ? {
			get: descriptor.get,
			set: descriptor.set
		} : descriptor[key], context);
		if (kind === "accessor") {
			if (result === void 0) continue;
			if (result === null || typeof result !== "object") throw new TypeError("Object expected");
			if (_ = accept(result.get)) descriptor.get = _;
			if (_ = accept(result.set)) descriptor.set = _;
			if (_ = accept(result.init)) initializers.unshift(_);
		} else if (_ = accept(result)) if (kind === "field") initializers.unshift(_);
		else descriptor[key] = _;
	}
	if (target) Object.defineProperty(target, contextIn.name, descriptor);
	done = true;
};
/** 把域异常折成官方 Remote 失败。 */
function asRemoteFailure(error) {
	if (error instanceof PostboxError) switch (error.code) {
		case "postbox/not-found": throw new RemoteError("postbox/not-found", error.message, { eventId: error.subjectId ?? "" });
		case "postbox/conflict": throw new RemoteError("postbox/conflict", error.message, { reason: error.message });
		case "postbox/unavailable": throw new RemoteError("postbox/unavailable", error.message, { reason: error.message });
		case "postbox/invalid-request": throw new RemoteError("postbox/invalid-request", error.message, { reason: error.message });
		default: throw error;
	}
	throw error;
}
/**
* 星邮匣 Remote owner。
*/
let PostboxRemote = (() => {
	let _classSuper = TypertRemoteService;
	let _instanceExtraInitializers = [];
	let _remoteExportList_decorators;
	let _remoteExportPending_decorators;
	let _remoteExportGet_decorators;
	let _remoteExportRead_decorators;
	let _remoteExportArchive_decorators;
	let _remoteExportPreferences_decorators;
	let _remoteExportSetPreferences_decorators;
	let _remoteExportDeliveryReceipt_decorators;
	let _remoteExportRetry_decorators;
	let _remoteExportStatus_decorators;
	let _remoteExportWatch_decorators;
	return class PostboxRemote extends _classSuper {
		static {
			const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
			_remoteExportList_decorators = [Remote("list")];
			_remoteExportPending_decorators = [Remote("pending")];
			_remoteExportGet_decorators = [Remote("get")];
			_remoteExportRead_decorators = [Remote("read")];
			_remoteExportArchive_decorators = [Remote("archive")];
			_remoteExportPreferences_decorators = [Remote("preferences")];
			_remoteExportSetPreferences_decorators = [Remote("setPreferences")];
			_remoteExportDeliveryReceipt_decorators = [Remote("deliveryReceipt")];
			_remoteExportRetry_decorators = [Remote("retryDelivery")];
			_remoteExportStatus_decorators = [Remote("status")];
			_remoteExportWatch_decorators = [Remote({
				name: "watch",
				mode: "stream"
			})];
			__esDecorate(this, null, _remoteExportList_decorators, {
				kind: "method",
				name: "remoteExportList",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteExportList" in obj,
					get: (obj) => obj.remoteExportList
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteExportPending_decorators, {
				kind: "method",
				name: "remoteExportPending",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteExportPending" in obj,
					get: (obj) => obj.remoteExportPending
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteExportGet_decorators, {
				kind: "method",
				name: "remoteExportGet",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteExportGet" in obj,
					get: (obj) => obj.remoteExportGet
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteExportRead_decorators, {
				kind: "method",
				name: "remoteExportRead",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteExportRead" in obj,
					get: (obj) => obj.remoteExportRead
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteExportArchive_decorators, {
				kind: "method",
				name: "remoteExportArchive",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteExportArchive" in obj,
					get: (obj) => obj.remoteExportArchive
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteExportPreferences_decorators, {
				kind: "method",
				name: "remoteExportPreferences",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteExportPreferences" in obj,
					get: (obj) => obj.remoteExportPreferences
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteExportSetPreferences_decorators, {
				kind: "method",
				name: "remoteExportSetPreferences",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteExportSetPreferences" in obj,
					get: (obj) => obj.remoteExportSetPreferences
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteExportDeliveryReceipt_decorators, {
				kind: "method",
				name: "remoteExportDeliveryReceipt",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteExportDeliveryReceipt" in obj,
					get: (obj) => obj.remoteExportDeliveryReceipt
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteExportRetry_decorators, {
				kind: "method",
				name: "remoteExportRetry",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteExportRetry" in obj,
					get: (obj) => obj.remoteExportRetry
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteExportStatus_decorators, {
				kind: "method",
				name: "remoteExportStatus",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteExportStatus" in obj,
					get: (obj) => obj.remoteExportStatus
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _remoteExportWatch_decorators, {
				kind: "method",
				name: "remoteExportWatch",
				static: false,
				private: false,
				access: {
					has: (obj) => "remoteExportWatch" in obj,
					get: (obj) => obj.remoteExportWatch
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			if (_metadata) Object.defineProperty(this, Symbol.metadata, {
				enumerable: true,
				configurable: true,
				writable: true,
				value: _metadata
			});
		}
		postbox = __runInitializers(this, _instanceExtraInitializers);
		/** 只依赖自己的业务服务；不加额外服务依赖。 */
		static inject = [];
		/**
		* ⚠️【勿动】Cordis 服务键必须是 `dotPostboxRemote`，**不能**与业务服务键 `dotPostbox` 相同。
		*   同一个键会在 Cordis 里注册两次（一次是本 Remote，一次是 apply 里的 PostboxService），
		*   装配时直接抛 `service "dotPostbox" has been registered`。
		*   官方惯例同款：JobController 的服务键是 `jobController`，wire namespace 才是 `job`。
		*/
		constructor(ctx, postbox) {
			super(ctx, "dotPostboxRemote", { namespace: "dotPostbox" });
			this.postbox = postbox;
		}
		/** 列表（每条带 deliveries 投影）。 */
		remoteExportList(request) {
			try {
				return this.postbox.list({
					...request.cursor === void 0 ? {} : { cursor: request.cursor },
					...request.limit === void 0 ? {} : { limit: request.limit },
					...request.unreadOnly === void 0 ? {} : { unreadOnly: request.unreadOnly },
					...request.kinds === void 0 ? {} : { kinds: request.kinds },
					...request.includeArchived === void 0 ? {} : { includeArchived: request.includeArchived }
				});
			} catch (error) {
				return asRemoteFailure(error);
			}
		}
		/** 增量（Android 前台服务轮询用；规则已在服务端执行）。 */
		remoteExportPending(request) {
			try {
				return this.postbox.pending(request.since, request.limit ?? 50);
			} catch (error) {
				return asRemoteFailure(error);
			}
		}
		/** 单条读取。 */
		remoteExportGet(request) {
			try {
				return this.postbox.get(request.id);
			} catch (error) {
				return asRemoteFailure(error);
			}
		}
		/** 标记已读。 */
		async remoteExportRead(request) {
			try {
				const event = await this.postbox.read(request.id, request.operationId);
				return this.postbox.get(event.id);
			} catch (error) {
				return asRemoteFailure(error);
			}
		}
		/** 归档。 */
		async remoteExportArchive(request) {
			try {
				const event = await this.postbox.archive(request.id, request.operationId);
				return this.postbox.get(event.id);
			} catch (error) {
				return asRemoteFailure(error);
			}
		}
		/** 读偏好。 */
		remoteExportPreferences() {
			return this.postbox.preferences();
		}
		/** 写偏好（rev 乐观锁可选）。 */
		async remoteExportSetPreferences(request) {
			try {
				return await this.postbox.setPreferences(request.preferences, request.operationId, request.rev);
			} catch (error) {
				return asRemoteFailure(error);
			}
		}
		/** 回执（native 弹完/飞书确认后回写；同 operationId 幂等）。 */
		async remoteExportDeliveryReceipt(request) {
			try {
				return await this.postbox.deliveryReceipt(request.id, request.channel, request.status, request.operationId, request.detail);
			} catch (error) {
				return asRemoteFailure(error);
			}
		}
		/** 重试投递（飞书真发；native 只标记已交给前端队列）。 */
		async remoteExportRetry(request) {
			try {
				return await this.postbox.retryDelivery(request.id, request.channel, request.operationId);
			} catch (error) {
				return asRemoteFailure(error);
			}
		}
		/** 渠道与整体状态。 */
		remoteExportStatus() {
			return this.postbox.status();
		}
		/** 变化流：Client 订阅后按 seq 主动拉快照/增量。 */
		remoteExportWatch(signal) {
			return watchStream(this.postbox, signal);
		}
	};
})();
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
async function* watchStream(postbox, signal) {
	const queue = [];
	let wake;
	const unsubscribe = postbox.subscribe((frame) => {
		queue.push(frame);
		wake?.();
		wake = void 0;
	});
	signal.addEventListener("abort", () => {
		wake?.();
		wake = void 0;
	}, { once: true });
	try {
		yield {
			type: "ready",
			seq: postbox.status().seq,
			eventIds: []
		};
		while (!signal.aborted) {
			const frame = queue.shift();
			if (frame !== void 0) {
				yield frame;
				continue;
			}
			await new Promise((resolve) => {
				wake = resolve;
			});
		}
	} finally {
		unsubscribe();
	}
}
//#endregion
//#region lib/types/index.js
/** Loader 诊断里显示的名字。 */
const name = "dot-postbox";
/** 硬依赖：官方存储域是唯一持久化出口；typert 提供 Remote 注册面。 */
const inject = ["storageDomain", "typert"];
/** 配置 schema（schemastery：官方插件配置形状）。 */
const Config = z.object({
	feishuWebhookUrl: z.string().default(""),
	defaultLimit: z.natural().min(1).max(200).default(50),
	outboundTimeoutMs: z.natural().min(1e3).max(6e4).default(1e4)
});
/** 服务键（供运行时/界面注入使用）。 */
const POSTBOX_SERVICE_KEY = "dotPostbox";
/**
* 装配星邮匣。
* @param ctx - Host 上下文
* @param config - 插件配置（已由 schemastery 补齐默认值）
*/
async function apply(ctx, config) {
	const feishu = config.feishuWebhookUrl !== "" ? createFeishuTransport({
		webhookUrl: config.feishuWebhookUrl,
		timeoutMs: config.outboundTimeoutMs
	}) : void 0;
	const service = await PostboxService.open(ctx, {
		...feishu === void 0 ? {} : { feishu },
		defaultLimit: config.defaultLimit
	});
	ctx.effect(() => () => service.close(), "dot-postbox: 关闭存储域");
	ctx.effect(() => ctx.reflect.provide(POSTBOX_SERVICE_KEY, service), "dot-postbox: 服务注册");
	ctx.plugin(PostboxRemote, service);
}
//#endregion
export { Config, DEFAULT_PREFERENCES, DELIVERY_CHANNELS, POSTBOX_DOMAIN, POSTBOX_KINDS, POSTBOX_SERVICE_KEY, POSTBOX_SEVERITIES, PostboxError, PostboxRemote, PostboxService, apply, createFeishuTransport, defaultSeverityOf, eventIdOf, inDndWindow, inject, isExpired, minuteOfDay, name, needsAttention, respectsMinInterval, suppressionOf, visibleInList, wechatUnavailableReason };
