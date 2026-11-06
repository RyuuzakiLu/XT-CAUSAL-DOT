import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/* ================================================================
   DOT 简洁版外壳（2026-10-31）
   ◍ 用户原话：「简洁版我就要最简单的那种黑白配色的，但是要好看」、「功能都要保留」、
     「精灵不要了，换成传统的交互，但是不要底栏」。
   ◍ 只换界面层：数据（useDotData）、视图（useStore / navigate / actions）、联动运行时（live：
     工作卡 store、气泡队列、审批桥）、指令（command）全部照用经典版那一套，不另接后端。
   ◍ 结构：顶栏（菜单 · 标题 · 铃铛 · 本页动作）＋ 左侧抽屉。抽屉里是对话 / 日程 / 后台工作 / 星邮匣 /
     消息 / 记忆 / 设置、打电话、切回经典版。日程（2026-11-01）是知序日程的只读月历。没有底栏，没有精灵。
   ◍ 只有一个对话（2026-10-31 用户原话：「历史会话那个选项也去掉，所有会话只留在一个界面上」）：
     没有历史对话、没有新对话按钮；打开就是对话页，更早的会话都拼在上方，往上滚就能看到
     （打开哪个、拼哪些见 session-chain.ts 的 pickSingleSession / singleSessionBefore）。
     没有消息时也是对话页，输入栏在底部，没有欢迎页、没有鲸鱼。
   ◍ 名字和图标：显示名 Xtcausal dot、品牌 logo 都在 lite-brand.ts，这里不写死。
   ◍ 硬规矩：等你处理的事（审批 / 凭证填写 / 远程登录 / 补充）在对话页顶部一直有一条，
     对话流里的工作小卡、工作页、工作详情、顶部提醒里也都能直接答。
   ◍ 提醒：顶部 toast（同一个气泡队列）＋「你不在时」横幅；露出来过的都进「消息」列表。
   ================================================================ */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { installReplyMotion } from "./reply-motion.js";
