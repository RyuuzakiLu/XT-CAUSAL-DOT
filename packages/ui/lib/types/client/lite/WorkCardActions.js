import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
/* ================================================================
   简洁版 · 对话里工作小卡的「就地处理」按钮（2026-10-31）
   ◍ 为什么：经典版里确认 / 拒绝只长在精灵气泡上；简洁版没有精灵，按钮必须直接长在对话流里的工作卡上，
     否则后台工作会一直卡在等批准。
   ◍ 只在简洁版挂上（index.ts 按 readUiMode() 传进 WorkToolView），经典版的对话小卡一点不变。
   ◍ 答复走同一个审批桥（live.approvals）；填写 / 登录走服务端给的入口；要补充时可以直接回一句。
   ◍ 2026-11-01：按钮文案改「批准 / 拒绝」；原文预览由 LiteWorkCard 画在按钮上方。
   ================================================================ */
import { useState, useSyncExternalStore } from 'react';
import { openNoticeEntry } from "../notify/notices.js";
import { LITE_NAME } from "./lite-brand.js";
import css from './lite.module.css';
const noopSubscribe = () => () => { };
export function WorkCardActions({ card, approvals, command, onOpen }) {
    useSyncExternalStore(approvals?.subscribe ?? noopSubscribe, approvals?.getVersion ?? (() => 0));
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState('');
    const retryable = card.status === 'failed' || card.status === 'interrupted';
    if (card.status !== 'waiting-approval' && card.status !== 'waiting-input' && !retryable && !card.attention?.action)
        return null;
    const attention = card.attention;
    const action = attention?.action;
    const decidable = card.status === 'waiting-approval' && Boolean(approvals?.canDecide(card.sessionId));
    const decide = (decision) => {
        if (approvals?.decide(card.sessionId, decision))
            setNote(decision === 'allow' ? '已确认，它会接着做' : '已拒绝');
        else
            setNote('这条确认已经不在了，刷新看看最新状态');
    };
    const supplement = async () => {
        setBusy(true);
        setNote('');
        try {
            await command('work.supplement', { workId: card.id, text });
            setText('');
            setNote('已发给它');
        }
        catch (cause) {
            setNote(cause instanceof Error ? cause.message : String(cause));
        }
        finally {
            setBusy(false);
        }
    };
    const retry = async () => {
        setBusy(true);
        setNote('');
        try {
            const operationId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
            await command('work.retry', { workId: card.id, operationId });
            setNote('已请求重新做一次');
        }
        catch (cause) {
            setNote(cause instanceof Error ? cause.message : String(cause));
        }
        finally {
            setBusy(false);
        }
    };
    return _jsxs("div", { className: css.cardActions, "data-dot-lite-card-actions": "", onClick: event => event.stopPropagation(), children: [attention?.risk && _jsxs("p", { className: css.risk, children: ["\u98CE\u9669\uFF1A", attention.risk] }), _jsxs("div", { className: css.buttons, children: [retryable && _jsx("button", { type: "button", className: css.secondary, disabled: busy, onClick: () => void retry(), children: "\u91CD\u8BD5" }), retryable && onOpen && _jsx("button", { type: "button", className: css.textButton, onClick: () => onOpen(card.id), children: "\u770B\u8BE6\u60C5" }), decidable && _jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: css.primary, onClick: () => decide('allow'), children: "\u6279\u51C6" }), _jsx("button", { type: "button", className: css.secondary, "data-narrow": "", onClick: () => decide('reject'), children: "\u62D2\u7EDD" })] }), action?.kind === 'open-url' && _jsx("button", { type: "button", className: css.primary, onClick: () => { if (!openNoticeEntry(action.url, true))
                            window.open(action.url, '_blank', 'noopener'); }, children: action.label || '去填写' })] }), card.status === 'waiting-approval' && !decidable && !note && _jsxs("p", { className: css.hint, children: ["\u786E\u8BA4\u6309\u94AE\u8FD8\u5728\u8FDE\u63A5\uFF0C\u7A0D\u7B49\u51E0\u79D2\uFF1B\u4E5F\u53EF\u4EE5\u5728\u5BF9\u8BDD\u91CC\u8DDF ", LITE_NAME, " \u8BF4\u300C\u7EE7\u7EED\u300D\u3002"] }), card.status === 'waiting-input' && !action && _jsxs("form", { className: css.inline, onSubmit: event => { event.preventDefault(); if (text.trim())
                    void supplement(); }, children: [_jsx("input", { value: text, onChange: event => setText(event.target.value), placeholder: "\u8865\u5145\u4E00\u53E5\u7ED9\u5B83", "aria-label": "\u8865\u5145\u8BF4\u660E" }), _jsx("button", { className: css.secondary, disabled: busy || !text.trim(), children: "\u53D1\u9001" })] }), note && _jsx("p", { className: css.hint, role: "status", children: note })] });
}
