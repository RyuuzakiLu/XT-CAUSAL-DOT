import type { Context } from '@deepseek-ai/cordis';
import type { OutboundTransport } from './transport.ts';
import { type DeliveryChannel, type DeliveryRecord, type PostboxEvent, type PostboxEventView, type PostboxKind, type PostboxPreferences, type PostboxSeverity } from './types.ts';
/** 域失败：由 Remote 层折成稳定错误码，不用自由文本给界面判断。 */
export declare class PostboxError extends Error {
    readonly code: 'postbox/not-found' | 'postbox/conflict' | 'postbox/unavailable' | 'postbox/invalid-request';
    /**
     * 出错对象（事件 id 等）。Remote 层用它填 `details`。
     * ⚠️【不】让 Remote 层自己猜 id：猜出来的 details 会指向别的对象，
     *   界面按 details 去定位时就会打开错误的信（真发生过的坑）。
     */
    readonly subjectId: string | undefined;
    constructor(code: 'postbox/not-found' | 'postbox/conflict' | 'postbox/unavailable' | 'postbox/invalid-request', message: string, subjectId?: string);
}
/** publish 的入参；供 service 与 work 插件（进程内）共用。 */
export interface PublishInput {
    readonly kind: PostboxKind;
    readonly severity?: PostboxSeverity;
    readonly title: string;
    readonly body?: string;
    readonly workId?: string;
    readonly sessionId?: string;
    readonly dedupeKey: string;
    readonly origin?: string;
    readonly dueAt?: number;
    readonly expiresAt?: number;
}
/** 列表查询入参。 */
export interface ListQuery {
    readonly cursor?: string;
    readonly limit?: number;
    readonly unreadOnly?: boolean;
    readonly kinds?: readonly PostboxKind[];
    readonly includeArchived?: boolean;
}
/** 列表结果。 */
export interface ListResult {
    readonly items: readonly PostboxEventView[];
    readonly nextCursor: string | null;
    readonly serverTime: number;
}
/** 增量（Android 轮询）结果。 */
export interface PendingResult {
    readonly items: readonly PostboxEventView[];
    readonly cursor: string;
    readonly serverTime: number;
    /** 本轮被规则挡下、暂不弹出的条数（供 Android 打日志/解释"为什么没弹"）。 */
    readonly suppressed: number;
}
/** 渠道状态。 */
export interface PostboxStatus {
    readonly channels: {
        readonly native: {
            readonly available: boolean;
            readonly reason?: string;
        };
        readonly feishu: {
            readonly configured: boolean;
            readonly reason?: string;
        };
        readonly wechat: {
            readonly available: false;
            readonly reason: string;
        };
    };
    readonly preferences: PostboxPreferences;
    readonly seq: number;
    readonly pendingDeliveries: number;
    readonly events: number;
}
/** watch 流的一个帧。 */
export interface PostboxWatchFrame {
    readonly type: 'changed';
    readonly seq: number;
    /** 本次变化涉及的事件（可能为空：偏好变化）。 */
    readonly eventIds: readonly string[];
}
/** 服务配置。 */
export interface PostboxServiceConfig {
    /** 飞书适配器；不传=不可用（status 如实报）。 */
    readonly feishu?: OutboundTransport;
    /** 注入时钟，便于测试；默认 Date.now。 */
    readonly now?: () => number;
    /** 列表默认条数。 */
    readonly defaultLimit?: number;
}
/**
 * 星邮匣服务：事件与投递记录的唯一所有者。
 */
