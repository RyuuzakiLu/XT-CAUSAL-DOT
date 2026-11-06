import { z } from 'zod';
/** 事件类别：决定默认重要程度与界面提示形态。 */
export type PostboxKind = 'work-completed' | 'work-failed' | 'work-blocked' | 'work-waiting-approval' | 'reminder' | 'info';
/** 全部事件类别；用于校验与列表筛选。 */
export declare const POSTBOX_KINDS: readonly PostboxKind[];
/** 重要程度：界面据此决定是否打断。 */
export type PostboxSeverity = 'normal' | 'important' | 'urgent';
/** 全部重要程度取值。 */
export declare const POSTBOX_SEVERITIES: readonly PostboxSeverity[];
/**
 * 投递渠道。
 *
 * `native` = **设备/宿主呈现渠道**（不特指 Android）：Android 系统通知、Web Notification、
 *   前台浮卡提示都算，谁真正把这条呈现给用户就回写谁。⚠️ 回执语义是"呈现层已接受"，
 *   不是"用户已读"——已读走独立的 read 方法，两条事实不许合并。
 * `feishu` = 外部适配（可配可不配）。
 * `wechat` = 明确不可用（不造假接口）。
 */
export type DeliveryChannel = 'native' | 'feishu' | 'wechat';
/** 全部渠道取值。 */
export declare const DELIVERY_CHANNELS: readonly DeliveryChannel[];
/** 一次投递的状态。 */
export type DeliveryStatus = 
/** 已排队；尚未尝试。 */
'pending'
/** 已交给渠道但未拿到确认（例如已入系统通知队列）。 */
 | 'sent'
/** 渠道确认送达（Android 弹出成功后回写 / 飞书接口返回 ok）。 */
 | 'delivered'
/** 明确失败，带原因。 */
 | 'failed'
/** 免打扰或被偏好关闭，主动抑制；不是失败。 */
 | 'suppressed';
