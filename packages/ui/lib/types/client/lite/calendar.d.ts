export declare const CAL_ZONE = "Asia/Shanghai";
export declare const HUES = 5;
export declare const MAX_DOTS = 3;
export declare const WEEKDAYS: readonly ["一", "二", "三", "四", "五", "六", "日"];
export interface CalEvent {
    id: string;
    title: string;
    start: string;
    end: string;
    location?: string;
    status?: string;
    remindAt?: string;
}
export interface MonthRef {
    year: number;
    month: number;
}
export interface DayCell {
    key: string;
    day: number;
    inMonth: boolean;
}
/** 一个时刻在北京时间是哪一天（YYYY-MM-DD）。解析不了返回 ''。 */
export declare function dayKeyOf(value: string | number): string;
/** YYYY-MM-DD 在北京时间的零点（UTC 毫秒）。 */
export declare function dayStartMs(key: string): number;
/** 北京时间的「这个月」。 */
export declare function monthOf(now: number): MonthRef;
export declare function shiftMonth(ref: MonthRef, delta: number): MonthRef;
export declare const monthLabel: (ref: MonthRef) => string;
export declare const monthKey: (ref: MonthRef) => string;
/** 月格子：周一开头，6 行 × 7 天。 */
export declare function monthGrid(ref: MonthRef): DayCell[];
/** 这个月格子要取的时间范围 [from, to)，带 +08:00 偏移（接口要求带偏移，最多 62 天）。 */
export declare function gridRange(ref: MonthRef): {
    from: string;
    to: string;
};
/** 日程按北京时间分天：跨天的日程在它覆盖的每一天都出现；已取消的不显示；每天按开始时间排。 */
export declare function groupByDay(events: readonly CalEvent[]): Map<string, CalEvent[]>;
/** 目前只有日程数据，统一蓝色；不通过 ID 猜测类别。 */
export declare function hueOf(_event: Pick<CalEvent, 'id'>): number;
/** 一天下面的小圆点：最多 3 个，按当天顺序取前 3 条的颜色。 */
export declare function dotsOf(list: readonly CalEvent[] | undefined): number[];
/** 某一天里这条日程的时间：「09:00–10:00」；整天占满为「全天」；跨天的截到当天（「00:00–10:00」「22:00–24:00」）。 */
export declare function timeLabel(event: CalEvent, key: string): string;
/** 「11月2日 周一」 */
export declare function dayLabel(key: string): string;
export declare const EVENTS_PATH = "/dot-zhixu/api/events";
/** 取这个月格子（42 天）的日程。失败抛错（带服务端的中文原因），不回空列表冒充「没有安排」。 */
export declare function loadMonthEvents(ref: MonthRef, fetchImpl?: typeof fetch): Promise<{
    items: CalEvent[];
    truncated: boolean;
}>;
export interface CalTask {
    id: string;
    version: number;
    title: string;
    status: 'pending' | 'in_progress' | 'done' | 'canceled';
    dueAt: string;
    remindAt: string;
}
export interface CalTasks {
    items: CalTask[];
    truncated: boolean;
}
export declare function loadCalendarTasks(fetchImpl?: typeof fetch): Promise<CalTasks>;
export declare const createCalendarTask: (title: string, operationId: string, fetchImpl?: typeof fetch) => Promise<CalTask>;
export declare const setCalendarTaskStatus: (task: CalTask, status: "done" | "pending", operationId: string, fetchImpl?: typeof fetch) => Promise<CalTask>;
/** 只标真实截止日期，不根据标题或 ID 猜分类。 */
export declare function taskDots(tasks: readonly CalTask[], day: string, now: number): ('due' | 'done')[];