import { installSendMotion } from "./send-motion.js";
import { installStickToBottom } from "./stick-bottom.js";
import { LINK_LABEL, useLinkLevel } from "./link-status.js";
import { openNoticeEntry } from "../notify/notices.js";
import { markPostboxSeen, unseenLetterCount, usePostboxSeenAt } from "../notify/postbox-seen.js";
import { CallOverlay } from "../call/CallOverlay.js";
import { deliveryFailed } from "../postbox-letters.js";
import { readLitePrefs, writeLitePrefs } from "./ui-mode.js";
import { GENDER_OPTIONS, loadPersona, previewPersona, savePersona } from "../persona/persona-api.js";
import { noticeLog } from "./notice-log.js";
import { LITE_NAME, liteIconUrl } from "./lite-brand.js";
import { liteCardKind, liteCardLabel, liveWorkLine, viewOfCard, viewOfRow } from "./LiteWorkCard.js";
import { LiteCalendar } from "./LiteCalendar.js";
import { MessagesView, handledAttentionIds, messageEntries } from "./MessagesView.js";
import { LiteBoot } from "./LiteBoot.js";
import { explainFailure } from "./failure-reason.js";
import { ensureViewportFitCover } from "./safe-area.js";
import { useTabMarker } from "./use-tab-marker.js";
import { WorkFilters } from "./WorkFilters.js";
import workCss from './work-page.module.css';
import css from './lite.module.css';
const noopSubscribe = () => () => { };
const EMPTY_CARDS = { cards: {}, order: [] };
/* ---------- 小工具 ---------- */
function ago(value, now) {
    const at = typeof value === 'number' ? value : value ? Date.parse(value) : NaN;
    if (!Number.isFinite(at))
        return '';
    const s = Math.max(0, Math.round((now - at) / 1000));
    if (s < 45)
        return '刚刚';
    const m = Math.round(s / 60);
    if (m < 60)
        return `${m} 分钟前`;
    const h = Math.round(m / 60);
    if (h < 24)
        return `${h} 小时前`;
    const d = Math.round(h / 24);
    if (d < 7)
        return `${d} 天前`;
    const date = new Date(at);
    return `${date.getMonth() + 1}月${date.getDate()}日`;
}
function useNow(ms = 30_000) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => { const timer = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(timer); }, [ms]);
    return now;
}
const opId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);
/** 工作状态 → 一个词 + 一类。类别决定语义颜色和圆点形状。 */
const STATUS = {
    'waiting-approval': { label: '等你确认', kind: 'attention' },
    'waiting-input': { label: '等你处理', kind: 'attention' },
    queued: { label: '排队中', kind: 'active' },
    running: { label: '进行中', kind: 'active' },
    succeeded: { label: '已完成', kind: 'done' },
    completed: { label: '已完成', kind: 'done' },
    failed: { label: '没做成', kind: 'failed' },
    cancelled: { label: '已取消', kind: 'idle' },
    interrupted: { label: '被打断', kind: 'failed' },
};
const statusOf = (status) => STATUS[status] ?? { label: status || '未知', kind: 'idle' };
export function mergeWorks(cards, order, rows) {
    const byId = new Map();
    for (const row of rows)
        byId.set(row.id, { id: row.id, title: row.goal, status: row.status, doing: row.blocked?.message ?? row.stage, updatedAt: row.updatedAt, createdAt: row.createdAt, progress: row.progress, row });
    for (const id of order) {
        const card = cards[id];
        if (!card)
            continue;
        const row = byId.get(id)?.row;
        const newer = !row || Date.parse(card.updatedAt) >= Date.parse(row.updatedAt);
        byId.set(id, newer
            ? { id, title: card.title || row?.goal || '后台工作', status: card.status, doing: card.attention?.message ?? card.doing ?? card.stage, updatedAt: card.updatedAt, createdAt: card.createdAt ?? row?.createdAt, progress: card.progress, card, row }
            : { ...byId.get(id), card });
    }
    return [...byId.values()].sort((a, b) => (Date.parse(b.createdAt || b.updatedAt) || 0) - (Date.parse(a.createdAt || a.updatedAt) || 0));
}
/** 「要你动手」：等确认 / 等处理的工作。 */
const attentionOf = (item) => {
    if (!item.card)
        return item.row?.blocked;
    if (!item.row || Date.parse(item.card.updatedAt) >= Date.parse(item.row.updatedAt))
        return item.card.attention;
    return item.row.blocked;
};
export const needsYou = (item) => item.status === 'waiting-approval' || item.status === 'waiting-input' || (item.status === 'running' && Boolean(attentionOf(item)?.action));
/* ---------- 图标：统一 1.6 线宽的线性图标，不用图片 ---------- */
const PATHS = {
    chat: 'M4 5.5h16v10H9l-5 4v-14z',
    work: 'M4 7.5h16v11H4zM9 7.5V5h6v2.5',
    mail: 'M3.5 6h17v12h-17zM3.5 6l8.5 7 8.5-7',
    me: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5',
    plus: 'M12 5v14M5 12h14',
    history: 'M4 12a8 8 0 1 0 2.4-5.7M4 4.5v3.8h3.8M12 8v4.5l3 2',
    back: 'M15 5l-7 7 7 7',
    more: 'M5 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM19 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
    close: 'M6 6l12 12M18 6L6 18',
    chevron: 'M9 6l6 6-6 6',
    phone: 'M7 3.5h3l1.5 4-2 1.2a10 10 0 0 0 5.8 5.8l1.2-2 4 1.5v3A2 2 0 0 1 18.5 19 15.5 15.5 0 0 1 5 5.5 2 2 0 0 1 7 3.5z',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    copy: 'M9 9h10v10H9zM5 15V5h10',
    open: 'M14 5h5v5M19 5l-8 8M18 14v5H5V6h5',
    menu: 'M4 7h16M4 12h16M4 17h10',
    bell: 'M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5h4',
    edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
    memory: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4l3 2',
    gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8',
    box: 'M4 7.5h16v11H4zM9 7.5V5h6v2.5',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
    swap: 'M7 7h12l-3-3M17 17H5l3 3',
    calendar: 'M4.5 6h15v13.5h-15zM4.5 10h15M8.5 4v4M15.5 4v4',
};
function Glyph({ name }) {
    return _jsx("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", className: css.glyph, children: _jsx("path", { d: PATHS[name] ?? '' }) });
}
/* ================================================================ */
export function LiteShell(props) {
    const view = props.useStore(value => value);
    const data = props.useDotData(value => value);
    const live = props.live;
    const [prefs, setPrefsState] = useState(readLitePrefs);
    const setPrefs = (patch) => setPrefsState(current => { const next = { ...current, ...patch }; writeLitePrefs(next); return next; });
    /* 不对应经典版房间的页（消息 / 记忆 / 设置）只在简洁版里记，房间变了就离开。 */
    const [local, setLocal] = useState(null);
    const [drawer, setDrawer] = useState(false);
    const [sheet, setSheet] = useState(null);
    /* 抽屉里点「要你处理 / 进行中 / 已完成」：进后台工作页并滚到那一组。 */
    const [workFocus, setWorkFocus] = useState(null);
    const personal = useSyncExternalStore(props.personalSettings?.subscribe ?? noopSubscribe, props.personalSettings?.getSnapshot ?? (() => null));
    const store = useSyncExternalStore(live?.store.subscribe ?? noopSubscribe, live?.store.getSnapshot ?? (() => EMPTY_CARDS));
    const items = useMemo(() => mergeWorks(store.cards, store.order, data.works), [store, data.works]);
    const waiting = items.filter(needsYou);
    const running = items.filter(item => !needsYou(item) && statusOf(item.status).kind === 'active');
    const finished = items.filter(item => !needsYou(item) && statusOf(item.status).kind !== 'active');
    const seenAt = usePostboxSeenAt();
    const unseen = unseenLetterCount(data.letters, seenAt);
    const transientNotices = useSyncExternalStore(noticeLog.subscribe, noticeLog.get);
    const unreadNotices = messageEntries(data.letters, transientNotices).filter(entry => !entry.read).length;
    /* 经典版的首页是「书房」；简洁版首页就是对话。书房/下线房间一律送到对话（两边取的数据域一样）。 */
    useEffect(() => { if (view.space !== 'conversation' && view.space !== 'work' && view.space !== 'postbox')
        props.navigate('conversation'); }, [view.space]);
    /* 房间变了（点了工作卡、提醒、返回键）就离开本地页，并收起抽屉。 */
    useEffect(() => { setLocal(null); setDrawer(false); }, [view.space]);
    useEffect(() => {
        setLocal(current => current === 'notices' ? current : null);
        setDrawer(false);
    }, [view.card]);
    const tab = local ?? (view.space === 'work' ? 'work' : view.space === 'postbox' ? 'postbox' : 'chat');
    const go = (next) => {
        setSheet(null);
        setDrawer(false);
        if (next === 'me' || next === 'notices' || next === 'memory' || next === 'calendar') {
            setLocal(next);
            return;
        }
        setLocal(null);
        const space = next === 'chat' ? 'conversation' : next;
        if (view.space !== space)
            props.navigate(space);
        if (view.card)
            props.actions.openCard(null);
    };
    /* 主题：浅色（默认）/ 深色 / 跟随系统。浏览器顶栏颜色也跟着变。 */
    const systemDark = useSyncExternalStore(subscribeScheme, () => matchMedia('(prefers-color-scheme: dark)').matches);
    const theme = prefs.theme === 'auto' ? (systemDark ? 'dark' : 'light') : prefs.theme;
    useLayoutEffect(() => {
        let meta = document.querySelector('meta[name=theme-color]');
        if (!meta) {
            meta = document.createElement('meta');
            meta.setAttribute('name', 'theme-color');
            document.head.append(meta);
        }
        meta.setAttribute('content', theme === 'dark' ? '#0E1018' : '#F8F9FC');
        document.documentElement.style.colorScheme = theme;
        document.documentElement.dataset.liteTheme = theme;
        /* 原生组件（代码块、菜单）跟着走：浅色时去掉 index.ts 默认挂的深色标记。 */
        if (theme === 'dark')
            document.body.setAttribute('data-ds-dark-theme', '');
        else
            document.body.removeAttribute('data-ds-dark-theme');
    }, [theme]);
    /* 手机底部手势条 / 刘海：让 env(safe-area-inset-*) 生效（安卓壳另注入 --dot-inset-*，见 safe-area.ts）。 */
    useEffect(() => { ensureViewportFitCover(); }, []);
    /* 抽屉开着时按 Esc 收起。 */
    useEffect(() => {
        if (!drawer)
            return;
        const onKey = (event) => { if (event.key === 'Escape') {
            event.preventDefault();
            setDrawer(false);
        } };
        addEventListener('keydown', onKey);
        return () => removeEventListener('keydown', onKey);
    }, [drawer]);
    /* 截图验收用：地址带 liteqa 时把运行时挂到 window，只在本页内存里塞假卡，不碰服务端。 */
    useEffect(() => { if (live && /[?&]liteqa\b/.test(location.search))
        window.__dotLiteQa = { live, noticeLog }; }, [live]);
    const goWork = (group) => { setWorkFocus(group); go('work'); };
    const ctx = { props, data, live, items, waiting, running, finished, unseen, unreadNotices, prefs, setPrefs, theme, tab, go, goWork, workFocus, clearWorkFocus: () => setWorkFocus(null), setSheet, openDrawer: () => setDrawer(true) };
    return _jsxs("div", { className: css.lite, "data-theme": theme, "data-tab": tab, "data-reduced-motion": view.reducedMotion, children: [_jsx(LiteBoot, { ready: (data.connected && !data.loading) || Boolean(data.error), reducedMotion: view.reducedMotion, onStart: () => go('chat') }), live && _jsx(NoticeRecorder, { live: live }), data.error && _jsxs("div", { role: "alert", className: css.alert, children: [_jsx("span", { children: data.error }), _jsx("button", { onClick: () => void props.refresh(), children: "\u91CD\u8BD5" })] }), view.nativePanel
                ? _jsxs("section", { className: css.page, children: [_jsxs("header", { className: css.top, children: [_jsx("button", { className: css.icon, "aria-label": "\u8FD4\u56DE", onClick: props.back, children: _jsx(Glyph, { name: "back" }) }), _jsx("div", { className: css.heading, children: _jsx("h1", { className: css.title, children: "\u5BF9\u8BDD\u5DE5\u5177" }) }), _jsx("span", { className: css.iconSpacer })] }), _jsx("div", { className: css.native, children: props.renderSlot('main', {}, { entryKey: view.nativePanel }) })] })
                : _jsx(MainPages, { ctx: ctx, reducedMotion: view.reducedMotion }), live && _jsx(Toasts, { ctx: ctx }), _jsx(Drawer, { ctx: ctx, open: drawer, close: () => setDrawer(false) }), sheet === 'create' && _jsx(CreateSheet, { ctx: ctx }), _jsx(WorkDetailPresence, { ctx: ctx, id: view.card, reduced: view.reducedMotion }), _jsxs("div", { className: css.nativePanel, hidden: !view.rightbar, children: [_jsx("button", { onClick: () => props.actions.rightbar(false), children: "\u5173\u95ED" }), props.renderSlot('rightbar', { width: Math.min(window.innerWidth - 32, 700), viewportWidth: window.innerWidth, canShow: true })] }), _jsx("div", { hidden: true, children: props.renderSlot('sidebar.settings', { wide: false }) }), props.renderSlot('shell.bottom', {}), props.call && _jsx(CallOverlay, { engine: props.call }), props.renderSlot('shell.overlay', {}), personal?.notice && !view.settings && _jsxs("div", { className: css.receipt, role: "status", children: [_jsx("span", { children: personal.notice }), (personal.canUndo || personal.serverUndo) && _jsx("button", { onClick: () => void props.personalSettings?.undoLast().catch(cause => props.personalSettings?.notify(String(cause))), children: "\u64A4\u9500" }), _jsx("button", { "aria-label": "\u5173\u95ED\u8BBE\u7F6E\u56DE\u6267", onClick: () => props.personalSettings?.notify(''), children: _jsx(Glyph, { name: "close" }) })] }), view.settings && props.personalSettings && _jsx("div", { className: css.classicLayer, children: props.renderSettings() })] });
}
function subscribeScheme(listener) {
    const query = matchMedia('(prefers-color-scheme: dark)');
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
}
/** 工作行 → 简洁版工作卡的数据：有实时卡用实时卡，否则用快照行。 */
function itemView(item) {
    if (item.card)
        return viewOfCard(item.card);
    if (item.row)
        return viewOfRow(item.row);
    return { id: item.id, title: item.title, status: item.status, doing: item.doing, updatedAt: item.updatedAt, steps: [], artifactCount: 0 };
}
/* ================= 顶栏 + 抽屉（替代底栏和精灵菜单） ================= */
/** 每页同一条顶栏：左菜单、中间标题和一行状态、右边铃铛和本页动作。 */
/** 以后的图标位：lite-brand.ts 里的 LITE_ICON 不空时显示，空的时候什么都不占。 */
function BrandMark({ large }) {
    const url = liteIconUrl();
    return url ? _jsx("img", { className: large ? css.brandMarkLarge : css.brandMark, src: url, alt: "", "aria-hidden": "true", "data-lite-brand-icon": "" }) : null;
}
function TopBar({ ctx, title, sub, offline, live, brand, hideBell, link, children }) {
    const bell = ctx.unreadNotices;
    return _jsxs("header", { className: css.top, children: [_jsxs("button", { className: css.icon, "aria-label": "\u6253\u5F00\u83DC\u5355", "aria-haspopup": "dialog", onClick: ctx.openDrawer, children: [_jsx(Glyph, { name: "menu" }), ctx.tab !== 'chat' && ctx.waiting.length > 0 && _jsx("i", { className: css.badge, "data-dot": "true" })] }), _jsxs("div", { className: css.heading, children: [_jsxs("h1", { className: css.title, "data-dot-name-keep": "", children: [brand && _jsx(BrandMark, {}), title] }), link
                        ? _jsxs("span", { className: css.sub, "data-link-line": "", children: [_jsxs("span", { className: css.linkState, role: "status", "aria-label": `连接状态：${LINK_LABEL[link]}`, "data-link": link, children: [_jsx("i", { "aria-hidden": "true" }), LINK_LABEL[link]] }), sub && _jsx("span", { className: css.linkWork, "data-live": live ? '' : undefined, children: sub })] })
                        : sub && _jsxs("span", { className: css.sub, role: "status", "data-offline": Boolean(offline), "data-live": live ? '' : undefined, children: [live && _jsx("i", { className: css.breath, "aria-hidden": "true" }), sub] })] }), !hideBell && _jsxs("button", { className: css.icon, "aria-label": bell ? `消息（${bell} 条新）` : '消息', "aria-current": ctx.tab === 'notices' ? 'page' : undefined, onClick: () => ctx.go('notices'), children: [_jsx(Glyph, { name: "bell" }), bell > 0 && _jsx("i", { className: css.badge, children: bell > 99 ? '99+' : bell })] }), _jsx("button", { className: css.icon, "aria-label": ctx.theme === 'dark' ? '切换浅色模式' : '切换深色模式', onClick: () => ctx.setPrefs({ theme: ctx.theme === 'dark' ? 'light' : 'dark' }), children: _jsxs("svg", { className: css.themeGlyph, width: "24", height: "24", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [_jsx("g", { className: css.themeMoon, children: _jsx("path", { d: "M8.4 3.5a9 9 0 0 0 12.2 12.2A8.8 8.8 0 1 1 8.4 3.5Z" }) }), _jsxs("g", { className: css.themeSun, children: [_jsx("circle", { cx: "12", cy: "12", r: "4" }), _jsx("path", { d: "M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" })] })] }) }), children] });
}
/** 左侧抽屉：所有去处都在这里（原来底栏 + 精灵菜单里的事）。 */
export function Drawer({ ctx, open = true, close }) {
    const { props, data, waiting, running, finished, tab } = ctx;
    const layer = useRef(null);
    const panel = useRef(null);
    useLayoutEffect(() => {
        if (!layer.current)
            return;
        layer.current.inert = !open;
        if (!open)
            return;
        const trigger = document.activeElement;
        panel.current?.focus({ preventScroll: true });
        return () => {
            if (trigger instanceof HTMLElement && trigger.isConnected && trigger.getClientRects().length)
                trigger.focus({ preventScroll: true });
        };
    }, [open]);
    const nav = (key, label, icon, meta) => _jsxs("button", { className: css.navItem, "aria-current": tab === key ? 'page' : undefined, onClick: () => ctx.go(key), children: [_jsx(Glyph, { name: icon }), _jsx("span", { children: label }), meta] });
    return _jsxs("div", { ref: layer, className: css.drawerLayer, "data-open": open, "aria-hidden": !open, children: [_jsx("button", { className: css.scrim, "aria-label": "\u5173\u95ED\u83DC\u5355", tabIndex: -1, onClick: close }), _jsxs("aside", { ref: panel, tabIndex: -1, className: css.drawer, role: open ? "dialog" : undefined, "aria-modal": open || undefined, "aria-label": "\u83DC\u5355", children: [_jsxs("div", { className: css.drawerHead, children: [liteIconUrl() ? _jsx(BrandMark, { large: true }) : null, _jsxs("span", { className: css.drawerWho, children: [_jsx("b", { children: LITE_NAME }), _jsx("span", { "data-offline": !data.connected, children: !data.connected ? '未连接' : liveWorkLine(running.length, waiting.length) || (data.busy ? '正在回复' : '已连接') })] })] }), _jsx("div", { className: css.drawerSection, children: _jsx("span", { children: "\u540E\u53F0\u5DE5\u4F5C" }) }), _jsxs("nav", { className: `${css.nav} ${workCss.drawerGroups}`, "aria-label": "\u540E\u53F0\u5DE5\u4F5C", "data-lite-work-groups": "", children: [_jsxs("button", { className: css.navItem, "data-group": "attention", "data-hot": waiting.length > 0, onClick: () => ctx.goWork('attention'), children: [_jsx("span", { className: css.mark, "data-kind": "attention" }), _jsx("span", { children: "\u8981\u4F60\u5904\u7406" }), _jsx("em", { className: css.count, "data-strong": waiting.length ? '' : undefined, children: waiting.length })] }), _jsxs("button", { className: css.navItem, "data-group": "active", onClick: () => ctx.goWork('active'), children: [_jsx("span", { className: css.mark, "data-kind": running.length ? 'active' : 'idle' }), _jsx("span", { children: "\u8FDB\u884C\u4E2D" }), _jsx("em", { className: css.count, children: running.length })] }), _jsxs("button", { className: css.navItem, "data-group": "finished", onClick: () => ctx.goWork('finished'), children: [_jsx("span", { className: css.mark, "data-kind": "done" }), _jsx("span", { children: "\u5DF2\u7ED3\u675F" }), _jsx("em", { className: css.count, children: finished.length })] })] }), _jsxs("nav", { className: css.nav, "aria-label": "\u53BB\u5904", children: [nav('chat', '对话', 'chat'), nav('notices', '消息', 'bell', ctx.unreadNotices ? _jsx("em", { className: css.count, "data-strong": "", children: ctx.unreadNotices }) : null), nav('calendar', '日程与待办', 'calendar'), nav('me', '设置', 'gear')] }), _jsx("div", { className: css.drawerFoot, children: props.call && _jsxs("button", { className: css.navItem, onClick: () => { close(); void props.call?.start(); }, children: [_jsx(Glyph, { name: "phone" }), _jsxs("span", { children: ["\u548C ", LITE_NAME, " \u6253\u7535\u8BDD"] })] }) })] })] });
}
/** 露出来过的提醒都记进「消息」列表（同一个气泡队列，加上「你不在时」）。 */
function NoticeRecorder({ live }) {
    const snap = useSyncExternalStore(live.bubbles.subscribe, live.bubbles.getSnapshot);
    const away = useSyncExternalStore(live.awaySummary.subscribe, live.awaySummary.get);
    useEffect(() => { for (const notice of snap.visible)
        noticeLog.record(notice); }, [snap.visible]);
    useEffect(() => { if (away)
        noticeLog.record(away); }, [away]);
    return null;
}
/* ================= 对话 ================= */
/* 顶栏标题 = 本户在设置里定的助手名（dot-lite-header-name-2026-11-01）；没取到才用 LITE_NAME。
   设置保存时 persona-api 发 dot-persona:changed，这里就地换名，不用刷新。浏览器标题/manifest 不跟着改。 */