/** 一条投递记录。 */
export interface DeliveryRecord {
    readonly eventId: string;
    readonly channel: DeliveryChannel;
    readonly status: DeliveryStatus;
    /** 尝试次数；只在真正调用渠道时 +1，抑制不算尝试。 */
    readonly attempts: number;
    readonly updatedAt: number;
    /** 失败原因/抑制原因；只在 failed/suppressed 时出现。 */
    readonly detail?: string | undefined;
    /** 渠道侧稳定消息标识（有则记，不伪造）。 */
    readonly externalId?: string | undefined;
}
/** 一条星邮匣事件（持久记录）。 */
export interface PostboxEvent {
    readonly id: string;
    /** 单调递增序号：客户端按它拉增量，比时间戳可靠。 */
    readonly seq: number;
    readonly kind: PostboxKind;
    readonly severity: PostboxSeverity;
    readonly title: string;
    readonly body?: string | undefined;
    /** 关联工作；提醒类可无。 */
    readonly workId?: string | undefined;
    /** 关联 DSH 会话（字符串引用，不复制会话内容）。 */
    readonly sessionId?: string | undefined;
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly read: boolean;
    readonly archived: boolean;
    /** 到期时间（提醒）；过期后不再主动弹出，但记录仍在。 */
    readonly dueAt?: number | undefined;
    /** 事件有效期；过期后列表可隐藏但仍可查。 */
    readonly expiresAt?: number | undefined;
    /** 产生来源的稳定码（`work` / `schedule` / `user` …），不比较中文。 */
    readonly origin: string;
    /** 创建时的去重键；同键只产生一条事件。 */
    readonly dedupeKey: string;
}
/** 免打扰时间窗；跨越午夜时 startMinute > endMinute 合法。 */
export interface DndWindow {
    readonly enabled: boolean;
    /** 一天内起始分钟（0..1439），含。 */
    readonly startMinute: number;
    /** 一天内结束分钟（0..1439），不含。 */
    readonly endMinute: number;
    /** IANA 时区名；窗口按此时区解释，不是服务器本地时区。 */
    readonly timezone: string;
    /** 临时免打扰用绝对结束时间，不把“一小时”误存成每天循环。 */
    readonly until?: number | undefined;
    /** 老版本默认让紧急件穿透；明确临时免打扰可关闭穿透。 */
    readonly allowUrgent?: boolean | undefined;
}
/** 渠道偏好。 */
export interface PostboxPreferences {
    readonly dnd: DndWindow;
    /** 只控制主动打扰，信件本身仍入星邮匣；旧偏好缺省时全部开启。 */
    readonly events?: {
        readonly completed: boolean;
        readonly attention: boolean;
        readonly failed: boolean;
    } | undefined;
    readonly channels: {
        /** 设备/宿主呈现渠道（Android 通知 / Web Notification / 前台浮卡）。 */
        readonly native: boolean;
        /** 飞书外部适配。 */
        readonly feishu: boolean;
    };
    readonly feishu: {
        /** 是否真正启用（与 channels.feishu 同时为真才算）。 */
        readonly enabled: boolean;
        /** 目标（群或用户标识），由配置给定，不由模型传。 */
        readonly target?: string | undefined;
    };
    readonly native: {
        /** 两次系统通知的最小间隔，避免刷屏；0 = 不限。 */
        readonly minIntervalMs: number;
        /**
         * 通知最大新鲜度（毫秒）：超过这个岁数的事件不再主动弹。
         *
         * 为什么要有：用户可能整晚关掉通知（或权限被系统撤销），第二天打开时
         * 不该被十几条陈年旧信淹没。旧件仍在 list 里可查，只是不再"打断"。
         * 0 = 不限（明确想要全量补发的场景）。
         */
        readonly maxAgeMs: number;
    };
}
/** 偏好 + 水位一起放在域全局槽：两者总是一起读、一起写。 */
export interface PostboxGlobal {
    /** 已分配的最大事件序号。 */
    readonly seq: number;
    readonly preferences: PostboxPreferences;
}
/** 操作台账记录：同一 operationId 重放返回首次结果，不重复写。 */
export interface OperationRecord {
    readonly operationId: string;
    /** 稳定动作码，例如 `publish` / `read` / `archive` / `delivery-receipt`。 */
    readonly action: string;
    /** 首次执行结果的 JSON 载荷（不含密钥）。 */
    readonly result: string;
    readonly at: number;
}
/** 默认偏好：免打扰关、渠道关（未配置不得假装已开）。 */
export declare const DEFAULT_PREFERENCES: PostboxPreferences;
/** 默认全局水位。 */
export declare const DEFAULT_GLOBAL: PostboxGlobal;
/** 事件记录 schema。 */
export declare const eventSchema: z.ZodObject<{
    id: z.ZodString;
    seq: z.ZodNumber;
    kind: z.ZodEnum<{
        "work-completed": "work-completed";
        "work-failed": "work-failed";
        "work-blocked": "work-blocked";
        "work-waiting-approval": "work-waiting-approval";
        reminder: "reminder";
        info: "info";
    }>;
    severity: z.ZodEnum<{
        normal: "normal";
        important: "important";
        urgent: "urgent";
    }>;
    title: z.ZodString;
    body: z.ZodOptional<z.ZodString>;
    workId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodNumber;
    updatedAt: z.ZodNumber;
    read: z.ZodBoolean;
    archived: z.ZodBoolean;
    dueAt: z.ZodOptional<z.ZodNumber>;
    expiresAt: z.ZodOptional<z.ZodNumber>;
    origin: z.ZodString;
    dedupeKey: z.ZodString;
}, z.core.$strip>;
/** 投递记录 schema。 */
export declare const deliverySchema: z.ZodObject<{
    eventId: z.ZodString;
    channel: z.ZodEnum<{
        native: "native";
        feishu: "feishu";
        wechat: "wechat";
    }>;
    status: z.ZodEnum<{
        pending: "pending";
        sent: "sent";
        delivered: "delivered";
        failed: "failed";
        suppressed: "suppressed";
    }>;
    attempts: z.ZodNumber;
    updatedAt: z.ZodNumber;
    detail: z.ZodOptional<z.ZodString>;
    externalId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** 操作台账 schema。 */
export declare const operationSchema: z.ZodObject<{
    operationId: z.ZodString;
    action: z.ZodString;
    result: z.ZodString;
    at: z.ZodNumber;
}, z.core.$strip>;
/** 全局槽 schema（跨域共用一个水位与偏好）。 */
export declare const globalSchema: z.ZodObject<{
    seq: z.ZodNumber;
    preferences: z.ZodObject<{
        dnd: z.ZodObject<{
            enabled: z.ZodBoolean;
            startMinute: z.ZodNumber;
            endMinute: z.ZodNumber;
            timezone: z.ZodString;
            until: z.ZodOptional<z.ZodNumber>;
            allowUrgent: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>;
        events: z.ZodOptional<z.ZodObject<{
            completed: z.ZodBoolean;
            attention: z.ZodBoolean;
            failed: z.ZodBoolean;
        }, z.core.$strip>>;
        channels: z.ZodObject<{
            native: z.ZodBoolean;
            feishu: z.ZodBoolean;
        }, z.core.$strip>;
        feishu: z.ZodObject<{
            enabled: z.ZodBoolean;
            target: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
        native: z.ZodObject<{
            minIntervalMs: z.ZodNumber;
            maxAgeMs: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>;
    }, z.core.$strip>;
}, z.core.$strip>;
/** 投递记录在表里的键（同一事件同一渠道只允许一条）。 */
export declare function deliveryKey(eventId: string, channel: DeliveryChannel): string;
/**
 * 面向前端/Android 的事件视图：域里的事件本体 + 它的投递条。
 *
 * 为什么另立一个形状而不是往持久事件里塞 deliveries：
 * 投递记录在另一张表、且会随每次回执变化；把它内联进事件会导致"改一条投递 =
 * 重写整条事件"，也让历史事件的形状随渠道增减而变。视图是**读时投影**，不是第二份真相。
 */
export interface PostboxEventView extends PostboxEvent {
    /** 该事件各渠道的投递记录（按渠道名排序，已建条的全在这里）。 */
    readonly deliveries: readonly DeliveryRecord[];
}
/** list 请求。 */
export interface DotPostboxListRequest {
    readonly cursor?: string | undefined;
    readonly limit?: number | undefined;
    readonly unreadOnly?: boolean | undefined;
    readonly kinds?: readonly PostboxKind[] | undefined;
    readonly includeArchived?: boolean | undefined;
}
/** list 结果。 */
export interface DotPostboxListValue {
    readonly items: readonly PostboxEventView[];
    readonly nextCursor: string | null;
    readonly serverTime: number;
}
/** pending 请求（Android 前台服务轮询）。 */
export interface DotPostboxPendingRequest {
    readonly since?: string | undefined;
    readonly limit?: number | undefined;
}
/** pending 结果。 */
export interface DotPostboxPendingValue {
    readonly items: readonly PostboxEventView[];
    /** 只推进到本页实际扫过的最后一条事件（不是全局水位）。 */
    readonly cursor: string;
    readonly serverTime: number;
    readonly suppressed: number;
}
/** get 请求。 */
export interface DotPostboxGetRequest {
    readonly id: string;
}
/** 单条命令请求（已读/归档）。 */
export interface DotPostboxIdCommandRequest {
    readonly id: string;
    readonly operationId: string;
}
/** 回执请求（Android 弹完通知 / 飞书确认后回写）。 */
export interface DotPostboxReceiptRequest {
    readonly id: string;
    readonly channel: DeliveryChannel;
    readonly status: 'sent' | 'delivered' | 'failed' | 'suppressed';
    readonly operationId: string;
    readonly detail?: string | undefined;
}
/** 重试请求。 */
export interface DotPostboxRetryRequest {
    readonly id: string;
    readonly channel: DeliveryChannel;
    readonly operationId: string;
}
/** 偏好写入请求。 */
export interface DotPostboxSetPreferencesRequest {
    readonly preferences: PostboxPreferences;
    readonly rev?: number | undefined;
    readonly operationId: string;
}
/** 偏好读取结果。 */
export interface DotPostboxPreferencesValue {
    /** 旧宿主没有该标记，客户端不能把未生效的扩展字段报成保存成功。 */
    readonly personalReminders?: boolean | undefined;
    readonly preferences: PostboxPreferences;
    readonly rev: number;
}
/** status 结果。 */
export interface DotPostboxStatusValue {
    readonly channels: {
        readonly native: {
            readonly available: boolean;
            readonly reason?: string | undefined;
        };
        readonly feishu: {
            readonly configured: boolean;
            readonly reason?: string | undefined;
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
/**
 * watch 帧。
 *
 * `ready` 是开流第一帧（协议层面没有开流确认帧，不推这一帧客户端就分不清
 * "订阅成功但暂无变化" 与 "流根本没起来"）。`seq` 是当前水位，客户端可据此拉首次快照。
 */
export type DotPostboxWatchFrame = {
    readonly type: 'ready';
    readonly seq: number;
    readonly eventIds: readonly string[];
} | {
    readonly type: 'changed';
    readonly seq: number;
    readonly eventIds: readonly string[];
};
