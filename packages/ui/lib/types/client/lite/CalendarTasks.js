import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useState } from 'react';
import { createCalendarTask, dayKeyOf, setCalendarTaskStatus } from "./calendar.js";
import css from './calendar-todo.module.css';
const operation = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
export function CalendarTasks({ state, setState, retry, now, update = setCalendarTaskStatus, create = createCalendarTask }) {
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [adding, setAdding] = useState(false);
    const [title, setTitle] = useState('');
    const tasks = state.status === 'ready' ? state.items.filter(task => task.status !== 'canceled') : [];
    const change = async (task) => {
        if (state.status !== 'ready')
            return;
        setBusy(task.id);
        setError('');
        try {
            const updated = await update(task, task.status === 'done' ? 'pending' : 'done', operation());
            setState({ ...state, items: state.items.map(item => item.id === task.id ? updated : item) });
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        }
        finally {
            setBusy('');
        }
    };
    const add = async () => {
        if (state.status !== 'ready' || !title.trim())
            return;
        setBusy('new');
        setError('');
        try {
            const item = await create(title.trim(), operation());
            setState({ ...state, items: [item, ...state.items] });
            setTitle('');
            setAdding(false);
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        }
        finally {
            setBusy('');
        }
    };
    return _jsxs("section", { className: css.tasks, "aria-label": "\u5F85\u529E", "data-calendar-tasks": "", children: [_jsxs("header", { className: css.head, children: [_jsxs("h2", { children: ["\u5F85\u529E ", state.status === 'ready' ? tasks.length : ''] }), state.status === 'ready' && _jsx("button", { type: "button", onClick: () => setAdding(!adding), children: adding ? '取消' : '＋ 新增待办' })] }), adding && _jsxs("form", { className: css.create, onSubmit: e => { e.preventDefault(); void add(); }, children: [_jsx("input", { "aria-label": "\u5F85\u529E\u5185\u5BB9", value: title, onChange: e => setTitle(e.target.value), placeholder: "\u8981\u505A\u4EC0\u4E48\uFF1F", maxLength: 500 }), _jsx("button", { disabled: Boolean(busy) || !title.trim(), children: "\u6DFB\u52A0" })] }), state.status === 'loading' && _jsx("p", { className: css.note, children: "\u6B63\u5728\u8BFB\u53D6\u5F85\u529E\u2026" }), state.status === 'error' && _jsxs("p", { className: css.error, role: "alert", children: ["\u8BFB\u53D6\u5F85\u529E\u5931\u8D25\uFF1A", state.message, " ", _jsx("button", { className: css.retry, onClick: retry, children: "\u91CD\u8BD5" })] }), error && _jsx("p", { className: css.error, role: "alert", children: error }), state.status === 'ready' && tasks.length === 0 && _jsx("p", { className: css.note, children: "\u8FD8\u6CA1\u6709\u5F85\u529E\u3002" }), tasks.length > 0 && _jsx("ul", { className: css.list, children: tasks.map(task => _jsxs("li", { className: css.item, children: [_jsxs("label", { className: css.checkHit, children: [_jsx("input", { type: "checkbox", className: css.check, "aria-label": `${task.status === 'done' ? '重新打开' : '完成'}：${task.title}`, checked: task.status === 'done', disabled: Boolean(busy), onChange: () => void change(task) }), _jsx("svg", { className: css.tick, viewBox: "0 0 20 20", "aria-hidden": "true", children: _jsx("path", { d: "m4.5 10 3.5 3.5 7.5-8", pathLength: "1" }) })] }), _jsxs("span", { className: css.body, "data-done": task.status === 'done' ? '' : undefined, children: [_jsx("span", { children: task.title }), task.dueAt && _jsx("span", { className: css.due, "data-near": task.status !== 'done' && Date.parse(task.dueAt) - now <= 86_400_000 ? '' : undefined, children: dueLabel(task.dueAt, now) })] })] }, task.id)) }), state.status === 'ready' && state.truncated && _jsx("p", { className: css.note, children: "\u5F85\u529E\u8F83\u591A\uFF0C\u76EE\u524D\u53EA\u663E\u793A\u524D 500 \u6761\u3002" })] });
}
function dueLabel(value, now) {
    const day = dayKeyOf(value);
    if (!day)
        return '';
    const d = new Date(Date.parse(value) + 8 * 3_600_000);
    const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
    return `${day === dayKeyOf(now) ? '今天' : `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`} ${time} 前`;
}
