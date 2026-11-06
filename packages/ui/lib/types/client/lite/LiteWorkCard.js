import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/* ================================================================
   简洁版 · 工作卡（2026-11-01，照竞品报告第 5 条）
   ◍ 结构：状态行（等宽小字：状态 · 第几步 / 时间）→ 标题 → 一行「正在做什么」→ 3px 进度条；
     步骤日志默认收起，点开才看。
   ◍ 要你批准：状态变成强调色「要你批准」，下面把原文摆出来（预览块），按钮由调用方传进来（批准 / 拒绝）。
   ◍ 做完收成一行：「✓ 已完成 · 标题 · 查看结果」；没做成写一行红字原因；取消也收成一行。
   ◍ 同一张卡用在两处：对话流里（WorkToolView 的 renderCard，数据是 WorkCard）、后台工作页（数据是 WorkRow 合并后的行）。
   ◍ 硬规矩：不编百分比、不编步骤——后端没给就不画进度条、不画「第几步」。
   ================================================================ */
import { useId, useLayoutEffect, useRef, useState } from 'react';
import css from './lite.module.css';
const LABEL = {
    'waiting-approval': '要你批准',
    'waiting-input': '要你补充',
    queued: '排队中',
    running: '进行中',
    succeeded: '已完成',
    completed: '已完成',
    failed: '没做成',
    cancelled: '已取消',
    interrupted: '被打断',
};
export function liteCardKind(status) {
    if (status === 'waiting-approval' || status === 'waiting-input')
        return 'attention';
    if (status === 'queued' || status === 'running')
        return 'active';
    if (status === 'succeeded' || status === 'completed')
        return 'done';
    if (status === 'failed' || status === 'interrupted')
        return 'failed';
    return 'idle';
}
export const liteCardLabel = (status) => LABEL[status] ?? (status || '未知');
/** 进度统一成 0–100：后端行里是 0–1，工作卡里已经是 0–100。 */
export function percent(value) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return undefined;
    return Math.max(0, Math.min(100, Math.round(value <= 1 ? value * 100 : value)));
}
export function viewOfCard(card) {
    return {
        id: card.id, title: card.title || '这项工作', status: card.status,
        doing: card.doing || card.stage,
        updatedAt: card.updatedAt,
        ...(card.progress !== undefined ? { progress: card.progress } : {}),
        ...(card.position ? { position: card.position } : {}),
        steps: card.steps,
        ...(card.attention ? { attention: { kind: card.attention.kind, message: card.attention.message } } : {}),
        ...(card.error ? { error: card.error } : {}),
        artifactCount: card.artifactCount,
    };
}
export function viewOfRow(row) {
    const progress = percent(row.progress);
    return {
        id: row.id, title: row.goal || '这项工作', status: row.status, doing: row.stage, updatedAt: row.updatedAt,
        ...(progress !== undefined ? { progress } : {}),
        steps: [],
        ...(row.blocked ? { attention: { kind: row.blocked.kind, message: row.blocked.message } } : {}),
        ...(row.error ? { error: row.error } : {}),
        artifactCount: row.artifacts.length,
    };
}
/** 顶栏实时状态（竞品报告第 6 条）：「正在做 2 件 · 1 件等你」；没有工作时为空（顶栏只留名字）。 */
export function liveWorkLine(running, waiting) {
    return [running ? `正在做 ${running} 件` : '', waiting ? `${waiting} 件等你` : ''].filter(Boolean).join(' · ');
}
export function ago(value, now) {
    const at = value ? Date.parse(value) : NaN;
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
    const date = new Date(at);
    return `${date.getMonth() + 1}月${date.getDate()}日`;
}
export function LiteWorkCard({ view, now, onOpen, actions, inline = false, compact = false }) {
    const kind = liteCardKind(view.status);
    const label = liteCardLabel(view.status);
    const open = () => onOpen?.(view.id);
    const [expanded, setExpanded] = useState(false);
    const panel = useRef(null);
    const panelId = useId();
    useLayoutEffect(() => { if (panel.current)
        panel.current.inert = !expanded; }, [expanded]);
    /* 工作列表默认收成一行；对话卡保持原有交互。 */
    if (!inline && (compact || kind === 'done' || kind === 'idle')) {
        return _jsx("article", { className: css.work, "data-lite-work": "", "data-kind": kind, "data-collapsed": "", "data-work-id": view.id, children: _jsxs("button", { type: "button", className: css.workOneLine, onClick: open, children: [_jsx("span", { className: css.workCheck, "aria-hidden": "true", children: kind === 'done' ? '✓' : kind === 'failed' ? '×' : kind === 'attention' ? '!' : kind === 'active' ? '•' : '–' }), _jsxs("span", { className: css.workOneText, children: [_jsx("b", { children: label }), " \u00B7 ", view.title] }), (kind === 'done' || compact) && _jsx("span", { className: css.workLink, children: kind === 'done' ? '查看结果' : '查看详情' })] }) });
    }
    const time = ago(view.updatedAt, now);
    const step = view.position ? `第 ${view.position.current}/${view.position.total} 步` : '';
    const showPreview = kind === 'attention' && Boolean(view.attention?.message);
    const Head = inline ? 'div' : 'button';
    const body = _jsxs(_Fragment, { children: [_jsxs(Head, { className: css.workHit, ...(inline ? {} : { type: 'button', onClick: open, 'aria-label': `查看工作：${view.title}，${label}` }), children: [_jsxs("span", { className: css.workStatus, children: [_jsxs("span", { className: css.workStatusLeft, children: [_jsxs("b", { "data-kind": kind, children: [kind === 'active' ? _jsx("i", { className: css.breath, "aria-hidden": "true" }) : kind === 'attention' || kind === 'failed' ? _jsx("i", { className: css.workStateMark, "aria-hidden": "true" }) : null, label] }), step && _jsxs("span", { children: [" \u00B7 ", step] })] }), time && _jsx("time", { children: time })] }), _jsx("strong", { className: css.workTitle, children: view.title }), kind === 'failed'
                        ? _jsx("span", { className: css.workReason, children: view.error || view.doing || '没有留下原因' })
                        : view.doing && !showPreview && _jsx("span", { className: css.workNow, children: view.doing }), kind === 'active' && view.progress !== undefined && _jsx("span", { className: css.workBar, "aria-hidden": "true", children: _jsx("i", { style: { width: `${view.progress}%` } }) })] }), showPreview && _jsx("div", { className: css.workPreview, "data-lite-work-preview": "", children: view.attention.message }), actions, view.steps.length > 0 && _jsxs("details", { className: css.workSteps, children: [_jsxs("summary", { children: ["\u6B65\u9AA4 ", view.position ? `${view.position.current}/${view.position.total}` : view.steps.length] }), _jsx("ol", { children: view.steps.map(item => _jsxs("li", { "data-status": item.status, children: [_jsx("span", { className: css.stepMark }), item.label] }, item.index)) })] })] });
    return _jsx("article", { className: css.work, "data-lite-work": "", "data-kind": kind, "data-status": view.status, "data-work-id": view.id, "data-inline": inline || undefined, "data-collapsed": inline && !expanded ? '' : undefined, children: inline ? _jsxs(_Fragment, { children: [_jsxs("button", { type: "button", className: css.workOneLine, "aria-expanded": expanded, "aria-controls": panelId, onClick: () => setExpanded(!expanded), children: [_jsx("span", { className: css.workCheck, "aria-hidden": "true", children: kind === 'done' ? '✓' : kind === 'failed' ? '×' : kind === 'attention' ? '!' : kind === 'active' ? '•' : '–' }), _jsxs("span", { className: css.workOneText, children: [_jsx("b", { children: label }), " \u00B7 ", view.title] }), _jsx("span", { className: css.workLink, children: expanded ? '收起' : '展开' })] }), _jsx("div", { ref: panel, id: panelId, className: css.workCardFold, "aria-hidden": !expanded, children: _jsxs("div", { className: css.workCardClip, children: [_jsxs("div", { className: css.workCardBody, children: [body, view.artifactCount > 0 && _jsxs("span", { className: css.workNow, children: [view.artifactCount, " \u4E2A\u6210\u679C"] })] }), _jsxs("button", { className: css.workFullLink, type: "button", onClick: open, children: [kind === 'done' ? '查看结果' : '查看完整工单', " \u203A"] })] }) })] }) : body });
}
