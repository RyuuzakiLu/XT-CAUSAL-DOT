import type { DeliveryChannel, DndWindow, PostboxEvent, PostboxKind, PostboxPreferences, PostboxSeverity } from './types.ts';
/** 事件类别的默认重要程度。 */
export declare function defaultSeverityOf(kind: PostboxKind): PostboxSeverity;
/** 该类别是否需要用户介入（决定是否"值得打断"）。 */
export declare function needsAttention(kind: PostboxKind): boolean;
/**
 * 判断某一时刻是否落在免打扰窗口内。
 * 为什么不用 Date#getHours：窗口自带 IANA 时区，服务器可能跑在别的时区上。
 * @param dnd - 免打扰窗口
 * @param at - 毫秒时间戳
 * @returns 在窗口内为 true（窗口关闭时恒 false）
 */
export declare function inDndWindow(dnd: DndWindow, at: number): boolean;
/**
 * 取某时区下"当天第几分钟"。
 * 时区名非法时返回 undefined（调用方按"不在窗口内"处理，不抛——一条坏偏好
 * 不该让整条通知链崩掉）。
 * @param timezone - IANA 时区名
 * @param at - 毫秒时间戳
 * @returns 0..1439，或 undefined
 */
export declare function minuteOfDay(timezone: string, at: number): number | undefined;
/** 事件是否已过期（只影响主动弹出与默认列表，不影响是否可查）。 */
export declare function isExpired(event: PostboxEvent, at: number): boolean;
/**
 * 某渠道此刻应当投递还是抑制。
 * 抑制不是失败：免打扰/渠道关闭都记 suppressed，便于事后解释"为什么没弹"。
 * @param event - 事件
 * @param channel - 渠道
 * @param preferences - 当前偏好
 * @param at - 毫秒时间戳
 * @returns 抑制原因；可投递时返回 undefined
 */
export declare function suppressionOf(event: PostboxEvent, channel: DeliveryChannel, preferences: PostboxPreferences, at: number): string | undefined;
/**
 * 计算"下一次可投递时间"的最小间隔是否已过（防刷屏）。
 * @param lastAt - 同一渠道上次成功投递时间；可空
 * @param minIntervalMs - 最小间隔
 * @param at - 当前时间
 * @returns 允许投递时为 true
 */
export declare function respectsMinInterval(lastAt: number | undefined, minIntervalMs: number, at: number): boolean;
/**
 * 生成事件 id。
 * 为什么不用随机数：可读、可排序、能一眼看出是邮匣产生；同 input 可复现，便于测试。
 * @param seq - 该事件的序号（全局单调递增，天然唯一）
 * @returns `postbox-<seq>` 形态的稳定 id
 */
export declare function eventIdOf(seq: number): string;
/** 一条事件是否在默认列表中可见（归档/过期不算失败，只是不默认显示）。 */
export declare function visibleInList(event: PostboxEvent, at: number, includeArchived: boolean): boolean;