let assistantNameCache = '';
function useAssistantName() {
    const [name, setName] = useState(assistantNameCache);
    useEffect(() => {
        let alive = true;
        const take = (value) => { const next = typeof value === 'string' ? value.trim() : ''; assistantNameCache = next; if (alive)
            setName(next); };
        loadPersona().then(view => take(view.profile.name)).catch(() => { });
        const onChange = (event) => take(event.detail?.name);
        window.addEventListener('dot-persona:changed', onChange);
        return () => { alive = false; window.removeEventListener('dot-persona:changed', onChange); };
    }, []);
    return name || LITE_NAME;
}
function ChatPage({ ctx, hidden }) {
    const { props, data, running, waiting } = ctx;
    const reducedMotion = props.useStore(state => state.reducedMotion);
    const chat = useRef(null);
    const stick = useRef(null);
    const returnButton = useRef(null);
    const [awayFromBottom, setAwayFromBottom] = useState(false);
    const searchInput = useRef(null);
    const searchToggle = useRef(null);
    const [searching, setSearching] = useState(false);
    const toggleSearch = (open) => {
        if (open) {
            // 在同一次点击内启用并聚焦输入框，手机键盘与搜索栏同时开始展开。
            flushSync(() => setSearching(true));
            searchInput.current?.focus({ preventScroll: true });
        }
        else {
            searchToggle.current?.focus({ preventScroll: true });
            setSearching(false);
        }
    };
    const [query, setQuery] = useState('');
    const [matches, setMatches] = useState([]);
    const [index, setIndex] = useState(0);
    useEffect(() => {
        const root = chat.current;
        const term = query.trim().toLocaleLowerCase();
        if (!root || hidden || !searching || !term) {
            setMatches([]);
            return;
        }
        const collect = () => {
            const rows = Array.from(root.querySelectorAll('[data-chat-flow-kind="user"], [data-chat-flow-kind="assistant-step"]'));
            const found = rows.filter(row => row.getClientRects().length && row.innerText.toLocaleLowerCase().includes(term));
            setMatches(old => old.length === found.length && old.every((row, n) => row === found[n]) ? old : found);
        };
        collect();
        const observer = new MutationObserver(collect);
        observer.observe(root, { subtree: true, childList: true, characterData: true });
        return () => observer.disconnect();
    }, [hidden, searching, query]);
    const position = Math.min(index, Math.max(0, matches.length - 1));
    useEffect(() => {
        const row = matches[position];
        if (!row || !searching)
            return;
        row.setAttribute('data-lite-search-hit', '');
        stick.current?.jump(row);
        return () => row.removeAttribute('data-lite-search-hit');
    }, [matches, position, searching]);
    /* 打开即贴底：规则见 stick-bottom.ts（hark-reloadfix-20261101：手指一碰不再永久停止贴底；装填期保持位置；图片/iframe 加载也算）。 */
    useLayoutEffect(() => {
        const root = chat.current;
        if (hidden || !root)
            return;
        const handle = installStickToBottom(root, { trace: info => {
                const away = !info.following && info.gap > 60;
                const button = returnButton.current;
                if (away && button?.offsetParent) {
                    const card = root.querySelector('[data-composer-seat] [data-composer-card]');
                    if (card) {
                        const inset = button.offsetParent.getBoundingClientRect().bottom - card.getBoundingClientRect().top;
                        button.style.setProperty('--dot-composer-inset', Math.max(0, inset) + 'px');
                    }
                }
                setAwayFromBottom(away);
                window.__dotStick = { ...info, at: Date.now() };
            } });
        stick.current = handle;
        return () => { handle.stop(); stick.current = null; };
    }, [hidden]);
    useLayoutEffect(() => {
        if (!hidden && !reducedMotion && chat.current)
            return installSendMotion(chat.current);
    }, [hidden, reducedMotion]);
    useLayoutEffect(() => {
        if (!hidden && chat.current)
            return installReplyMotion(chat.current, reducedMotion);
    }, [hidden, reducedMotion]);
    /* 顶栏状态：未连接最要紧；有工作时显示「正在做 n 件 · m 件等你」；只在回复时显示「正在回复」；没事时不显示。 */
    /* 2026-11-01 设计稿修正轮（用户定）：标题仍是设置里的助手名，下面一行先是连接灯（在线 / 连接中 / 未连接，
       真实取自原生连接服务，见 link-status.ts），后面接工作状态或「正在回复」。 */
    const link = useLinkLevel(data.connected, data.link);
    const work = liveWorkLine(running.length, waiting.length);
    const status = link !== 'online' ? '' : work || (data.busy ? '正在回复' : '');
    const title = useAssistantName();
    /* 顶栏不放 logo（logo 只在抽屉里）。 */
    return _jsxs("section", { className: css.page, hidden: hidden, "data-page": "chat", "data-lite-single": "", children: [_jsx(TopBar, { ctx: ctx, title: title, link: link, ...(status ? { sub: status } : {}), live: Boolean(work), children: _jsx("button", { ref: searchToggle, className: css.icon, "aria-label": "\u641C\u7D22\u4F1A\u8BDD\u5185\u5BB9", "aria-expanded": searching, onClick: () => toggleSearch(!searching), children: _jsxs("svg", { className: css.glyph, viewBox: "0 0 24 24", "aria-hidden": "true", children: [_jsx("circle", { cx: "10", cy: "10", r: "6" }), _jsx("path", { d: "m15 15 5 5" })] }) }) }), _jsx("div", { className: css.chatFindFold, "aria-hidden": !searching, onKeyDown: e => {
                    if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        toggleSearch(false);
                    }
                }, children: _jsx("div", { className: css.chatFindClip, children: _jsxs("div", { className: css.chatFind, children: [_jsx("input", { ref: searchInput, disabled: !searching, "aria-label": "\u641C\u7D22\u5F53\u524D\u4F1A\u8BDD", placeholder: "\u641C\u7D22\u5F53\u524D\u4F1A\u8BDD", value: query, onChange: e => { setQuery(e.target.value); setIndex(0); }, onKeyDown: e => {
                                    if (e.key === 'Enter' && !e.nativeEvent.isComposing && matches.length)
                                        setIndex((position + (e.shiftKey ? -1 : 1) + matches.length) % matches.length);
                                } }), _jsx("span", { "aria-live": "polite", children: query.trim() && (matches.length ? (position + 1) + '/' + matches.length : '无匹配') }), _jsx("button", { disabled: !searching || !matches.length, "aria-label": "\u4E0A\u4E00\u4E2A\u5339\u914D", onClick: () => setIndex((position + matches.length - 1) % matches.length), children: "\u2191" }), _jsx("button", { disabled: !searching || !matches.length, "aria-label": "\u4E0B\u4E00\u4E2A\u5339\u914D", onClick: () => setIndex((position + 1) % matches.length), children: "\u2193" }), _jsx("button", { disabled: !searching, "aria-label": "\u5173\u95ED\u641C\u7D22", onClick: () => toggleSearch(false), children: "\u00D7" })] }) }) }), _jsx(AwayBanner, { ctx: ctx }), _jsx(AttentionTray, { ctx: ctx }), _jsx("div", { ref: chat, className: css.chat, children: props.renderSlot('main', {}, { entryKey: 'conversation' }) }), _jsx("button", { ref: returnButton, type: "button", className: css.chatBottom, disabled: !awayFromBottom, "aria-hidden": !awayFromBottom, "aria-label": "\u8FD4\u56DE\u4F1A\u8BDD\u5E95\u90E8", onClick: () => { setSearching(false); stick.current?.jump(); }, children: "\u2193" })] });
}
/** 「你不在时…」：一直留着，用户点掉或点开才收。 */
function AwayBanner({ ctx }) {
    const live = ctx.live;
    const away = useSyncExternalStore(live?.awaySummary.subscribe ?? noopSubscribe, live?.awaySummary.get ?? (() => null));
    if (!away || !live)
        return null;
    const open = () => { live.awaySummary.dismiss(); if (away.workId)
        live.actions.openWork(away.workId);
    else
        ctx.go('work'); };
    return _jsxs("div", { className: css.away, role: "status", children: [_jsxs("button", { className: css.awayBody, onClick: open, children: [_jsx("b", { children: away.title }), away.text && _jsx("span", { children: away.text })] }), _jsx("button", { className: css.icon, "aria-label": "\u77E5\u9053\u4E86", onClick: () => live.awaySummary.dismiss(), children: _jsx(Glyph, { name: "close" }) })] });
}
/** 等你处理：对话页顶部一条，点开就地答。这是审批 / 填写 / 登录卡在主界面上的保底位置。 */
function AttentionTray({ ctx }) {
    const [open, setOpen] = useState(false);
    const list = ctx.waiting;
    useEffect(() => { if (!list.length)
        setOpen(false); }, [list.length]);
    if (!list.length)
        return null;
    const first = list[0];
    return _jsxs("div", { className: css.tray, "data-open": open, children: [_jsxs("button", { className: css.trayHead, "aria-expanded": open, onClick: () => setOpen(!open), children: [_jsx("span", { className: css.mark, "data-kind": "attention" }), _jsxs("span", { className: css.trayText, children: [_jsx("b", { children: list.length > 1 ? `${list.length} 件事等你处理` : statusOf(first.status).label }), _jsx("span", { children: list.length > 1 ? first.title : attentionOf(first)?.message ?? first.title })] }), _jsx("span", { className: css.trayChevron, children: _jsx(Glyph, { name: "chevron" }) })] }), open && _jsx("div", { className: css.trayList, children: list.map(item => _jsxs("div", { className: css.trayItem, children: [_jsx("button", { className: css.trayTitle, onClick: () => ctx.props.actions.openCard(item.id), children: item.title }), _jsx(AttentionActions, { ctx: ctx, item: item })] }, item.id)) })] });
}
/** 处理一件「等你」的工作：确认 / 拒绝（审批桥能答时）、去填写 / 去登录（服务端给的入口）、补一句。 */
function AttentionActions({ ctx, item, full }) {
    const live = ctx.live;
    useSyncExternalStore(live?.approvals.subscribe ?? noopSubscribe, live?.approvals.getVersion ?? (() => 0));
    const attention = attentionOf(item);
    const sessionId = item.card?.sessionId;
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState('');
    const run = async (action, value) => {
        setBusy(true);
        setNote('');
        try {
            await ctx.props.command(action, value);
            if (action === 'work.supplement') {
                setText('');
                setNote('已发给它');
            }
        }
        catch (cause) {
            setNote(cause instanceof Error ? cause.message : String(cause));
        }
        finally {
            setBusy(false);
        }
    };
    const decidable = item.status === 'waiting-approval' && Boolean(live?.approvals.canDecide(sessionId));
    const decide = (decision) => { if (!live?.approvals.decide(sessionId, decision))
        setNote('这条确认已经不在了，刷新看看最新状态'); };
    const action = attention?.action;
    return _jsxs("div", { className: css.actions, children: [full && attention?.message && _jsx("p", { className: css.attentionText, children: attention.message }), attention?.risk && _jsxs("p", { className: css.risk, children: ["\u98CE\u9669\uFF1A", attention.risk] }), _jsxs("div", { className: css.buttons, children: [decidable && _jsxs(_Fragment, { children: [_jsxs("button", { className: css.primary, onClick: () => decide('allow'), children: [_jsx(Glyph, { name: "check" }), "\u6279\u51C6"] }), _jsx("button", { className: css.secondary, onClick: () => decide('reject'), children: "\u62D2\u7EDD" })] }), action?.kind === 'open-url' && _jsxs("button", { className: css.primary, onClick: () => { if (!openNoticeEntry(action.url, true))
                            window.open(action.url, '_blank', 'noopener'); }, children: [_jsx(Glyph, { name: "open" }), action.label || '去填写'] }), item.status === 'waiting-approval' && !decidable && _jsxs("span", { className: css.hint, children: ["\u786E\u8BA4\u6309\u94AE\u8FD8\u6CA1\u63A5\u4E0A\uFF08\u9875\u9762\u521A\u6253\u5F00\u65F6\u4F1A\u8FD9\u6837\uFF09\u3002\u7A0D\u7B49\u51E0\u79D2\uFF0C\u6216\u5728\u5BF9\u8BDD\u91CC\u8DDF ", LITE_NAME, " \u8BF4\u300C\u7EE7\u7EED\u300D\u3002"] })] }), item.status === 'waiting-input' && !action && _jsxs("form", { className: css.inline, onSubmit: event => { event.preventDefault(); if (text.trim())
                    void run('work.supplement', { workId: item.id, text }); }, children: [_jsx("input", { value: text, onChange: event => setText(event.target.value), placeholder: "\u8865\u5145\u4E00\u53E5\u7ED9\u5B83", "aria-label": "\u8865\u5145\u8BF4\u660E" }), _jsx("button", { className: css.secondary, disabled: busy || !text.trim(), children: "\u53D1\u9001" })] }), note && _jsx("p", { className: css.hint, role: "status", children: note })] });
}
/* ================= 顶部提醒（替代精灵气泡，队列同一个） ================= */
function Toasts({ ctx }) {
    const live = ctx.live;
    const snap = useSyncExternalStore(live.bubbles.subscribe, live.bubbles.getSnapshot);
    useSyncExternalStore(live.actions.subscribeDecidable ?? noopSubscribe, live.actions.decidableVersion ?? (() => 0));
    if (!snap.visible.length)
        return null;
    return _jsx("div", { className: css.toasts, "aria-live": "polite", children: snap.visible.map(notice => _jsx(Toast, { notice: notice, ctx: ctx }, notice.key)) });
}
function Toast({ notice, ctx }) {
    const live = ctx.live;
    const actions = live.actions;
    const dismiss = () => live.bubbles.dismiss(notice.key);
    const ack = () => actions.acknowledge?.(notice);
    const open = () => {
        ack();
        dismiss();
        if (notice.kind === 'input' && openNoticeEntry(notice.entryUrl))
            return;
        if (notice.workId && notice.tone !== 'reminder')
            actions.openWork(notice.workId);
        else
            actions.openPostbox(notice.postboxId);
    };
    const decidable = notice.kind === 'confirm' && actions.canDecide(notice);
    return _jsxs("div", { className: css.toast, "data-tone": notice.tone, role: notice.kind === 'info' ? 'status' : 'alertdialog', onPointerEnter: () => live.bubbles.hold(notice.key, true), onPointerLeave: () => live.bubbles.hold(notice.key, false), children: [_jsxs("button", { className: css.toastBody, onClick: open, children: [_jsx("small", { children: notice.eyebrow }), _jsx("b", { children: notice.title }), notice.text && _jsx("span", { children: notice.text }), notice.risk && _jsxs("span", { className: css.risk, children: ["\u98CE\u9669\uFF1A", notice.risk] })] }), _jsxs("div", { className: css.toastActions, children: [decidable && _jsxs(_Fragment, { children: [_jsx("button", { className: css.primary, onClick: () => { if (actions.decide(notice, 'allow')) {
                                    ack();
                                    dismiss();
                                } }, children: "\u786E\u8BA4" }), _jsx("button", { className: css.secondary, onClick: () => { if (actions.decide(notice, 'reject')) {
                                    ack();
                                    dismiss();
                                } }, children: "\u62D2\u7EDD" })] }), notice.kind === 'confirm' && !decidable && _jsx("button", { className: css.secondary, onClick: open, children: "\u53BB\u5904\u7406" }), notice.kind === 'input' && _jsx("button", { className: css.primary, onClick: open, children: notice.entryLabel ?? '去填写' }), _jsx("button", { className: css.icon, "aria-label": "\u6536\u8D77", onClick: dismiss, children: _jsx(Glyph, { name: "close" }) })] })] });
}
/* ================= 工作 ================= */
export function WorkPage({ ctx }) {
    const { data, items } = ctx;
    const now = useNow();
    const [more, setMore] = useState(false);
    const [filter, setFilter] = useState('all');
    const list = useRef(null);
    const lastFilter = useRef(filter);
    useLayoutEffect(() => {
        if (lastFilter.current === filter)
            return;
        lastFilter.current = filter;
        const node = list.current;
        if (!node?.animate || node.closest('[data-reduced-motion="true"]') || matchMedia('(prefers-reduced-motion: reduce)').matches)
            return;
        const motion = node.animate([{ opacity: .45 }, { opacity: 1 }], { duration: 270, easing: 'ease-out' });
        return () => motion.cancel();
    }, [filter]);
    const waiting = ctx.waiting;
    const active = ctx.running;
    const rest = ctx.finished;
    const loading = data.domainLoading?.work ?? data.loading;
    /* 从抽屉点组，直接选择对应筛选；无数据也可看空态。 */
    useEffect(() => {
        if (!ctx.workFocus)
            return;
        setFilter(ctx.workFocus);
        ctx.clearWorkFocus();
    }, [ctx.workFocus]);
    return _jsxs("section", { className: css.page, "data-page": "work", children: [_jsx(TopBar, { ctx: ctx, title: "\u540E\u53F0\u5DE5\u4F5C", sub: [active.length ? `${active.length} 件进行中` : '', waiting.length ? `${waiting.length} 件等你` : ''].filter(Boolean).join(' · ') || `${items.length} 件` }), _jsx(WorkFilters, { value: filter, counts: { attention: waiting.length, active: active.length, finished: rest.length }, onChange: setFilter }), _jsxs("div", { ref: list, className: css.scroll, children: [_jsx(AwayBanner, { ctx: ctx }), !items.length && _jsx("p", { className: css.empty, children: loading ? '正在读取…' : `还没有后台工作。在对话里让 ${LITE_NAME} 去做。` }), items.length > 0 && filter !== 'all' && ({ attention: waiting.length, active: active.length, finished: rest.length }[filter] === 0) && _jsx("p", { className: css.empty, children: "\u8FD9\u91CC\u6682\u65F6\u6CA1\u6709\u5DE5\u4F5C\u3002" }), (filter === 'all' || filter === 'attention') && waiting.length > 0 && _jsx(Group, { title: `要你处理 · ${waiting.length}`, id: "attention", children: waiting.map(item => _jsx(WorkLine, { item: item, ctx: ctx, now: now }, item.id)) }), (filter === 'all' || filter === 'active') && active.length > 0 && _jsx(Group, { title: `进行中 · ${active.length}`, id: "active", children: active.map(item => _jsx(WorkLine, { item: item, ctx: ctx, now: now }, item.id)) }), (filter === 'all' || filter === 'finished') && rest.length > 0 && _jsxs(Group, { title: `已结束 · ${rest.length}`, id: "finished", children: [_jsx("div", { className: workCss.finishedList, children: (more ? rest : rest.slice(0, 12)).map(item => _jsx(WorkLine, { item: item, ctx: ctx, now: now }, item.id)) }), rest.length > 12 && !more && _jsxs("button", { className: css.more, onClick: () => setMore(true), children: ["\u663E\u793A\u5168\u90E8 ", rest.length, " \u4EF6"] })] }), filter === 'all' && _jsx(Plans, { ctx: ctx, plans: data.plans })] })] });
}
function WorkLine({ item, ctx, now }) {
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState('');
    const retrying = useRef(false);
    const kind = liteCardKind(item.status);
    const label = liteCardLabel(item.status);
    const retry = async () => {
        if (retrying.current)
            return;
        retrying.current = true;
        setBusy(true);
        setNote('');
        try {
            await ctx.props.command('work.retry', { workId: item.id, operationId: opId() });
        }
        catch (cause) {
            setNote(cause instanceof Error ? cause.message : String(cause));
        }
        finally {
            retrying.current = false;
            setBusy(false);
        }
    };
    /* 09 列表独立于对话卡；沿用新建时间倒序，默认折叠。 */
    return _jsxs("article", { className: workCss.listRow, "data-lite-work": "", "data-collapsed": "", "data-kind": kind, "data-work-id": item.id, children: [_jsxs("button", { type: "button", className: workCss.rowOpen, onClick: () => ctx.props.actions.openCard(item.id), "aria-label": `查看工作：${item.title}，${label}`, children: [_jsx("span", { className: workCss.rowMark, "aria-hidden": "true", children: kind === 'done' ? '✓' : kind === 'failed' ? '◆' : item.status === 'cancelled' ? '×' : kind === 'active' ? '•' : '◇' }), _jsx("span", { className: workCss.rowTitle, children: item.title }), _jsx("span", { className: workCss.rowMeta, children: kind === 'done' ? _jsx("time", { dateTime: item.updatedAt, children: ago(item.updatedAt, now) }) : label })] }), kind === 'failed' && _jsx("button", { type: "button", className: workCss.rowRetry, disabled: busy, "aria-label": `重试：${item.title}`, onClick: () => void retry(), children: busy ? '提交中…' : '重试' }), note && _jsx("p", { className: workCss.rowNote, role: "alert", children: note })] });
}
function WorkDetailPresence({ ctx, id, reduced }) {
    const [retained, setRetained] = useState(id);
    const layer = useRef(null);
    useLayoutEffect(() => {
        if (layer.current)
            layer.current.inert = !id;
        if (id || reduced || matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setRetained(id);
            return;
        }
        if (!retained)
            return;
        const timer = window.setTimeout(() => setRetained(null), 280);
        return () => window.clearTimeout(timer);
    }, [id, reduced, retained]);
    const shown = id || retained;
    return shown ? _jsx("div", { ref: layer, className: workCss.detailMotion, "data-open": Boolean(id), children: _jsx(WorkDetail, { ctx: ctx, id: shown }, shown) }) : null;
}
export function WorkDetail({ ctx, id }) {
    const { props, items } = ctx;
    const item = items.find(value => value.id === id);
    const now = useNow(10_000);
    const [supplement, setSupplement] = useState('');
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState('');
    const resultsRef = useRef(null);
    const close = () => props.actions.openCard(null);
    if (!item)
        return _jsx(Sheet, { title: "\u5DE5\u4F5C", onClose: close, children: _jsx("p", { className: css.empty, children: "\u6B63\u5728\u8BFB\u53D6\u8FD9\u4EF6\u5DE5\u4F5C\u2026" }) });
    const status = statusOf(item.status);
    const card = item.card;
    const row = item.row;
    const active = status.kind === 'active' || status.kind === 'attention';
    const retryable = item.status === 'failed' || item.status === 'cancelled' || item.status === 'interrupted';
    const run = async (action, value) => {
        setBusy(true);
        setNote('');
        try {
            await props.command(action, value);
            if (action === 'work.supplement') {
                setSupplement('');
                setNote('已发给它');
            }
        }
        catch (cause) {
            setNote(cause instanceof Error ? cause.message : String(cause));
        }
        finally {
            setBusy(false);
        }
    };
    const artifacts = row?.artifacts ?? [];
    const error = row?.error ?? card?.error;
    const returnToChat = () => { close(); ctx.go('chat'); };
    const cancel = () => { if (confirm('取消这件工作？'))
        void run('work.cancel', { workId: item.id }); };
    const reason = explainFailure(error);
    const footer = _jsxs("div", { className: workCss.detailFooter, children: [active && _jsx("button", { className: css.secondary, disabled: busy, onClick: cancel, children: "\u53D6\u6D88\u8FD9\u4EF6\u5DE5\u4F5C" }), retryable && _jsx("button", { className: css.primary, disabled: busy, onClick: () => void run('work.retry', { workId: item.id, operationId: opId() }), children: item.status === 'cancelled' ? '重新派这件活' : '重试' }), status.kind === 'done' && artifacts.length > 0 && _jsx("button", { className: css.primary, onClick: () => resultsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), children: "\u770B\u7ED3\u679C" }), _jsx("button", { className: css.secondary, onClick: returnToChat, children: "\u56DE\u5230\u5BF9\u8BDD" })] });
    const menu = [
        { label: '回到对话', onSelect: returnToChat },
        ...(active ? [{ label: '取消这件工作', onSelect: cancel, disabled: busy }] : []),
        ...(error ? [{ label: '复制原始信息', onSelect: () => { void navigator.clipboard?.writeText(String(error)).then(() => setNote('原始信息已复制'), () => setNote('复制没成功，可以展开「查看原始信息」长按复制')); } }] : []),
    ];
    return _jsx(Sheet, { title: "\u4EFB\u52A1\u8BE6\u60C5", sub: "\u540E\u53F0\u5DE5\u4F5C", back: true, menu: menu, onClose: close, footer: footer, children: _jsxs("div", { className: css.detail, children: [_jsxs("div", { className: workCss.detailCard, children: [_jsxs("div", { className: css.detailHead, children: [_jsxs("span", { className: css.chip, "data-kind": status.kind, children: [_jsx("span", { className: css.mark, "data-kind": status.kind }), status.label] }), _jsxs("time", { children: ["\u66F4\u65B0\u4E8E ", ago(item.updatedAt, now)] })] }), _jsx(DetailTitle, { text: item.title }), typeof item.progress === 'number' && active && _jsx("span", { className: css.bar, children: _jsx("i", { style: { width: `${Math.round(item.progress * (item.progress <= 1 ? 100 : 1))}%` } }) })] }), needsYou(item) && _jsxs("div", { className: workCss.detailSection, children: [_jsx("h3", { className: workCss.detailSectionTitle, children: "\u7B49\u4F60\u5904\u7406" }), _jsx("div", { className: workCss.detailPanel, children: _jsx(AttentionActions, { ctx: ctx, item: item, full: true }) })] }), reason && _jsxs("div", { className: workCss.detailSection, "data-failure-kind": reason.kind, children: [_jsx("h3", { className: workCss.detailSectionTitle, children: item.status === 'failed' ? '为什么没做成' : '原因' }), _jsxs("div", { className: workCss.detailPanel, children: [_jsx("p", { className: workCss.reason, children: reason.sentence }), reason.raw && _jsxs("details", { className: workCss.raw, children: [_jsx("summary", { children: "\u67E5\u770B\u539F\u59CB\u4FE1\u606F" }), _jsx("pre", { children: reason.raw })] })] })] }), card && card.steps.length > 0 && _jsxs("div", { className: workCss.detailSection, children: [_jsx("h3", { className: workCss.detailSectionTitle, children: "\u6B65\u9AA4" }), _jsx("div", { className: workCss.detailPanel, children: _jsx("ol", { className: css.steps, children: card.steps.map(step => _jsxs("li", { "data-status": step.status, children: [_jsx("span", { className: css.stepMark }), step.label] }, step.index)) }) })] }), item.doing && status.kind !== 'done' && _jsxs("div", { className: workCss.detailSection, children: [_jsx("h3", { className: workCss.detailSectionTitle, children: "\u6B63\u5728\u505A" }), _jsx("div", { className: workCss.detailPanel, children: _jsx("p", { className: css.doing, children: item.doing }) })] }), row?.goal && _jsxs("div", { className: workCss.detailSection, children: [_jsx("h3", { className: workCss.detailSectionTitle, children: "\u5DE5\u4F5C\u76EE\u6807" }), _jsx("div", { className: workCss.detailPanel, children: _jsx("p", { children: row.goal }) })] }), artifacts.length > 0 && _jsxs("div", { className: workCss.detailSection, ref: resultsRef, children: [_jsx("h3", { className: workCss.detailSectionTitle, children: "\u6210\u679C" }), artifacts.map(artifact => _jsx(Artifact, { artifact: artifact }, artifact.id))] }), status.kind === 'done' && !artifacts.length && _jsx("p", { className: css.hint, children: "\u6210\u679C\u6B63\u5728\u8BFB\u53D6\uFF0C\u6216\u8FD9\u4EF6\u5DE5\u4F5C\u6CA1\u6709\u7559\u4E0B\u6587\u4EF6\u3002\u5B8C\u6210\u4FE1\u4E5F\u5728\u6D88\u606F\u91CC\u3002" }), active && item.status !== 'waiting-input' && _jsxs("form", { className: css.inline, onSubmit: event => { event.preventDefault(); if (supplement.trim())
                        void run('work.supplement', { workId: item.id, text: supplement }); }, children: [_jsx("input", { value: supplement, onChange: event => setSupplement(event.target.value), placeholder: "\u7ED9\u5B83\u8865\u5145\u4E00\u53E5", "aria-label": "\u8865\u5145\u8BF4\u660E" }), _jsx("button", { className: css.secondary, disabled: busy || !supplement.trim(), children: "\u53D1\u9001" })] }), note && _jsx("p", { className: css.hint, role: "status", children: note })] }) });
}
/** 09b：标题中号；超过两行先收起，点一下看全。 */
function DetailTitle({ text }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    const [long, setLong] = useState(false);
    useLayoutEffect(() => { const el = ref.current; if (el && !open)
        setLong(el.scrollHeight > el.clientHeight + 1); }, [text, open]);
    return _jsx("h2", { ref: ref, className: css.detailTitle, "data-open": open ? '' : undefined, "data-long": long ? '' : undefined, ...(long || open ? { role: 'button', tabIndex: 0, 'aria-expanded': open, title: open ? '收起标题' : '展开完整标题', onClick: () => setOpen(!open), onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setOpen(!open);
            } } } : {}), children: text });
}
function Artifact({ artifact }) {
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    return _jsxs("div", { className: css.artifact, children: [_jsxs("div", { className: css.artifactHead, children: [_jsx("b", { children: artifact.title }), artifact.url && _jsx("a", { className: css.icon, href: artifact.url, target: "_blank", rel: "noopener", "aria-label": `打开 ${artifact.title}`, children: _jsx(Glyph, { name: "open" }) }), artifact.text && _jsx("button", { className: css.icon, "aria-label": "\u590D\u5236", onClick: () => void navigator.clipboard?.writeText(artifact.text ?? '').then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }), children: _jsx(Glyph, { name: copied ? 'check' : 'copy' }) })] }), artifact.text && _jsxs(_Fragment, { children: [_jsx("pre", { className: css.artifactText, "data-open": open, children: artifact.text }), artifact.text.length > 280 && _jsx("button", { className: css.more, onClick: () => setOpen(!open), children: open ? '收起' : '展开全文' })] })] });
}
function CreateSheet({ ctx }) {
    const [goal, setGoal] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const close = () => ctx.setSheet(null);
    const submit = () => {
        if (!goal.trim())
            return;
        setBusy(true);
        setError('');
        void ctx.props.command('work.create', { goal: goal.trim(), operationId: opId() })
            .then(() => { close(); ctx.go('work'); })
            .catch(cause => setError(cause instanceof Error ? cause.message : String(cause)))
            .finally(() => setBusy(false));
    };
    return _jsxs(Sheet, { title: "\u6D3E\u4E00\u4EF6\u540E\u53F0\u5DE5\u4F5C", onClose: close, compact: true, children: [_jsx("p", { className: css.sheetLead, children: "\u5199\u6E05\u695A\u8981\u505A\u4EC0\u4E48\u3002\u5B83\u5728\u540E\u53F0\u505A\uFF0C\u4F60\u5173\u6389\u9875\u9762\u4E5F\u4F1A\u505A\u5B8C\uFF0C\u7ED3\u679C\u4F1A\u5728\u6D88\u606F\u91CC\u544A\u8BC9\u4F60\u3002" }), _jsx("textarea", { className: css.textarea, autoFocus: true, rows: 4, value: goal, onChange: event => setGoal(event.target.value), placeholder: "\u6BD4\u5982\uFF1A\u6574\u7406\u8FD9\u5468\u7684 AI \u65B0\u95FB\uFF0C\u5217\u4E94\u6761\u8981\u70B9", "aria-label": "\u5DE5\u4F5C\u5185\u5BB9" }), error && _jsx("p", { className: css.errorText, children: error }), _jsxs("div", { className: css.buttons, "data-end": true, children: [_jsx("button", { className: css.secondary, onClick: close, children: "\u53D6\u6D88" }), _jsx("button", { className: css.primary, disabled: busy || !goal.trim(), onClick: submit, children: "\u6D3E\u51FA\u53BB" })] })] });
}
function Plans({ ctx, plans }) {
    const [adding, setAdding] = useState(false);
    const [goal, setGoal] = useState('');
    const [minutes, setMinutes] = useState(60);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState('');
    const now = useNow();
    const list = plans.filter(plan => !plan.cancelled);
    const run = async (action, value) => {
        setBusy(true);
        setNote('');
        try {
            await ctx.props.command(action, value);
            if (action === 'plan.create') {
                setGoal('');
                setAdding(false);
            }
        }
        catch (cause) {
            setNote(cause instanceof Error ? cause.message : String(cause));
        }
        finally {
            setBusy(false);
        }
    };
    return _jsxs(Group, { title: "\u6301\u7EED\u804C\u8D23", action: _jsx("button", { className: css.link, onClick: () => setAdding(!adding), children: adding ? '收起' : '新建' }), children: [adding && _jsxs("div", { className: css.planForm, children: [_jsx("textarea", { className: css.textarea, rows: 2, value: goal, onChange: event => setGoal(event.target.value), placeholder: "\u6BCF\u9694\u4E00\u6BB5\u65F6\u95F4\u8981\u505A\u7684\u4E8B", "aria-label": "\u6301\u7EED\u804C\u8D23\u5185\u5BB9" }), _jsxs("label", { className: css.field, children: ["\u6BCF\u9694", _jsx("input", { type: "number", min: 5, step: 5, value: minutes, onChange: event => setMinutes(Math.max(5, Number(event.target.value) || 5)), "aria-label": "\u95F4\u9694\u5206\u949F" }), "\u5206\u949F\u505A\u4E00\u6B21"] }), _jsx("div", { className: css.buttons, "data-end": true, children: _jsx("button", { className: css.primary, disabled: busy || !goal.trim(), onClick: () => void run('plan.create', { goal: goal.trim(), minutes, operationId: opId() }), children: "\u5F00\u59CB" }) })] }), !list.length && !adding && _jsx("p", { className: css.empty, children: "\u8FD8\u6CA1\u6709\u6301\u7EED\u804C\u8D23\u3002" }), list.map(plan => _jsxs("div", { className: css.line, "data-kind": plan.paused ? 'idle' : 'active', children: [_jsxs("div", { className: css.lineMain, "data-static": true, children: [_jsx("span", { className: css.mark, "data-kind": plan.paused ? 'idle' : 'active' }), _jsxs("span", { className: css.lineText, children: [_jsx("b", { children: plan.title || plan.goal }), _jsx("span", { children: plan.paused ? '已暂停' : plan.nextAt ? `下次 ${ago(plan.nextAt, now).replace('前', '后')}` : '等待调度' })] })] }), _jsxs("div", { className: css.buttons, "data-end": true, children: [_jsx("button", { className: css.secondary, disabled: busy, onClick: () => void run(plan.paused ? 'plan.resume' : 'plan.pause', { planId: plan.planId, operationId: opId() }), children: plan.paused ? '继续' : '暂停' }), _jsx("button", { className: css.secondary, disabled: busy, onClick: () => { if (confirm('取消这项持续职责？已经发生的工作仍会保留。'))
                                    void run('plan.cancel', { planId: plan.planId, operationId: opId() }); }, children: "\u53D6\u6D88" })] })] }, plan.planId)), note && _jsx("p", { className: css.hint, role: "status", children: note })] });
}
function PostboxPage({ ctx }) {
    const { props, data } = ctx;
    const now = useNow();
    const [filter, setFilter] = useState('inbox');
    const [openId, setOpenId] = useState(null);
    const [busyAll, setBusyAll] = useState('');
    /* 进来就算「看过」：底栏红点消失；「已读」仍是每封信自己的状态。 */
    const newest = data.letters.reduce((max, letter) => Math.max(max, letter.at ?? Date.parse(letter.createdAt) ?? 0), 0);
    useEffect(() => { if (newest)
        markPostboxSeen(newest); }, [newest]);
    const letters = data.letters.filter(letter => filter === 'archived' ? letter.archived : !letter.archived && (filter === 'inbox' || (filter === 'unread' ? !letter.read : Boolean(letter.todo && !letter.todo.closed))));
    const unread = data.letters.filter(letter => !letter.archived && !letter.read);
    const loading = data.domainLoading?.postbox ?? data.loading;
    const readAll = async () => {
        let failed = 0;
        setBusyAll('正在标为已读…');
        /* 沿用经典版的做法：逐封 postbox.read，顺序执行（并发会互相冲掉快照）。待办信不在这里统一处理。 */
        for (const letter of unread.filter(value => !value.todo)) {
            try {
                await props.command('postbox.read', { id: letter.id });
            }
            catch {
                failed += 1;
            }
        }
        setBusyAll(failed ? `${failed} 封没标上` : '');
    };
    return _jsxs("section", { className: css.page, "data-page": "postbox", children: [_jsx(TopBar, { ctx: ctx, title: "\u661F\u90AE\u5323", sub: unread.length ? `${unread.length} 封未读` : '都看过了', children: unread.some(letter => !letter.todo) ? _jsx("button", { className: css.textButton, disabled: Boolean(busyAll), onClick: () => void readAll(), children: "\u5168\u90E8\u5DF2\u8BFB" }) : undefined }), _jsx("div", { className: css.segment, role: "tablist", children: [['inbox', '全部'], ['unread', '未读'], ['todo', '待办'], ['archived', '归档']].map(([key, label]) => _jsx("button", { role: "tab", "aria-selected": filter === key, onClick: () => setFilter(key), children: label }, key)) }), _jsxs("div", { className: css.scroll, children: [busyAll && _jsx("p", { className: css.hint, children: busyAll }), !letters.length && _jsx("p", { className: css.empty, children: loading ? '正在读取…' : filter === 'inbox' ? '星邮匣是空的。后台工作做完、要你处理、提醒到点时，信会出现在这里。' : '这里没有信。' }), _jsx("div", { className: css.letters, children: letters.map(letter => _jsx(Letter, { letter: letter, ctx: ctx, now: now, open: openId === letter.id, toggle: () => setOpenId(openId === letter.id ? null : letter.id) }, letter.id)) })] })] });
}
function Letter({ letter, ctx, now, open, toggle }) {
    const { props, live } = ctx;
    const [busy, setBusy] = useState(false);
    const failed = deliveryFailed(letter.delivery);
    const run = async (action) => { setBusy(true); try {
        await props.command(action, { id: letter.id });
    }
    catch { /* 快照会刷新出真实状态 */ }
    finally {
        setBusy(false);
    } };
    const onToggle = () => {
        /* 没有待办的信：打开即已读（和经典版一致）。待办信不自动标读，由用户点「标为已读」。 */
        if (!open && !letter.read && !letter.todo)
            void props.command('postbox.read', { id: letter.id }).catch(() => { });
        toggle();
    };
    const todo = letter.todo;
    return _jsxs("article", { className: css.letter, "data-kind": letter.kind, "data-proactive": letter.proactive ? 'true' : undefined, "data-unread": !letter.read, "data-open": open, children: [_jsxs("button", { className: css.letterHead, "aria-expanded": open, onClick: onToggle, children: [_jsx("span", { className: css.unreadDot, "aria-hidden": "true" }), _jsxs("span", { className: css.lineText, children: [_jsx("b", { children: letter.title }), !open && _jsx("span", { className: css.preview, children: letter.body })] }), _jsxs("span", { className: css.letterMeta, children: [_jsx("time", { children: ago(letter.at ?? letter.createdAt, now) }), todo && _jsx("em", { "data-closed": todo.closed, "data-kind": todo.closed ? 'idle' : todo.status === 'in_progress' ? 'active' : 'attention', children: todo.statusLabel }), failed && _jsx("em", { "data-kind": "failed", children: "\u6295\u9012\u5931\u8D25" })] })] }), open && _jsxs("div", { className: css.letterBody, children: [_jsx("p", { className: css.prose, children: letter.body }), todo && todo.progress && _jsx("p", { className: css.hint, children: todo.progress }), todo && todo.updates.length > 0 && _jsx("ol", { className: css.updates, children: todo.updates.map(update => _jsxs("li", { children: [_jsx("time", { children: ago(update.at, now) }), _jsx("b", { children: update.title }), update.body && _jsx("span", { children: update.body })] }, update.id)) }), _jsxs("div", { className: css.buttons, children: [letter.workId && _jsx("button", { className: css.secondary, onClick: () => live ? live.actions.openWork(letter.workId) : props.actions.openCard(letter.workId), children: "\u67E5\u770B\u5DE5\u4F5C" }), !letter.read && _jsx("button", { className: css.secondary, disabled: busy, onClick: () => void run('postbox.read'), children: "\u6807\u4E3A\u5DF2\u8BFB" }), failed && _jsx("button", { className: css.secondary, disabled: busy, onClick: () => void run('postbox.retry'), children: "\u91CD\u65B0\u6295\u9012" }), !letter.archived && (!todo || todo.closed) && _jsx("button", { className: css.secondary, disabled: busy, onClick: () => void run('postbox.archive'), children: "\u5F52\u6863" })] })] })] });
}
/* ================= 日程（2026-11-01 calendar） =================
   本账号在知序里的日程，只读月历。正文在 LiteCalendar.tsx，数据在 calendar.ts。 */
