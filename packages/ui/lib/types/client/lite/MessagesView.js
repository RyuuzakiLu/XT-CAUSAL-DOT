import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { deliveryFailed } from "../postbox-letters.js";
import { useTabMarker } from "./use-tab-marker.js";
import css from './messages.module.css';
/** 仅按事件真实字段分类；旧本机记录不属于可验证账号，不参与消息流。 */
export function messageEntries(letters, notices, archived = false) {
    const list = [];
    /* 待办同步信属于日程与待办；独立到点提醒仍留在消息流。 */
    const activeLetters = letters.filter(letter => letter.archived === archived && !letter.id.startsWith('zhixu-task:'));
    for (const letter of activeLetters) {
        const attention = letter.kind === 'work-blocked' || letter.kind === 'work-waiting-approval';
        const proactive = letter.proactive || letter.kind === 'reminder';
        const work = Boolean(letter.workId) || (letter.kind ?? '').startsWith('work-');
        const failed = letter.kind === 'work-failed' || deliveryFailed(letter.delivery);
        const at = letter.at ?? Date.parse(letter.createdAt);
        list.push({ key: `letter:${letter.id}`, title: letter.title, text: letter.body, at: Number.isFinite(at) ? at : 0, read: letter.read, category: attention ? 'attention' : proactive ? 'proactive' : work ? 'work' : 'system', tone: attention ? 'attention' : proactive ? 'proactive' : failed ? 'failed' : work ? 'done' : 'system', ...(letter.workId ? { workId: letter.workId } : {}), letter });
    }
    for (const notice of archived ? [] : notices) {
        if (notice.postboxId && letters.some(letter => letter.id === notice.postboxId))
            continue;
        const attention = notice.tone === 'attention' || notice.kind !== 'info';
        const proactive = notice.tone === 'reminder';
        list.push({ key: `notice:${notice.key}`, title: notice.title, text: notice.text ?? '', at: notice.at, read: notice.read, category: attention ? 'attention' : proactive ? 'proactive' : notice.workId ? 'work' : 'system', tone: attention ? 'attention' : proactive ? 'proactive' : notice.tone === 'failed' ? 'failed' : notice.workId ? 'done' : 'system', ...(notice.workId ? { workId: notice.workId } : {}), notice });
    }
    return list.sort((a, b) => b.at - a.at);
}
/** 实际工作已向前推进，且状态更新时间晚于这条等待消息时，才能自动标读。 */
export function handledAttentionIds(letters, works) {
    return letters.filter(letter => !letter.read && !letter.archived && letter.workId && (letter.kind === 'work-blocked' || letter.kind === 'work-waiting-approval') && letter.at && works.some(work => work.id === letter.workId && ['running', 'queued', 'succeeded', 'completed'].includes(work.status) && Date.parse(work.updatedAt) >= letter.at)).map(letter => letter.id);
}
const BJ = 'Asia/Shanghai';
const dayOf = (at) => at ? new Intl.DateTimeFormat('en-CA', { timeZone: BJ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at) : '';
function dayLabel(at, now) {
    if (!at)
        return '更早';
    const day = dayOf(at);
    const label = new Intl.DateTimeFormat('zh-CN', { timeZone: BJ, month: 'long', day: 'numeric' }).format(at);
    return `${day === dayOf(now) ? '今天 · ' : day === dayOf(now - 86400000) ? '昨天 · ' : ''}${label}`;
}
const timeOf = (at) => at ? new Intl.DateTimeFormat('zh-CN', { timeZone: BJ, hour: '2-digit', minute: '2-digit', hour12: false }).format(at) : '';
const categoryLabel = { attention: '要你处理', proactive: '主动', work: '工作', system: '系统' };
const glyph = { attention: '!', proactive: '✧', failed: '×', done: '✓', system: 'i' };
function LetterBody({ open, children }) {
    const [keep, setKeep] = useState(open);
    const fold = useRef(null);
    useLayoutEffect(() => {
        if (fold.current)
            fold.current.inert = !open;
        if (open) {
            setKeep(true);
            return;
        }
        if (!keep)
            return;
        const timer = window.setTimeout(() => setKeep(false), 260);
        return () => window.clearTimeout(timer);
    }, [open, keep]);
    return _jsx("div", { ref: fold, className: css.letterFold, "aria-hidden": !open, children: _jsx("div", { className: css.clip, children: (open || keep) && children }) });
}
export function MessagesView({ letters, notices, loading, selectedNoticeId, now = Date.now(), onOpen, onRead, onReadAll, onArchive, onRetry, hideReadAll = false }) {
    const [filter, setFilter] = useState('all');
    const tabs = useTabMarker(filter);
    const list = useRef(null);
    const previous = useRef(filter);
    useLayoutEffect(() => {
        if (previous.current === filter)
            return;
        previous.current = filter;
        const node = list.current;
        if (!node?.animate || node.closest('[data-reduced-motion="true"]') || matchMedia('(prefers-reduced-motion: reduce)').matches)
            return;
        const motion = node.animate([{ opacity: .45 }, { opacity: 1 }], { duration: 270, easing: 'ease-out' });
        return () => motion.cancel();
    }, [filter]);
    const [opened, setOpened] = useState('');
    useEffect(() => {
        if (!opened)
            return;
        const dismiss = (e) => {
            const node = list.current;
            if (e.key !== 'Escape' || !node?.getClientRects().length || node.closest('[inert]'))
                return;
            if (document.querySelector('[role="dialog"]:not([inert])'))
                return;
            const trigger = node.querySelector('button[aria-expanded="true"]');
            if (!trigger)
                return;
            e.preventDefault();
            e.stopImmediatePropagation();
            setOpened('');
            trigger.focus({ preventScroll: true });
        };
        window.addEventListener('keydown', dismiss, true);
        return () => window.removeEventListener('keydown', dismiss, true);
    }, [opened]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const selectedHandled = useRef('');
    useEffect(() => {
        if (!selectedNoticeId) {
            selectedHandled.current = '';
            return;
        }
        if (selectedHandled.current !== selectedNoticeId && letters.some(letter => letter.id === selectedNoticeId)) {
            selectedHandled.current = selectedNoticeId;
            setOpened(`letter:${selectedNoticeId}`);
        }
    }, [selectedNoticeId, letters]);
    const entries = messageEntries(letters, notices);
    const unread = entries.filter(entry => !entry.read);
    const count = entries.filter(entry => entry.category === 'attention' && !entry.read).length;
    const filtered = filter === 'archived' ? messageEntries(letters, [], true) : entries.filter(entry => filter === 'all' || entry.category === filter);
    const groups = new Map();
    for (const entry of filtered) {
        const key = dayOf(entry.at);
        const rows = groups.get(key) ?? [];
        rows.push(entry);
        groups.set(key, rows);
    }
    const action = async (run) => { setBusy(true); setError(''); try {
        const result = await run();
        if (typeof result === 'string')
            setError(result);
    }
    catch (cause) {
        setError(cause instanceof Error ? cause.message : '操作失败，请重试');
    }
    finally {
        setBusy(false);
    } };
    const toggle = (entry) => {
        if (!entry.read && !entry.letter?.todo)
            onRead(entry);
        if (entry.workId) {
            onOpen(entry);
            return;
        }
        if (entry.notice?.kind === 'input')
            onOpen(entry);
        setOpened(current => current === entry.key ? '' : entry.key);
    };
    return _jsxs(_Fragment, { children: [_jsxs("div", { className: css.tools, children: [_jsxs("div", { ref: tabs, className: css.filters, role: "tablist", "aria-label": "\u6D88\u606F\u5206\u7C7B", children: [_jsx("span", { className: css.marker, "aria-hidden": "true" }), [['all', '全部'], ['attention', `要你处理${count ? ` ${count}` : ''}`], ['proactive', '主动'], ['work', '工作'], ['system', '系统'], ['archived', '已归档']].map(([key, label]) => _jsx("button", { type: "button", role: "tab", "aria-selected": filter === key, onClick: () => setFilter(key), children: label }, key))] }), !hideReadAll && _jsx("button", { type: "button", className: css.readAll, disabled: busy || unread.length === 0, onClick: () => void action(() => onReadAll(unread)), children: "\u5168\u90E8\u5DF2\u8BFB" })] }), _jsxs("div", { ref: list, className: css.scroll, children: [error && _jsx("p", { className: css.error, role: "alert", children: error }), !filtered.length && _jsx("p", { className: css.empty, children: loading ? '正在读取消息…' : '这里还没有消息。' }), [...groups.entries()].map(([key, rows]) => _jsxs("section", { className: css.group, children: [_jsx("h2", { children: dayLabel(rows[0].at, now) }), _jsx("div", { className: css.box, children: rows.map(entry => _jsxs("article", { className: css.item, "data-tone": entry.tone, "data-unread": !entry.read, children: [_jsxs("button", { type: "button", className: css.row, onClick: () => toggle(entry), "aria-expanded": !entry.workId ? opened === entry.key : undefined, children: [_jsx("span", { className: css.dot, "aria-hidden": "true" }), _jsx("span", { className: css.icon, "aria-hidden": "true", children: glyph[entry.tone] }), _jsxs("span", { className: css.content, children: [_jsxs("span", { className: css.head, children: [_jsx("b", { children: entry.title }), _jsx("time", { children: timeOf(entry.at) })] }), entry.text && _jsx("span", { className: css.preview, children: entry.text }), _jsxs("span", { className: css.bottom, children: [_jsx("em", { children: categoryLabel[entry.category] }), entry.workId && _jsxs("span", { children: [entry.category === 'attention' ? '去处理' : '看任务', " \u203A"] })] })] })] }), entry.workId && entry.letter && _jsx("button", { type: "button", className: css.expand, "aria-expanded": opened === entry.key, onClick: () => { if (opened !== entry.key && !entry.read && !entry.letter?.todo)
                                                onRead(entry); setOpened(current => current === entry.key ? '' : entry.key); }, children: opened === entry.key ? '收起信件' : '查看信件' }), _jsx(LetterBody, { open: opened === entry.key, children: _jsxs("div", { className: css.detail, children: [_jsx("p", { children: entry.text }), entry.letter?.todo?.progress && _jsx("p", { children: entry.letter.todo.progress }), entry.letter?.todo?.updates.map(update => _jsxs("p", { children: [_jsx("time", { children: update.at }), " ", update.title, " ", update.body] }, update.id)), _jsxs("div", { className: css.actions, children: [!entry.read && _jsx("button", { type: "button", onClick: () => onRead(entry), children: "\u6807\u4E3A\u5DF2\u8BFB" }), entry.letter && deliveryFailed(entry.letter.delivery) && _jsx("button", { type: "button", disabled: busy, onClick: () => void action(() => onRetry(entry.letter)), children: "\u91CD\u65B0\u6295\u9012" }), entry.letter && !entry.letter.archived && (!entry.letter.todo || entry.letter.todo.closed) && _jsx("button", { type: "button", disabled: busy, onClick: () => void action(() => onArchive(entry.letter)), children: "\u5F52\u6863" })] })] }) })] }, entry.key)) })] }, key)), _jsx("p", { className: css.foot, children: "\u8FDB\u884C\u4E2D\u7684\u5DE5\u4F5C\u5728\u540E\u53F0\u5DE5\u4F5C\u91CC\u770B" })] })] });
}
