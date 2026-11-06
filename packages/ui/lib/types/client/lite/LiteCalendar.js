import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/* ================================================================
   简洁版 · 日程页正文（2026-11-01 calendar）
   ◍ 月格子（周一开头）：有日程的日子下面最多 3 个小圆点，颜色按日程稳定分配；今天用强调色圈出；
     点一天，下面列出这天的日程（时间、标题、地点、提醒）；没有就写「这天没有安排」。
   ◍ 只读：数据来自 calendar.ts 的 loadMonthEvents（/dot-zhixu/api/events）。这里没有任何写入口；
     要加/改日程，在对话里跟 Xtcausal dot 说。
   ◍ 顶栏由 LiteShell 的 CalendarPage 给，这里只管正文，方便单测。
   ================================================================ */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { WEEKDAYS, dayKeyOf, dayLabel, dotsOf, groupByDay, hueOf, loadMonthEvents, monthGrid, monthKey, monthLabel, monthOf, shiftMonth, timeLabel } from "./calendar.js";
import { CalendarTasks } from "./CalendarTasks.js";
import { loadCalendarTasks, taskDots } from "./calendar.js";
import css from './lite.module.css';
import taskCss from './calendar-todo.module.css';
export function LiteCalendar({ monthCache, now = Date.now(), load = loadMonthEvents, loadTasks = loadCalendarTasks }) {
    const today = dayKeyOf(now);
    const [month, setMonth] = useState(() => monthOf(now));
    const [selected, setSelected] = useState(today);
    const [cache, setCache] = useState(() => ({ ...monthCache }));
    const [attempt, setAttempt] = useState(0);
    const [taskState, setTaskState] = useState({ status: 'loading' });
    const [taskAttempt, setTaskAttempt] = useState(0);
    useEffect(() => {
        let alive = true;
        setTaskState({ status: 'loading' });
        loadTasks().then(result => { if (alive)
            setTaskState({ status: 'ready', ...result }); }).catch(cause => { if (alive)
            setTaskState({ status: 'error', message: cause instanceof Error ? cause.message : String(cause) }); });
        return () => { alive = false; };
    }, [taskAttempt]);
    const key = monthKey(month);
    const state = cache[key] ?? { status: 'loading' };
    const grid = useRef(null);
    const swipe = useRef(null);
    const agenda = useRef(null);
    const last = useRef({ key, selected });
    useLayoutEffect(() => {
        const previous = last.current;
        last.current = { key, selected };
        if (previous.selected === selected && previous.key === key)
            return;
        if (!grid.current?.animate || grid.current.closest('[data-reduced-motion="true"]') || matchMedia('(prefers-reduced-motion: reduce)').matches)
            return;
        const flip = previous.key !== key ? grid.current.animate([
            { transform: `translateX(${key > previous.key ? 30 : -30}px)`, opacity: .45 },
            { transform: 'translateX(0)', opacity: 1 },
        ], { duration: 560, easing: 'cubic-bezier(.28,.55,.26,1)' }) : undefined;
        const changeDay = agenda.current?.animate([
            { transform: 'translateY(5px)', opacity: .48 }, { transform: 'translateY(0)', opacity: 1 },
        ], { duration: 380, easing: 'ease-out' });
        return () => { flip?.cancel(); changeDay?.cancel(); };
    }, [key, selected]);
    useEffect(() => {
        let alive = true;
        setCache(current => ({ ...current, [key]: current[key]?.status === 'ready' ? current[key] : { status: 'loading' } }));
        load(month)
            .then(result => {
            if (!alive)
                return;
            const ready = { status: 'ready', ...result };
            if (monthCache)
                monthCache[key] = ready;
            setCache(current => ({ ...current, [key]: ready }));
        })
            .catch(cause => { if (alive)
            setCache(current => ({ ...current, [key]: { status: 'error', message: cause instanceof Error ? cause.message : String(cause) } })); });
        return () => { alive = false; };
    }, [key, attempt]);
    const cells = useMemo(() => monthGrid(month), [key]);
    const days = useMemo(() => groupByDay(state.status === 'ready' ? state.items : []), [state]);
    const move = (delta) => {
        const next = shiftMonth(month, delta);
        setMonth(next);
        /* 换月后默认选那个月的 1 号；回到本月选今天。 */
        setSelected(monthKey(next) === today.slice(0, 7) ? today : `${monthKey(next)}-01`);
    };
    const startSwipe = (event) => {
        const touch = event.touches[0];
        swipe.current = event.touches.length === 1 && touch
            ? { id: touch.identifier, x: touch.clientX, y: touch.clientY } : null;
    };
    const endSwipe = (event) => {
        const start = swipe.current;
        swipe.current = null;
        const touch = event.changedTouches[0];
        if (!start || !touch || event.touches.length || touch.identifier !== start.id)
            return;
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.4)
            return;
        event.preventDefault(); // 翻月后不再把手指落点当成点选日期。
        move(dx < 0 ? 1 : -1);
    };
    const pick = (cellKey) => {
        setSelected(cellKey);
        if (cellKey.slice(0, 7) !== key)
            setMonth({ year: Number(cellKey.slice(0, 4)), month: Number(cellKey.slice(5, 7)) });
    };
    const list = days.get(selected) ?? [];
    const tasks = taskState.status === 'ready' ? taskState.items : [];
    const reminders = [
        ...(state.status === 'ready' ? state.items.filter(event => event.status !== 'canceled' && event.remindAt && dayKeyOf(event.remindAt) === selected).map(event => ({ id: `e:${event.id}`, title: event.title, at: event.remindAt })) : []),
        ...tasks.filter(task => task.status !== 'done' && task.status !== 'canceled' && task.remindAt && dayKeyOf(task.remindAt) === selected).map(task => ({ id: `t:${task.id}`, title: task.title, at: task.remindAt })),
    ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    /* 本月（不含上下月补位）有几项安排：跨天的只算一项。 */
    const monthCount = useMemo(() => { const ids = new Set(); for (const [k, v] of days)
        if (k.startsWith(key))
            for (const e of v)
                ids.add(e.id); return ids.size; }, [days, key]);
    return _jsxs("div", { className: css.scroll, "data-lite-calendar": "", "data-month": key, children: [_jsxs("div", { className: taskCss.monthCard, children: [_jsxs("div", { className: css.calHead, children: [_jsxs("div", { className: css.calTitle, children: [_jsx("b", { children: monthLabel(month) }), _jsx("span", { role: "status", children: state.status === 'loading' ? '正在读取…' : state.status === 'error' ? '没读到' : monthCount ? `${monthCount} 项安排` : '本月没有安排' })] }), _jsx("button", { className: css.icon, "aria-label": "\u4E0A\u4E2A\u6708", onClick: () => move(-1), children: _jsx(Arrow, { dir: "left" }) }), _jsx("button", { className: css.icon, "aria-label": "\u4E0B\u4E2A\u6708", onClick: () => move(1), children: _jsx(Arrow, { dir: "right" }) })] }), _jsx("div", { className: css.calWeek, "aria-hidden": "true", children: WEEKDAYS.map(day => _jsx("span", { children: day }, day)) }), _jsx("div", { ref: grid, className: css.calGrid, role: "grid", "aria-label": monthLabel(month), onTouchStart: startSwipe, onTouchEnd: endSwipe, onTouchCancel: () => { swipe.current = null; }, children: cells.map(cell => {
                            const dots = dotsOf(days.get(cell.key));
                            const reminderCount = (state.status === 'ready' ? state.items.filter(event => event.status !== 'canceled' && event.remindAt && dayKeyOf(event.remindAt) === cell.key).length : 0) + tasks.filter(task => task.status !== 'done' && task.status !== 'canceled' && task.remindAt && dayKeyOf(task.remindAt) === cell.key).length;
                            const taskMarks = [...taskDots(tasks, cell.key, now), ...Array(reminderCount).fill('reminder')].slice(0, Math.max(0, 3 - dots.length));
                            const count = days.get(cell.key)?.length ?? 0;
                            return _jsxs("button", { role: "gridcell", className: css.calDay, "data-day": cell.key, "data-out": cell.inMonth ? undefined : '', "data-today": cell.key === today ? '' : undefined, "aria-selected": cell.key === selected, "aria-label": `${dayLabel(cell.key)}${cell.key === today ? '，今天' : ''}${count ? `，${count} 项安排` : ''}`, onClick: () => pick(cell.key), children: [_jsx("span", { className: css.calNum, children: cell.day }), _jsxs("span", { className: css.calDots, "aria-hidden": "true", children: [dots.map((hue, index) => _jsx("i", { "data-hue": hue }, index)), taskMarks.map((tone, index) => _jsx("i", { className: taskCss.dot, "data-tone": tone }, `t${index}`))] })] }, cell.key);
                        }) }), _jsxs("div", { className: taskCss.legend, children: [_jsxs("span", { children: [_jsx("i", {}), "\u65E5\u7A0B"] }), _jsxs("span", { children: [_jsx("i", { "data-tone": "due" }), "\u5F85\u529E\u5FEB\u5230\u671F"] }), _jsxs("span", { children: [_jsx("i", { "data-tone": "reminder" }), "\u63D0\u9192"] }), _jsxs("span", { children: [_jsx("i", { "data-tone": "done" }), "\u5DF2\u5B8C\u6210"] })] })] }), reminders.length > 0 && _jsxs("section", { className: taskCss.reminders, "aria-label": "\u8FD9\u5929\u7684\u63D0\u9192", children: [_jsx("h2", { children: "\u63D0\u9192" }), reminders.map(item => _jsxs("p", { children: [remindLabel(item.at, selected), " \u00B7 ", item.title] }, item.id))] }), _jsxs("section", { ref: agenda, className: css.calList, "aria-label": `${dayLabel(selected)} 的安排`, "data-lite-day": selected, children: [_jsx("header", { className: css.groupHead, children: _jsxs("h2", { children: [dayLabel(selected), selected === today ? ' · 今天' : ''] }) }), state.status === 'error'
                        ? _jsxs("div", { className: css.calError, role: "alert", children: [_jsxs("span", { children: ["\u8BFB\u4E0D\u5230\u65E5\u7A0B\uFF1A", state.message] }), _jsx("button", { className: css.textButton, onClick: () => setAttempt(n => n + 1), children: "\u91CD\u8BD5" })] })
                        : state.status === 'loading' && !list.length
                            ? _jsx("p", { className: css.hint, children: "\u6B63\u5728\u8BFB\u53D6\u2026" })
                            : !list.length
                                ? _jsx("p", { className: css.calEmpty, children: "\u8FD9\u5929\u6CA1\u6709\u5B89\u6392" })
                                : _jsx("ol", { className: css.calEvents, children: list.map(event => _jsxs("li", { className: css.calEvent, "data-hue": hueOf(event), children: [_jsx("time", { children: timeLabel(event, selected) }), _jsxs("span", { className: css.lineText, children: [_jsx("b", { children: event.title }), (event.location || event.remindAt) && _jsx("span", { children: [event.location, event.remindAt ? `提醒 ${remindLabel(event.remindAt, selected)}` : ''].filter(Boolean).join(' · ') })] })] }, event.id)) }), state.status === 'ready' && state.truncated && _jsx("p", { className: css.hint, children: "\u8FD9\u4E2A\u6708\u65E5\u7A0B\u592A\u591A\uFF0C\u53EA\u663E\u793A\u4E86\u524D 500 \u6761\u3002" })] }), _jsx(CalendarTasks, { state: taskState, setState: setTaskState, retry: () => setTaskAttempt(n => n + 1), now: now })] });
}
function remindLabel(iso, key) {
    const day = dayKeyOf(iso);
    const time = timeLabel({ id: '', title: '', start: iso, end: iso }, day);
    return day === key ? time : `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日 ${time}`;
}
function Arrow({ dir }) {
    return _jsx("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", className: css.glyph, children: _jsx("path", { d: dir === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7' }) });
}