export declare class PostboxService {
    private readonly ctx;
    private readonly domain;
    private readonly events;
    private readonly deliveries;
    private readonly ops;
    private readonly listeners;
    private readonly now;
    private readonly defaultLimit;
    private readonly feishu;
    private readonly deliveryQueue;
    private closed;
    /** 间隔到点的一次性叫醒（见 armIntervalWake）；同一时刻只留一个。 */
    private intervalWake;
    /**
     * 本进程上次把 native 候选交出去的时刻。
     * ⚠️ 只放内存、不落库：它是"这个进程刚才已经弹过"的节流时钟，重启后由投递台账
     *   （delivered/sent 的 updatedAt）继续兜底，两者取较晚的那个（见 nativeLastPopupAt）。
     */
    private lastNativeHandoutAt;
    /**
     * 打开域并装配服务。
     * @param ctx - Host 上下文（提供 storageDomain 与 logger）
     * @param config - 服务配置
     * @returns 已就绪的服务；调用方负责 close()
     */
    static open(ctx: Context, config?: PostboxServiceConfig): Promise<PostboxService>;
    private constructor();
    /** 关闭域句柄；已被别处关闭时幂等。 */
    close(): Promise<void>;
    /** 订阅变化；返回取消函数。 */
    subscribe(listener: (frame: PostboxWatchFrame) => void): () => void;
    /** 读全局槽。 */
    private global;
    /**
     * 分配下一个序号并广播。
     * ⚠️【勿动】必须先 set(global) 再广播：客户端收到帧就按 seq 拉增量，
     *   若先广播后落水位，客户端可能拿旧水位拉不到刚写的事件。
     * @param eventIds - 本次变化涉及的事件
     * @returns 新的水位
     */
    private bumpSeq;
    /**
     * 台账幂等包装：同一 operationId 只执行一次，重放返回首次结果。
     * @param operationId - 客户端稳定标识
     * @param action - 动作码（便于审计）
     * @param run - 首次执行体
     * @returns 首次（或重放的）结果
     */
    private runOperation;
    /**
     * 写一条事件（带 dedupeKey 去重）。已存在同 dedupeKey 时返回原事件并标记重复。
     * @param input - 事件内容
     * @param operationId - 可选台账号；进程内工作插件可不传
     * @returns 事件 + 是否重复
     */
    publish(input: PublishInput, operationId?: string): Promise<{
        event: PostboxEvent;
        duplicate: boolean;
    }>;
    /**
     * 该事件此刻应为哪些渠道建投递条。
     * 为什么不在这里真发：投递由消费端（Android / 适配器）或显式 retryDelivery 驱动，
     * 本服务只保证"该有哪几条记录"，不假装送达。
     * @param event - 事件
     * @returns 渠道清单（免打扰只影响状态，不阻止建条——用户关掉免打扰后要能补发）
     */
    private channelsFor;
    /** 按 dedupeKey 找已有事件（事件量小，线性扫比维护索引简单且不会错）。 */
    private findByDedupeKey;
    /**
     * 列表查询（按 seq 倒序，游标是上一页最后一个 seq 的字符串形式）。
     * @param query - 查询条件
     * @returns 事件页（每条附带 deliveries 投影）
     */
    list(query?: ListQuery): ListResult;
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
    private lastChannelDeliveryAt;
    /**
     * "上一次弹出去"的判定基准 = max(投递台账里的 delivered/sent 时刻, 本进程上次交出的时刻)。
     *
     * ▍为什么两个都要
     * 只靠投递台账不够：客户端拿到 items 到写回执之间有往返，这段时间里再拉一次
     * （重连、页面抖动、多端同时 watch）会重复拿到同一条 → 用户看到两条一模一样的通知。
     * 只靠内存不够：进程重启后内存清零，节流会瞬时空窗。
     * 取较晚的那个，两种坑一起堵住；0 分支不碰这两个值，行为与旧版逐字节一致。
     */
    private nativeLastPopupAt;
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
    private armIntervalWake;
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
    pending(since?: string, limit?: number): PendingResult;
    /** 把事件本体投影成前端视图（附投递条）。 */
    private viewOf;
    /** 单条读取（附投递条）。 */
    get(id: string): PostboxEventView;
    /**
     * 取持久事件本体（不含投递投影）。
     * ⚠️【勿动】写路径必须用它，不能用 get()：get() 的返回值带 `deliveries`，
     *   写回 events 表会把投影字段也持久化，等于在事实表里造第二份真相。
     * @param id - 事件 id
     * @returns 事件本体
     */
    private requireEvent;
    /** 某事件的全部投递记录。 */
    deliveriesOf(id: string): readonly DeliveryRecord[];
    /** 标记已读（幂等）。 */
    read(id: string, operationId: string): Promise<PostboxEvent>;
    /** 归档（幂等；不删除事实与投递历史）。 */
    archive(id: string, operationId: string): Promise<PostboxEvent>;
    /** 读偏好与水位。 */
    preferences(): {
        preferences: PostboxPreferences;
        rev: number;
        personalReminders: boolean;
    };
    /**
     * 写偏好（整体替换语义；rev 可选乐观锁）。
     * @param preferences - 新偏好
     * @param operationId - 台账号
     * @param rev - 期望水位；与当前不符时拒绝（防两端互相覆盖）
     * @returns 新偏好与水位
     */
    setPreferences(preferences: PostboxPreferences, operationId: string, rev?: number): Promise<{
        preferences: PostboxPreferences;
        rev: number;
    }>;
    private deliveryOperation;
    /**
     * 记录一次渠道投递结果（Android 弹完系统通知、飞书拿到确认都走这里）。
     * @param id - 事件
     * @param channel - 渠道
     * @param status - 结果
     * @param operationId - 台账号（同一条回执重放不重复记）
     * @param detail - 失败/抑制原因
     * @returns 更新后的投递条
     */
    deliveryReceipt(id: string, channel: DeliveryChannel, status: DeliveryRecord['status'], operationId: string, detail?: string): Promise<DeliveryRecord>;
    /**
     * 重试一次投递：真调用渠道（只有飞书可外发；native 由 Android 自己拉 pending 完成）。
     * @param id - 事件
     * @param channel - 渠道
     * @param operationId - 台账号
     * @returns 更新后的投递条
     */
    retryDelivery(id: string, channel: DeliveryChannel, operationId: string): Promise<DeliveryRecord>;
    /** 渠道与整体状态（缺配置如实报不可用，不假成功）。 */
    status(): PostboxStatus;
    /** 默认偏好（UI 初始化用；写回要显式 setPreferences）。 */
    static defaults(): PostboxPreferences;
}
