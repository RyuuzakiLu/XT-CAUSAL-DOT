import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/* ================================================================
   DOT 工作卡 · 对话消息流里的工具视图（work_query / work_create / work_cancel）
   ▍这是什么
   挂在原生工具插槽 tool.call.toolview 上：ASTRA 在对话里调用这几个工作工具时，原生聊天在
   工具调用那一格画我们的工作卡，代替通用的“工具已调用”块。于是：
   ① 用户问“那个进度怎么样了”→ ASTRA 调 work_query → 消息流里插进一张活的工作小卡；
   ② 对话里交代新工作 → ASTRA 调 work_create → 当场插一张小卡；
   ③ 有歧义 → work_query 返回候选 → 画候选条，ASTRA 同时反问。
   卡片内容按任务编号从全局状态读，所以老消息里的卡也会跟着工作进展更新。
   ▍修改铁律
   1. 【不】往会话日志写任何东西：卡片就画在已有的工具结果位置上，刷新重放一致。
   2. 工具报错或 meta 不认识时退回一行纯文字，【不】白屏。
   ▍更新记录
   *更新：2026-10-24 · 建立*
================================================================ */
import { useEffect, useMemo } from 'react';
import css from './work-cards.module.css';
import { readWorkToolMeta } from "./work-card.js";
import { useNow, useWorkCards } from "./use-work-cards.js";
import { WorkCandidates, WorkChatCard, WorkChatPending } from "./WorkChatCard.js";
export const WORK_TOOL_NAMES = ['work_query', 'work_create', 'work_cancel', 'work_route_adjustment', 'work_supplement'];
const PENDING_TEXT = {
    work_supplement: '正在提交补充…',
    work_query: '正在查这项工作的最新进度…',
    work_route_adjustment: '正在查这条调整属于哪项工作…',
    work_create: '正在交代这项工作…',
    work_cancel: '正在取消这项工作…',
};
/** 一次最多在对话里插几张卡；更多的去工作空间看。 */
export const MAX_CHAT_CARDS = 3;
function resultOf(block) {
    return block && block.kind === 'tool-result' ? block : null;
}
function resultText(result) {
    return result.content.flatMap(part => typeof part === 'object' && part !== null && part.type === 'text' ? [String(part.text ?? '')] : []).join('\n');
}
export function createWorkToolView(deps) {
    return function WorkToolView(props) {
        return 'history' in props ? _jsx(Cards, { meta: props.history }) : _jsx(ToolResult, { ...props });
    };
    function ToolResult(props) {
        const result = resultOf(props.block);
        const meta = useMemo(() => result ? readWorkToolMeta(result.meta) : null, [result]);
        if (!result)
            return _jsx(WorkChatPending, { label: PENDING_TEXT[props.toolName] ?? '正在处理工作…' });
        if (!meta || result.isError) {
            const text = resultText(result) || (result.isError ? '这次没查到工作状态。' : '工作工具已完成。');
            return _jsx("div", { className: css['plain'], "data-dot-work-plain": "", children: text });
        }
        return _jsx(Cards, { meta: meta });
    }
    function Cards({ meta }) {
        const snapshot = useWorkCards(deps.store);
        const now = useNow();
        // 精简行当种子：全量还没到（或这项工作已经不在最近列表里）时也能先画出来。
        useEffect(() => { if (meta?.works.length)
            deps.store.seed(meta.works); }, [meta]);
        if (meta.kind === 'work-candidates')
            return _jsx(WorkCandidates, { candidates: meta.candidates, onOpen: deps.open, onChoose: deps.choose });
        if (!meta.works.length)
            return _jsx("div", { className: css['plain'], "data-dot-work-plain": "", children: "\u76EE\u524D\u6CA1\u6709\u4EFB\u4F55\u5DE5\u4F5C\u8BB0\u5F55\u3002" });
        const origin = meta.kind === 'work-created' ? 'created' : meta.kind === 'work-cancelled' ? 'cancelled' : 'progress';
        return _jsxs("div", { className: css['cardStack'], children: [meta.works.slice(0, MAX_CHAT_CARDS).map(seed => {
                    const card = snapshot.cards[seed.id] ?? seed;
                    /* data-dot-work-chat-card 要留在外层：answer-only.ts 和简洁版的折叠放行都靠它认出「这里有工作卡」。 */
                    if (deps.renderCard)
                        return _jsx("div", { "data-dot-work-chat-card": "", "data-dot-lite-card": "", children: deps.renderCard(card, now) }, seed.id);
                    const chatCard = _jsx(WorkChatCard, { card: card, now: now, onOpen: deps.open, origin: origin }, seed.id);
                    return deps.renderActions ? _jsxs("div", { "data-dot-lite-card": "", children: [chatCard, deps.renderActions(card)] }, seed.id) : chatCard;
                }), meta.works.length > MAX_CHAT_CARDS && _jsxs("div", { className: css['plain'], "data-dot-work-more": "", children: ["\u8FD8\u6709 ", meta.works.length - MAX_CHAT_CARDS, " \u9879\u5DE5\u4F5C\uFF0C\u5728\u5DE5\u4F5C\u7A7A\u95F4\u91CC\u90FD\u80FD\u770B\u5230\u3002"] })] });
    }
}