const PAGE_TABS = ['chat', 'work', 'notices', 'postbox', 'calendar', 'memory', 'me'];
function MainPages({ ctx, reducedMotion }) {
    const tab = ctx.tab;
    const [route, setRoute] = useState({ current: tab, previous: null });
    const monthCache = useRef({});
    if (route.current !== tab) {
        const immediate = reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
        setRoute({ current: tab, previous: immediate ? null : route.current });
    }
    useEffect(() => {
        if (!route.previous)
            return;
        const timer = setTimeout(() => setRoute(state => state === route ? { current: tab, previous: null } : state), 500);
        return () => clearTimeout(timer);
    }, [route, tab]);
    return _jsx("div", { className: css.pageStack, children: PAGE_TABS.map(key => {
            const leaving = route.previous === key;
            const active = key === tab;
            const visible = active || leaving;
            if (!visible && key !== 'chat')
                return null;
            return _jsx("div", { className: css.pageLayer, "data-route": key, "data-motion": leaving ? 'out' : active && route.previous ? 'in' : undefined, hidden: !visible, "aria-hidden": !active, ref: node => { if (node)
                    node.inert = !active; }, children: key === 'chat' ? _jsx(ChatPage, { ctx: ctx, hidden: !visible })
                    : key === 'work' ? _jsx(WorkPage, { ctx: ctx })
                        : key === 'calendar' ? _jsx(CalendarPage, { ctx: ctx, monthCache: monthCache.current })
                            : key === 'memory' ? _jsx(MemoryPage, { ctx: ctx })
                                : key === 'me' ? _jsx(MePage, { ctx: ctx })
                                    : _jsx(NoticesPage, { ctx: ctx }) }, key);
        }) });
}
function CalendarPage({ ctx, monthCache }) {
    return _jsxs("section", { className: css.page, "data-page": "calendar", children: [_jsx(TopBar, { ctx: ctx, title: "\u65E5\u7A0B\u4E0E\u5F85\u529E", sub: "\u5317\u4EAC\u65F6\u95F4 \u00B7 \u5728\u5BF9\u8BDD\u91CC\u4E5F\u80FD\u52A0\u65E5\u7A0B" }), _jsx(LiteCalendar, { monthCache: monthCache })] });
}
/* ================= 我的 ================= */
/* 设置只有一页：人格与称呼、提醒、外观。经典版的设置中心在简洁版里不再打开；
   用的是同一份数据：人格走 /dot-persona，提醒走星邮匣的提醒偏好，字号走个人设置，主题是简洁版自己的本机偏好。 */
