/* ================================================================
   简洁版 · 日历数据（2026-11-01 calendar）
   ◍ 数据：本账号在知序里的日程，经 /dot-zhixu/api/events 只读取（packages/zhixu/lib/routes.js）。
     浏览器不碰知序钥匙；账号由登录门认定，界面传不了账号。
   ◍ 时区：一律按北京时间（Asia/Shanghai，固定 +08:00，没有夏令时）分天，
     不跟浏览器所在时区走——知序的日程、提醒都按北京时间记。
   ◍ 月格子：周一开头，固定 6 行 42 天（含上下月补位），一次把 42 天的日程取回来。
   ◍ 颜色：当前接口仅返回日程，统一使用蓝色；待办和提醒的分类颜色等真实数据接入后再显示。
     每天最多 3 个点。
   ================================================================ */
export const CAL_ZONE = 'Asia/Shanghai';
const OFFSET_MS = 8 * 3_600_000;
const DAY_MS = 86_400_000;
export const HUES = 5;
export const MAX_DOTS = 3;
export const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const pad = (n) => String(n).padStart(2, '0');
/** 一个时刻在北京时间是哪一天（YYYY-MM-DD）。解析不了返回 ''。 */
export function dayKeyOf(value) {
    const at = typeof value === 'number' ? value : Date.parse(value);
    if (!Number.isFinite(at))
        return '';
    return new Date(at + OFFSET_MS).toISOString().slice(0, 10);
}
/** YYYY-MM-DD 在北京时间的零点（UTC 毫秒）。 */
export function dayStartMs(key) { return Date.parse(`${key}T00:00:00+08:00`); }
const keyPlus = (key, days) => dayKeyOf(dayStartMs(key) + days * DAY_MS);
/** 北京时间的「这个月」。 */
export function monthOf(now) {
    const key = dayKeyOf(now);
    return { year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) };
}
export function shiftMonth(ref, delta) {
    const index = ref.year * 12 + (ref.month - 1) + delta;
    return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}
