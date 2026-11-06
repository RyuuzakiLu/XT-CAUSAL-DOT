import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/* ================================================================
   DOT 工作卡 · 对话里的小卡 / 候选条
   ▍这是什么
   ① WorkChatCard：插在对话消息流里的工作小卡，是工作空间主卡的缩小版：
      同一套深蓝玻璃底 + 玫瑰金边、宋体标题、状态标签、阶段线（绿 = 已完成，蓝 = 当前）。
      数据按任务编号从全局状态读，状态变了自己跟着变；点一下跳到工作空间对应的大卡。
   ② WorkCandidates：用户问得含糊、有好几项都像时，列出候选（ASTRA 同时会反问是哪一项）。
   通知不在这里：做完了 / 等你确认 / 没做成都从精灵弹气泡（notify/）。
   ▍修改铁律
   1. 【不】自己拉接口，只读全局状态；全量还没到时用工具 meta 的精简行先画。
   2. 【不】编百分比和步骤：后端没给就不画进度条、不画阶段线。
   3. 可点区域不小于 40px 高。
   ▍更新记录
   *更新：2026-10-24 · 改成工作空间主卡的缩小版；通知条移到精灵气泡*
================================================================ */
import { useEffect, useRef, useState } from 'react';
import css from './work-cards.module.css';
import { describeWorkCard, relativeTime, statusText } from "./work-card.js";
const ORIGIN_TEXT = { progress: '工作进度', created: '新交代的工作', cancelled: '已取消的工作' };
/** 阶段线最多画 5 个点：步骤更多时取当前步附近的一段，和工作空间主卡一致。 */
export function visibleSteps(steps, max = 5) {
    if (steps.length <= max)
        return steps;
    const current = Math.max(0, steps.findIndex(step => step.status === 'running' || step.status === 'failed' || step.status === 'pending'));
    const start = Math.min(Math.max(0, current - Math.floor(max / 2)), steps.length - max);
    return steps.slice(start, start + max);
}
const STEP_STATE = { done: 'done', running: 'current', failed: 'failed', pending: 'todo' };
function WorkGlyph() {
    return _jsx("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", children: _jsx("path", { d: "M12 2.8l2.1 6.1 6.1 2.1-6.1 2.1L12 19.2l-2.1-6.1L3.8 11l6.1-2.1z", fill: "currentColor" }) });
}
export function WorkChatCard({ card, now, onOpen, origin = 'progress' }) {
    const title = card.title || '这项工作';
    const summary = describeWorkCard(card, now);
    const steps = visibleSteps(card.steps);
    const current = card.steps.find(step => step.status === 'running' || step.status === 'failed');
    const position = card.position ? `第 ${card.position.current}/${card.position.total} 步` : '';
    return _jsxs("article", { className: css['chatCard'], "data-tone": card.tone, "data-status": card.status, "data-work-id": card.id, "data-dot-work-chat-card": "", children: [_jsxs("button", { type: "button", className: css['chatCardHit'], onClick: () => onOpen?.(card.id), "aria-label": `在工作空间打开：${title}，${summary}`, children: [_jsxs("span", { className: css['chatCardBar'], children: [_jsxs("span", { className: css['chatCardTag'], children: [_jsx(WorkGlyph, {}), ORIGIN_TEXT[origin]] }), _jsx("span", { className: css['chatCardTime'], children: card.updatedAt ? relativeTime(card.updatedAt, now) : '' })] }), _jsx("strong", { className: css['chatCardTitle'], children: title }), _jsxs("span", { className: css['chatCardChips'], children: [_jsx("em", { className: css['chatCardChip'], "data-status": card.status, children: statusText[card.status] }), position && _jsx("em", { className: css['chatCardChip'], "data-tone": "plain", children: position }), card.progress !== undefined && _jsxs("em", { className: css['chatCardChip'], "data-tone": "plain", children: [card.progress, "%"] })] }), steps.length > 0 && _jsx("span", { className: css['chatCardStages'], "aria-hidden": "true", children: steps.map(step => _jsx("i", { "data-state": STEP_STATE[step.status], title: step.label, children: _jsx("b", { children: step.status === 'done' ? '✓' : step.index + 1 }) }, step.index)) }), card.progress !== undefined && _jsx("span", { className: css['chatCardProgress'], "aria-hidden": "true", children: _jsx("i", { style: { transform: `scaleX(${card.progress / 100})` } }) }), _jsxs("span", { className: css['chatCardSummary'], children: [current ? _jsxs(_Fragment, { children: [_jsx("b", { children: current.label }), " \u00B7 "] }) : null, summary] }), _jsxs("span", { className: css['chatCardFoot'], children: [_jsx("span", { children: card.artifactCount ? `${card.artifactCount} 个产出` : (card.stage || '') }), _jsx("span", { className: css['chatCardOpen'], children: "\u5728\u5DE5\u4F5C\u7A7A\u95F4\u67E5\u770B \u203A" })] })] }), card.attention?.action !== undefined && _jsxs("a", { className: css['chatCardEntry'], href: card.attention.action.url, target: "_blank", rel: "noreferrer noopener", "data-dot-work-entry": card.attention.action.kind, children: [card.attention.action.label, " \u203A"] })] });
}
export function WorkCandidates({ candidates, onOpen, onChoose }) {
    const busy = useRef(false);
    const [sending, setSending] = useState(false);
    const [result, setResult] = useState();
    const [error, setError] = useState('');
    const firstTicket = candidates.find(item => item.ticket)?.ticket;
    useEffect(() => {
        let live = true;
        if (firstTicket && onChoose)
            void onChoose(firstTicket, true).then(value => {
                if (live && value.selectedId)
                    setResult({ selected: value.selectedId, target: value.targetId });
            }).catch(() => { });
        return () => { live = false; };
    }, [firstTicket, onChoose]);
    async function choose(ticket) {
        if (!onChoose || result || busy.current)
            return;
        busy.current = true;
        setSending(true);
        setError('');
        try {
            const value = await onChoose(ticket);
            setResult({ selected: value.selectedId, target: value.targetId });
        }
        catch (err) {
            const stale = /stale|conflict|clarification/.test(String(err));
            setError(stale ? '工单或对话已更新，请在对话里重新选择。' : '选择未确认，可以再点一次。');
        }
        finally {
            busy.current = false;
            setSending(false);
        }
    }
    return _jsxs("section", { className: css['candidates'], "aria-label": "\u53EF\u80FD\u662F\u8FD9\u51E0\u9879\u5DE5\u4F5C", "data-dot-work-candidates": "", children: [_jsxs("span", { className: css['chatCardTag'], children: [_jsx(WorkGlyph, {}), "\u4F60\u6307\u7684\u662F\u54EA\u4E00\u9879\uFF1F"] }), candidates.map(item => _jsxs("div", { className: css['candidateRow'], children: [_jsxs("button", { type: "button", className: css['candidate'], onClick: () => onOpen?.(item.id), "data-status": item.status, children: [_jsx("strong", { children: item.title || item.id }), _jsx("em", { "data-status": item.status, children: statusText[item.status] }), item.stage && item.stage !== statusText[item.status] && _jsx("span", { children: item.stage })] }), item.ticket && _jsx("button", { type: "button", role: "checkbox", "aria-label": '选择' + (item.title || item.id), "aria-checked": result?.selected === item.id, disabled: sending || !!result, className: css['choiceHit'], onClick: () => void choose(item.ticket), children: _jsx("i", { className: css['choiceBox'], "aria-hidden": "true", children: result?.selected === item.id &&
                                _jsx("svg", { viewBox: "0 0 16 16", fill: "none", children: _jsx("path", { d: "m3 8 3.2 3.2L13 4.8", pathLength: "1" }) }) }) })] }, item.id)), error && _jsx("span", { role: "status", children: error })] });
}
/** 工具还在跑时的占位行：按结果卡的高度预留一半，结果到了不会大跳。 */
export function WorkChatPending({ label }) {
    return _jsxs("div", { className: css['pending'], role: "status", "data-dot-work-pending": "", children: [_jsx("i", { "aria-hidden": "true" }), label] });
}