function SettingsChoices({ label, value, children }) {
    const bar = useTabMarker(value);
    return _jsxs("div", { ref: bar, className: css.segment, role: "radiogroup", "aria-label": label, "data-inline": true, children: [_jsx("span", { className: css.choiceMarker, "aria-hidden": "true" }), children] });
}
function MePage({ ctx }) {
    const { props, data, prefs, setPrefs } = ctx;
    const personal = useSyncExternalStore(props.personalSettings?.subscribe ?? noopSubscribe, props.personalSettings?.getSnapshot ?? (() => null));
    /* 微信：只有开了 dsh-im 的账号才有这个服务，没有就不露入口。 */
    const im = useSyncExternalStore(props.imClient?.subscribe ?? noopSubscribe, props.imClient?.getSnapshot ?? (() => null));
    const [imOpen, setImOpen] = useState(false);
    const [permission, setPermission] = useState(() => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const asked = useRef(false);
    /* 提醒偏好在星邮匣那块数据里，打开设置就取一次。 */
    useEffect(() => { if (!asked.current) {
        asked.current = true;
        void props.loadDomain?.('postbox');
    } }, []);
    const fontScale = personal?.value.fontScale ?? 100;
    const setFont = (value) => props.personalSettings?.change({ fontScale: Math.min(130, Math.max(85, value)) });
    const reminder = data.reminderSettings;
    const events = reminder?.preferences.events;
    const reminderOff = busy || !data.connected || !reminder?.personalReminders;
    const save = async (action, patch) => {
        if (busy)
            return;
        setBusy(true);
        setError('');
        try {
            await props.command(action, patch);
            await props.loadDomain?.('postbox');
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        }
        finally {
            setBusy(false);
        }
    };
    const remindLabels = { completed: '工作完成时提醒我', attention: '需要我确认或处理时提醒我', failed: '工作失败时提醒我' };
    return _jsxs("section", { className: css.page, "data-page": "me", children: [_jsx(TopBar, { ctx: ctx, title: "\u8BBE\u7F6E", sub: data.connected ? '已连接' : '未连接', offline: !data.connected }), _jsxs("div", { className: css.scroll, children: [_jsx(Group, { title: "\u4EBA\u683C\u4E0E\u79F0\u547C", children: _jsx(LitePersona, {}) }), _jsxs(Group, { title: "\u63D0\u9192", children: [_jsxs("div", { className: css.list, children: [_jsx(Row, { label: "\u514D\u6253\u6270", ...(data.dnd ? { value: '开着' } : {}), toggle: data.dnd, onClick: () => void save('postbox.preferences', { dnd: !data.dnd }) }), _jsx(Row, { label: "\u7CFB\u7EDF\u901A\u77E5", value: window.dotAndroid ? (permission === 'granted' ? '已启动提醒同步' : '点此开启或恢复') : permission === 'granted' ? '已开启' : permission === 'denied' ? '已被浏览器拦下' : permission === 'unsupported' ? '这个浏览器不支持' : '点此开启', onClick: () => { setError(''); void props.command('notifications.enable').then(() => setPermission(window.dotAndroid ? 'granted' : typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)).catch(cause => setError(cause instanceof Error ? cause.message : String(cause))); } }), ['completed', 'attention', 'failed'].map(category => _jsx(Row, { label: remindLabels[category], toggle: events?.[category] ?? true, ...(reminderOff ? {} : { onClick: () => void save('settings.reminders', { category, enabled: !(events?.[category] ?? true) }) }) }, category)), _jsx(Row, { label: "\u98DE\u4E66\u63A8\u9001", value: data.channelStatus ? (data.channelStatus.feishuConfigured ? '已配置' : '未配置') : '—' })] }), error ? _jsx("p", { className: css.perror, role: "alert", children: error }) : _jsx("p", { className: css.hint, children: "\u5173\u6389\u63D0\u9192\u53EA\u662F\u4E0D\u518D\u4E3B\u52A8\u5F39\u51FA\uFF0C\u4ECD\u53EF\u5728\u6D88\u606F\u91CC\u67E5\u770B\u3002" })] }), im && _jsxs(Group, { title: "\u5FAE\u4FE1", children: [_jsx("div", { className: css.list, children: _jsx(Row, { label: "\u5FAE\u4FE1", value: "\u626B\u7801\u7ED1\u5B9A\u4E0E\u7BA1\u7406", onClick: () => setImOpen(true) }) }), _jsx("p", { className: css.hint, children: "\u7528\u5FAE\u4FE1\u626B\u7801\u7ED1\u5B9A\u540E\uFF0C\u5728\u5FAE\u4FE1\u91CC\u7ED9\u5B83\u53D1\u6D88\u606F\uFF0C\u5C31\u8DDF\u5728\u8FD9\u91CC\u5BF9\u8BDD\u4E00\u6837\u3002" })] }), _jsxs(Group, { title: "\u5916\u89C2", children: [_jsx(SettingsChoices, { label: "\u4E3B\u9898", value: prefs.theme, children: ['light', 'dark'].map(value => _jsx("button", { role: "radio", "aria-checked": prefs.theme === value, onClick: () => setPrefs({ theme: value }), children: value === 'light' ? '浅色' : '深色' }, value)) }), _jsx("div", { className: css.list, children: _jsxs("div", { className: css.row, "data-static": true, children: [_jsx("span", { className: css.rowLabel, children: "\u5B57\u4F53\u5927\u5C0F" }), _jsxs("span", { className: css.stepper, children: [_jsx("button", { "aria-label": "\u5B57\u53F7\u51CF\u5C0F", disabled: fontScale <= 85, onClick: () => setFont(fontScale - 5), children: "A\u2212" }), _jsxs("output", { children: [fontScale, "%"] }), _jsx("button", { "aria-label": "\u5B57\u53F7\u589E\u5927", disabled: fontScale >= 130, onClick: () => setFont(fontScale + 5), children: "A+" })] })] }) })] })] }), im && imOpen && _jsx(Sheet, { title: "\u5FAE\u4FE1", onClose: () => setImOpen(false), children: _jsx("div", { className: css.imPanel, "data-lite-im": "", children: im.render({ preferredSectionId: 'weixin' }) }) })] });
}
/** 人格与称呼：和经典版同一份云端设定。人设先预览扩写，满意了再保存。 */
function LitePersona() {
    const [view, setView] = useState(null);
    const [loadError, setLoadError] = useState('');
    const [name, setName] = useState('');
    const [userName, setUserName] = useState('');
    const [gender, setGender] = useState('unset');
    const [brief, setBrief] = useState('');
    const [expanded, setExpanded] = useState('');
    const [preview, setPreview] = useState(null);
    const [previewFor, setPreviewFor] = useState('');
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [ok, setOk] = useState('');
    const adopt = (next) => {
        setView(next);
        setName(next.profile.name);
        setUserName(next.profile.userName);
        setGender(next.profile.gender);
        setBrief(next.profile.brief);
        setExpanded(next.profile.expanded);
        setPreview(null);
    };
    useEffect(() => { loadPersona().then(adopt).catch(cause => setLoadError(cause instanceof Error ? cause.message : String(cause))); }, []);
    if (loadError)
        return _jsxs("p", { className: css.hint, children: ["\u6682\u65F6\u8BFB\u4E0D\u5230\u4EBA\u683C\u8BBE\u5B9A\uFF1A", loadError] });
    if (!view)
        return _jsx("p", { className: css.hint, children: "\u6B63\u5728\u8BFB\u53D6\u2026" });
    const p = view.profile;
    const shownName = name.trim() || view.defaults.name;
    const basicDirty = name.trim() !== p.name || userName.trim() !== p.userName || gender !== p.gender;
    const briefDirty = brief.trim() !== p.brief;
    const textDirty = expanded.trim() !== p.expanded;
    const run = async (kind, patch, done) => {
        if (busy)
            return;
        setBusy(kind);
        setError('');
        setOk('');
        try {
            const next = await savePersona(patch);
            adopt(next);
            if (next.expandError)
                setError(next.expandError);
            else
                setOk(done);
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        }
        finally {
            setBusy('');
        }
    };
    const askPreview = async () => {
        if (busy)
            return;
        const text = brief.trim();
        setBusy('expand');
        setError('');
        setOk('');
        try {
            const out = await previewPersona({ name: shownName, userName: userName.trim(), gender, brief: text });
            setPreview(out);
            setPreviewFor(text);
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        }
        finally {
            setBusy('');
        }
    };
    const button = (label, onClick, opts = {}) => _jsx("button", { type: "button", className: opts.primary ? css.primary : css.secondary, "aria-disabled": busy !== '' || Boolean(opts.disabled), onClick: () => { if (!busy && !opts.disabled)
            onClick(); }, children: label });
    return _jsxs("div", { "data-lite-persona": "", children: [_jsxs("label", { className: css.pfield, children: [_jsx("span", { children: "\u52A9\u624B\u7684\u540D\u5B57" }), _jsx("input", { value: name, maxLength: view.limits.name, placeholder: view.defaults.name, onChange: event => setName(event.target.value) })] }), _jsxs("label", { className: css.pfield, children: [_jsx("span", { children: "\u5B83\u600E\u4E48\u79F0\u547C\u4F60" }), _jsx("input", { value: userName, maxLength: view.limits.userName, placeholder: "\u4E0D\u586B\u5C31\u53EB\u201C\u4F60\u201D", onChange: event => setUserName(event.target.value) })] }), _jsxs("div", { className: css.pfield, children: [_jsx("span", { children: "\u6027\u522B" }), _jsx(SettingsChoices, { label: "\u6027\u522B", value: gender, children: GENDER_OPTIONS.map(option => _jsx("button", { type: "button", role: "radio", "aria-checked": gender === option.key, onClick: () => setGender(option.key), children: option.label }, option.key)) })] }), basicDirty && _jsx("div", { className: css.pactions, children: button(busy === 'basic' ? '保存中…' : '保存', () => void run('basic', { name: shownName, userName: userName.trim(), gender }, '已保存，下一句回复起生效。'), { primary: true }) }), _jsxs("label", { className: css.pfield, children: [_jsx("span", { children: "\u4EBA\u683C" }), _jsx("textarea", { rows: 4, value: brief, placeholder: "\u60F3\u5199\u4EC0\u4E48\u5199\u4EC0\u4E48\uFF0C\u6BD4\u5982\u5B83\u7684\u6027\u683C\u3001\u8BF4\u8BDD\u98CE\u683C\u3001\u53E3\u5934\u7985\u2026\u2026", onChange: event => setBrief(event.target.value) })] }), preview === null && (briefDirty || brief.trim() !== '') && _jsx("div", { className: css.pactions, children: brief.trim() !== '' ? button(busy === 'expand' ? '扩写中…' : briefDirty ? '预览扩写' : '重新扩写', () => void askPreview(), { primary: briefDirty }) : button(busy === 'expand' ? '保存中…' : '保存', () => void run('expand', { brief: '' }, '已清空人格，恢复默认性格。'), { primary: true }) }), preview !== null && _jsxs(_Fragment, { children: [_jsxs("label", { className: css.pfield, children: [_jsx("span", { children: "\u6269\u5199\u9884\u89C8 \u00B7 \u8FD8\u6CA1\u4FDD\u5B58" }), _jsx("textarea", { rows: 8, value: preview, onChange: event => setPreview(event.target.value) })] }), _jsxs("div", { className: css.pactions, children: [button('不要这版', () => { setPreview(null); setError(''); }), button(busy === 'expand' ? '扩写中…' : '重新扩写', () => void askPreview()), button(busy === 'text' ? '保存中…' : '保存这一版', () => void run('text', { name: shownName, userName: userName.trim(), gender, brief: previewFor, expanded: preview.trim(), expand: false }, '已保存这一版人格，下一句回复起生效。'), { primary: true, disabled: preview.trim() === '' })] })] }), preview === null && p.expanded !== '' && _jsxs(_Fragment, { children: [_jsxs("label", { className: css.pfield, children: [_jsx("span", { children: "\u73B0\u5728\u7528\u7684\u5B8C\u6574\u4EBA\u683C" }), _jsx("textarea", { rows: 6, value: expanded, onChange: event => setExpanded(event.target.value) })] }), textDirty && _jsxs("div", { className: css.pactions, children: [button('撤销修改', () => setExpanded(p.expanded)), button(busy === 'text' ? '保存中…' : '保存修改', () => void run('text', { expanded: expanded.trim() }, '修改已保存，下一句回复起生效。'), { primary: true })] })] }), error && _jsx("p", { className: css.perror, role: "alert", children: error }), ok && _jsx("p", { className: css.pok, role: "status", children: ok })] });
}
/* ================= 消息（提醒列表） ================= */
function NoticesPage({ ctx }) {
    const { props, data } = ctx;
    const [readAllBusy, setReadAllBusy] = useState(false);
    const [readAllNote, setReadAllNote] = useState('');
    const log = useSyncExternalStore(noticeLog.subscribe, noticeLog.get);
    useEffect(() => { void props.loadDomain?.('postbox'); }, []);
    const autoRead = useRef(new Set());
    useEffect(() => {
        for (const id of handledAttentionIds(data.letters, ctx.items)) {
            if (autoRead.current.has(id))
                continue;
            autoRead.current.add(id);
            void props.command('postbox.read', { id }).catch(() => { autoRead.current.delete(id); });
        }
    }, [data.letters, ctx.items]);
    const loading = data.domainLoading?.postbox ?? data.loading;
    const unread = messageEntries(data.letters, log).filter(entry => !entry.read);
    const read = (entry) => {
        if (entry.letter) {
            void props.command('postbox.read', { id: entry.letter.id }).catch(() => { });
            for (const notice of log)
                if (notice.postboxId === entry.letter.id)
                    noticeLog.markRead(notice.key);
        }
        else if (entry.notice)
            noticeLog.markRead(entry.notice.key);
    };
    const readAll = async (entries) => {
        let failed = 0, todos = 0;
        for (const entry of entries) {
            if (entry.letter?.todo) {
                todos += 1;
                continue;
            }
            if (entry.letter) {
                try {
                    await props.command('postbox.read', { id: entry.letter.id });
                    for (const notice of log)
                        if (notice.postboxId === entry.letter.id)
                            noticeLog.markRead(notice.key);
                }
                catch {
                    failed += 1;
                }
            }
            else if (entry.notice)
                noticeLog.markRead(entry.notice.key);
        }
        return [failed ? `${failed} 条没有标上已读` : '', todos ? `${todos} 条待办可单独标为已读` : ''].filter(Boolean).join('；');
    };
    const open = (entry) => {
        if (entry.workId) {
            if (!ctx.items.some(item => item.id === entry.workId))
                void props.loadDomain?.('work');
            props.actions.openCard(entry.workId);
        }
        else if (entry.notice?.kind === 'input')
            openNoticeEntry(entry.notice.entryUrl);
    };
    return _jsxs("section", { className: css.page, "data-page": "notices", children: [_jsx(TopBar, { ctx: ctx, title: "\u6D88\u606F", sub: unread.length ? `${unread.length} 条未读` : loading ? '正在读取消息…' : '没有未读消息', hideBell: true, children: _jsx("button", { className: css.textButton, disabled: readAllBusy || unread.length === 0, onClick: () => { setReadAllBusy(true); setReadAllNote(''); void readAll(unread).then(setReadAllNote).catch(() => setReadAllNote('标记失败，请重试')).finally(() => setReadAllBusy(false)); }, children: "\u5168\u90E8\u5DF2\u8BFB" }) }), readAllNote && _jsx("p", { className: css.hint, role: "status", children: readAllNote }), _jsx(MessagesView, { hideReadAll: true, letters: data.letters, notices: log, loading: loading, selectedNoticeId: data.noticeId, onOpen: open, onRead: read, onReadAll: readAll, onArchive: letter => props.command('postbox.archive', { id: letter.id }), onRetry: letter => props.command('postbox.retry', { id: letter.id }) })] });
}
/* ================= 记忆 ================= */
function MemoryPage({ ctx }) {
    const { props, data } = ctx;
    const [query, setQuery] = useState('');
    const [editing, setEditing] = useState(null);
    const [draft, setDraft] = useState('');
    const [note, setNote] = useState('');
    const asked = useRef(false);
    useEffect(() => { if (!asked.current) {
        asked.current = true;
        void props.loadDomain?.('memory');
        if (!data.memoryStatus)
            void props.loadDomain?.('capabilities');
    } }, []);
    const loading = data.domainLoading?.memory ?? false;
    const run = async (action, value, done) => {
        setNote('');
        try {
            await props.command(action, { ...value, operationId: opId() });
            setNote(done);
            setEditing(null);
            void props.loadDomain?.('memory');
        }
        catch (cause) {
            setNote(cause instanceof Error ? cause.message : String(cause));
        }
    };
    const status = data.memoryStatus;
    return _jsxs("section", { className: css.page, "data-page": "memory", children: [_jsx(TopBar, { ctx: ctx, title: "\u8BB0\u5FC6", sub: status ? (status.available ? `XTMEM 可用${status.engineVersion ? ` · ${status.engineVersion}` : ''}` : 'XTMEM 不可用') : `${data.memories.length} 条` }), _jsxs("form", { className: css.search, onSubmit: event => { event.preventDefault(); void props.search(query.trim()); }, children: [_jsx(Glyph, { name: "search" }), _jsx("input", { value: query, onChange: event => setQuery(event.target.value), placeholder: "\u641C\u8BB0\u5FC6", "aria-label": "\u641C\u8BB0\u5FC6" }), query && _jsx("button", { type: "button", className: css.textButton, onClick: () => { setQuery(''); void props.search(''); }, children: "\u6E05\u9664" })] }), _jsxs("div", { className: css.scroll, children: [note && _jsx("p", { className: css.hint, role: "status", children: note }), !data.memories.length && _jsx("p", { className: css.empty, children: loading ? '正在读取…' : query ? '没搜到相关的记忆。' : `还没有记忆。要 ${LITE_NAME} 记住什么，直接在对话里说。` }), _jsx("div", { className: css.memories, children: data.memories.map((memory) => _jsx("article", { className: css.memory, children: editing === memory.id
                                ? _jsxs("form", { onSubmit: event => { event.preventDefault(); if (draft.trim())
                                        void run('memory.correct', { id: memory.id, text: draft.trim() }, '已改好'); }, children: [_jsx("textarea", { value: draft, onChange: event => setDraft(event.target.value), rows: 3, "aria-label": "\u6539\u8FD9\u6761\u8BB0\u5FC6" }), _jsxs("div", { className: css.buttons, children: [_jsx("button", { className: css.primary, disabled: !draft.trim(), children: "\u4FDD\u5B58" }), _jsx("button", { type: "button", className: css.secondary, onClick: () => setEditing(null), children: "\u53D6\u6D88" })] })] })
                                : _jsxs(_Fragment, { children: [_jsx("p", { children: memory.text }), _jsxs("footer", { children: [_jsx("span", { children: [memory.kind, memory.updatedAt ? ago(memory.updatedAt, Date.now()) : ''].filter(Boolean).join(' · ') }), _jsx("button", { className: css.textButton, onClick: () => { setEditing(memory.id); setDraft(memory.text); }, children: "\u7EA0\u6B63" }), _jsx("button", { className: css.textButton, onClick: () => { if (confirm('忘掉这条记忆？以后还能在历史里找回。'))
                                                        void run('memory.forget', { id: memory.id }, '已忘掉'); }, children: "\u5FD8\u6389" })] })] }) }, memory.id)) })] })] });
}
/* ================= 通用小部件 ================= */
function Group({ title, action, id, children }) {
    return _jsxs("section", { className: css.group, ...(id ? { 'data-work-group': id } : {}), children: [_jsxs("header", { className: css.groupHead, children: [_jsx("h2", { children: title }), action] }), children] });
}
function Row({ label, value, toggle, icon, onClick }) {
    const body = _jsxs(_Fragment, { children: [icon && _jsx(Glyph, { name: icon }), _jsx("span", { className: css.rowLabel, children: label }), value && _jsx("span", { className: css.rowValue, children: value }), typeof toggle === 'boolean' ? _jsx("span", { className: css.switch, "data-on": toggle, "aria-hidden": "true", children: _jsx("i", {}) }) : onClick ? _jsx("span", { className: css.rowChevron, children: _jsx(Glyph, { name: "chevron" }) }) : null] });
    if (!onClick)
        return _jsx("div", { className: css.row, "data-static": true, children: body });
    return _jsx("button", { className: css.row, onClick: onClick, ...(typeof toggle === 'boolean' ? { role: 'switch', 'aria-checked': toggle } : {}), children: body });
}
/** back：左侧 ‹ 返回（代替右侧 ×，09b 任务详情）；sub：标题下一行副标题；menu：右侧「…」菜单项。 */
function Sheet({ title, sub, back, menu, onClose, compact, children, footer }) {
    useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape')
            onClose(); };
        addEventListener('keydown', onKey);
        return () => removeEventListener('keydown', onKey);
    }, [onClose]);
    return _jsxs("div", { className: css.sheetLayer, "data-compact": Boolean(compact), children: [_jsx("button", { className: css.scrim, "aria-label": "\u5173\u95ED", onClick: onClose, tabIndex: -1 }), _jsxs("section", { className: css.sheet, role: "dialog", "aria-modal": "true", "aria-label": title, children: [back
                        ? _jsxs("header", { className: css.sheetHead, "data-back": "", children: [_jsx("button", { className: css.icon, "aria-label": "\u8FD4\u56DE", onClick: onClose, children: _jsx(Glyph, { name: "back" }) }), _jsxs("div", { className: css.sheetTitles, children: [_jsx("h2", { children: title }), sub && _jsx("span", { className: css.sheetSub, children: sub })] }), menu && menu.length > 0 ? _jsx(SheetMenu, { items: menu }) : _jsx("span", { className: css.iconSpacer })] })
                        : _jsxs("header", { className: css.sheetHead, children: [_jsx("h2", { children: title }), _jsx("button", { className: css.icon, "aria-label": "\u5173\u95ED", onClick: onClose, children: _jsx(Glyph, { name: "close" }) })] }), _jsx("div", { className: css.sheetBody, "data-sheet-body": "", children: children }), footer] })] });
}
/** 右上角「…」：点开一列操作，点外面或 Esc 收起（Esc 先收菜单，不关整页）。 */
function SheetMenu({ items }) {
    const [open, setOpen] = useState(false);
    const box = useRef(null);
    useEffect(() => {
        if (!open)
            return;
        const onDown = (event) => { if (!box.current?.contains(event.target))
            setOpen(false); };
        const onKey = (event) => { if (event.key === 'Escape') {
            event.stopImmediatePropagation();
            event.preventDefault();
            setOpen(false);
        } };
        addEventListener('pointerdown', onDown, true);
        addEventListener('keydown', onKey, true);
        return () => { removeEventListener('pointerdown', onDown, true); removeEventListener('keydown', onKey, true); };
    }, [open]);
    return _jsxs("div", { className: css.sheetMenu, ref: box, children: [_jsx("button", { className: css.icon, "aria-label": "\u66F4\u591A\u64CD\u4F5C", "aria-haspopup": "menu", "aria-expanded": open, onClick: () => setOpen(!open), children: _jsx(Glyph, { name: "more" }) }), open && _jsx("div", { className: css.sheetMenuPop, role: "menu", children: items.map(item => _jsx("button", { role: "menuitem", disabled: item.disabled, onClick: () => { setOpen(false); item.onSelect(); }, children: item.label }, item.label)) })] });
}