export const monthLabel = (ref) => `${ref.year}年${ref.month}月`;
export const monthKey = (ref) => `${ref.year}-${pad(ref.month)}`;
/** 月格子：周一开头，6 行 × 7 天。 */
export function monthGrid(ref) {
    const first = `${ref.year}-${pad(ref.month)}-01`;
    /* getUTCDay：0=周日。北京零点 +8h 落回同一天的 UTC 零点，取星期不会错天。 */
    const weekday = new Date(dayStartMs(first) + OFFSET_MS).getUTCDay();
    const lead = (weekday + 6) % 7;
    const start = keyPlus(first, -lead);
    const cells = [];
    for (let i = 0; i < 42; i += 1) {
        const key = keyPlus(start, i);
        cells.push({ key, day: Number(key.slice(8, 10)), inMonth: key.slice(0, 7) === monthKey(ref) });
    }
    return cells;
}
/** 这个月格子要取的时间范围 [from, to)，带 +08:00 偏移（接口要求带偏移，最多 62 天）。 */
export function gridRange(ref) {
    const cells = monthGrid(ref);
    return { from: `${cells[0].key}T00:00:00+08:00`, to: `${keyPlus(cells[cells.length - 1].key, 1)}T00:00:00+08:00` };
}
/** 日程按北京时间分天：跨天的日程在它覆盖的每一天都出现；已取消的不显示；每天按开始时间排。 */
export function groupByDay(events) {
    const days = new Map();
    for (const event of events) {
        if (event.status === 'canceled')
            continue;
        const start = Date.parse(event.start);
        if (!Number.isFinite(start))
            continue;
        const endRaw = Date.parse(event.end);
        const end = Number.isFinite(endRaw) && endRaw > start ? endRaw : start;
        let key = dayKeyOf(start);
        /* 结束时刻正好是零点的，不算进那一天（例如 10:00–24:00）。最多铺 62 天防失控。 */
        const lastKey = dayKeyOf(end > start ? end - 1 : end);
        for (let guard = 0; guard < 62; guard += 1) {
            const list = days.get(key) ?? [];
            list.push(event);
            days.set(key, list);
            if (key >= lastKey)
                break;
            key = keyPlus(key, 1);
        }
    }
    for (const list of days.values())
        list.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.title.localeCompare(b.title));
    return days;
}
/** 目前只有日程数据，统一蓝色；不通过 ID 猜测类别。 */
export function hueOf(_event) { return 0; }
/** 一天下面的小圆点：最多 3 个，按当天顺序取前 3 条的颜色。 */
export function dotsOf(list) {
    return (list ?? []).slice(0, MAX_DOTS).map(hueOf);
}
const hm = (ms) => { const d = new Date(ms + OFFSET_MS); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
/** 某一天里这条日程的时间：「09:00–10:00」；整天占满为「全天」；跨天的截到当天（「00:00–10:00」「22:00–24:00」）。 */
export function timeLabel(event, key) {
    const dayStart = dayStartMs(key), dayEnd = dayStart + DAY_MS;
    const start = Date.parse(event.start);
    const endRaw = Date.parse(event.end);
    const end = Number.isFinite(endRaw) && endRaw > start ? endRaw : start;
    const a = Math.max(start, dayStart), b = Math.min(end, dayEnd);
    if (a === dayStart && b === dayEnd)
        return '全天';
    if (b === a)
        return hm(a);
    return `${hm(a)}–${b === dayEnd ? '24:00' : hm(b)}`;
}
/** 「11月2日 周一」 */
export function dayLabel(key) {
    const weekday = new Date(dayStartMs(key) + OFFSET_MS).getUTCDay();
    return `${Number(key.slice(5, 7))}月${Number(key.slice(8, 10))}日 周${WEEKDAYS[(weekday + 6) % 7]}`;
}
export const EVENTS_PATH = '/dot-zhixu/api/events';
/** 取这个月格子（42 天）的日程。失败抛错（带服务端的中文原因），不回空列表冒充「没有安排」。 */
export async function loadMonthEvents(ref, fetchImpl = fetch) {
    const { from, to } = gridRange(ref);
    const url = `${EVENTS_PATH}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const response = await fetchImpl(url, { credentials: 'same-origin', headers: { accept: 'application/json' }, cache: 'no-store' });
    const body = await responseJson(response, '日程');
    if (!Array.isArray(body?.items))
        throw new Error('日程接口返回的数据格式不对');
    const items = body.items
        .filter((item) => item && typeof item.id === 'string' && typeof item.start === 'string')
        .map((item) => ({
        id: item.id, title: String(item.title ?? '') || '（无标题）', start: item.start, end: String(item.end ?? item.start),
        ...(item.location ? { location: String(item.location) } : {}),
        ...(item.status ? { status: String(item.status) } : {}),
        ...(item.remindAt ? { remindAt: String(item.remindAt) } : {}),
    }));
    return { items, truncated: body.truncated === true };
}
/** 不把登录重定向后的 HTML 当作「HTTP 200 的日程错误」。 */
async function responseJson(response, label) {
    if (response.redirected && /\/_dot\/login(?:[/?#]|$)/.test(response.url))
        throw new Error('登录已失效，请重新登录');
    const text = await response.text();
    let body;
    try {
        body = JSON.parse(text);
    }
    catch {
        if (response.status === 401 || response.status === 403)
            throw new Error('登录已失效，请重新登录');
        if (/^\s*</.test(text))
            throw new Error('服务返回了网页，请检查登录状态或稍后重试');
        throw new Error(`读取${label}失败（${response.status}）`);
    }
    if (!response.ok)
        throw new Error(typeof body?.error === 'string' ? body.error : `读取${label}失败（${response.status}）`);
    return body;
}
function taskOf(value) {
    if (!value || typeof value.id !== 'string' || !Number.isInteger(value.version) || typeof value.title !== 'string' || !['pending', 'in_progress', 'done', 'canceled'].includes(value.status))
        return undefined;
    return { id: value.id, version: value.version, title: value.title, status: value.status, dueAt: String(value.dueAt ?? ''), remindAt: String(value.remindAt ?? '') };
}
export async function loadCalendarTasks(fetchImpl = fetch) {
    const response = await fetchImpl('/dot-zhixu/api/tasks', { credentials: 'same-origin', headers: { accept: 'application/json' }, cache: 'no-store' });
    const body = await responseJson(response, '待办');
    if (!Array.isArray(body?.items))
        throw new Error('待办接口返回的数据格式不对');
    return { items: body.items.map(taskOf).filter((value) => Boolean(value)), truncated: body.truncated === true };
}
async function mutateTask(path, body, fetchImpl = fetch) {
    const response = await fetchImpl(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
    const data = await responseJson(response, '待办');
    const item = taskOf(data.item);
    if (!item)
        throw new Error('待办接口返回的数据格式不对');
    return item;
}
export const createCalendarTask = (title, operationId, fetchImpl) => mutateTask('/dot-zhixu/api/tasks', { title, operationId }, fetchImpl);
export const setCalendarTaskStatus = (task, status, operationId, fetchImpl) => mutateTask('/dot-zhixu/api/tasks/status', { id: task.id, expectedVersion: task.version, status, operationId }, fetchImpl);
/** 只标真实截止日期，不根据标题或 ID 猜分类。 */
export function taskDots(tasks, day, now) {
    return tasks.flatMap(task => {
        if (!task.dueAt || dayKeyOf(task.dueAt) !== day || task.status === 'canceled')
            return [];
        if (task.status === 'done')
            return ['done'];
        return Date.parse(task.dueAt) - now <= 86_400_000 ? ['due'] : [];
    });
}
