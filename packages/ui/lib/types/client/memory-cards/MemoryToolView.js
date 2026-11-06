import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/* ================================================================
   DOT 记忆卡 · 对话消息流里的工具视图（dot_memory_search）
   ▍这是什么
   挂在原生工具插槽 tool.call.toolview 上：ASTRA 在对话里检索 XTMEM 时，工具那一格画成
   一张记忆卡：查了什么、命中几条、每条原文和更新时间。取代了独立的记忆空间——
   记忆在哪里被用到，就在哪里给人看。
   ▍数据从哪来
   只读工具结果的 meta（@xtcausal/dot-memory 的 presentationMeta：
   dot === 'memory' && kind === 'memory-search'）。不解析给模型看的中文。
   ▍修改铁律
   1. 【不】往会话日志写任何东西：卡片就画在已有的工具结果位置上，刷新重放一致。
   2. 工具报错或 meta 不认识（老版本结果没有 meta）时退回一行纯文字，【不】白屏。
   3. 只读：卡片里不放纠正/删除按钮，改记忆仍然走对话（写入有预检和确认）。
   ▍更新记录
   *更新：2026-10-27 · 建立*
================================================================ */
import { useState } from 'react';
import css from './memory-cards.module.css';
export const MEMORY_CARD_TOOL_NAMES = ['dot_memory_search'];
/** 卡片里默认展开几条；其余点「再看 N 条」。 */
const FOLDED_HITS = 3;
/** 认识就返回卡片数据，不认识返回 null（调用方退回纯文字）。 */
export function readMemoryToolMeta(meta) {
    if (meta === null || typeof meta !== 'object')
        return null;
    const record = meta;
    if (record['dot'] !== 'memory' || record['kind'] !== 'memory-search' || !Array.isArray(record['hits']))
        return null;
    const hits = [];
    for (const raw of record['hits']) {
        if (raw === null || typeof raw !== 'object')
            continue;
        const hit = raw;
        if (typeof hit['id'] !== 'string' || typeof hit['text'] !== 'string')
            continue;
        hits.push({
            id: hit['id'], text: hit['text'],
            ...(typeof hit['updatedAt'] === 'number' ? { updatedAt: hit['updatedAt'] } : {}),
            ...(typeof hit['tier'] === 'string' ? { tier: hit['tier'] } : {}),
        });
    }
    return {
        query: typeof record['query'] === 'string' ? record['query'] : '',
        mode: typeof record['mode'] === 'string' ? record['mode'] : null,
        count: typeof record['count'] === 'number' ? record['count'] : hits.length,
        hits,
    };
}
function resultOf(block) {
    return block && block.kind === 'tool-result' ? block : null;
}
function resultText(result) {
    return result.content.flatMap(part => typeof part === 'object' && part !== null && part.type === 'text' ? [String(part.text ?? '')] : []).join('\n');
}
function when(ms) {
    if (ms === undefined || !Number.isFinite(ms))
        return '';
    const date = new Date(ms);
    const now = new Date();
    const sameYear = date.getFullYear() === now.getFullYear();
    const pad = (n) => String(n).padStart(2, '0');
    return `${sameYear ? '' : `${date.getFullYear()}-`}${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
const TIER_LABEL = { refined: '精选', raw: '原料' };
export function MemoryToolView(props) {
    const [open, setOpen] = useState(false);
    const result = resultOf(props.block);
    if (!result)
        return _jsxs("div", { className: css['pending'], "data-memory-card": "pending", children: [_jsx("span", { className: css['dot'], "aria-hidden": "true" }), "\u6B63\u5728\u7FFB\u8BB0\u5FC6\u2026"] });
    const meta = result.isError ? null : readMemoryToolMeta(result.meta);
    if (!meta) {
        const text = resultText(result).trim();
        return _jsx("div", { className: css['plain'], "data-memory-card": "plain", children: result.isError ? `记忆检索没成功：${text || '未知原因'}` : (text || '记忆检索已完成。') });
    }
    const shown = open ? meta.hits : meta.hits.slice(0, FOLDED_HITS);
    const hidden = meta.hits.length - shown.length;
    return _jsxs("section", { className: css['card'], "data-memory-card": "", "data-memory-hits": meta.hits.length, "aria-label": "\u8BB0\u5FC6\u68C0\u7D22\u7ED3\u679C", children: [_jsxs("header", { className: css['head'], children: [_jsx("span", { className: css['mark'], "aria-hidden": "true", children: "\u2726" }), _jsx("strong", { children: "\u8BB0\u5FC6" }), _jsx("span", { className: css['count'], children: meta.hits.length === 0 ? '没有找到' : `找到 ${meta.count} 条` })] }), meta.query && _jsxs("p", { className: css['query'], children: ["\u67E5\u627E\uFF1A", meta.query] }), meta.hits.length === 0
                ? _jsx("p", { className: css['empty'], children: "XTMEM \u91CC\u6CA1\u6709\u548C\u8FD9\u4EF6\u4E8B\u76F8\u5173\u7684\u8BB0\u5FC6\u3002" })
                : _jsx("ol", { className: css['list'], children: shown.map(hit => _jsxs("li", { className: css['hit'], "data-memory-id": hit.id, children: [_jsx("p", { className: css['text'], children: hit.text }), _jsxs("p", { className: css['meta'], children: [_jsxs("code", { children: ["m:", hit.id.replace(/^mem-/, '').slice(0, 8)] }), hit.tier && _jsx("span", { children: TIER_LABEL[hit.tier] ?? hit.tier }), hit.updatedAt !== undefined && _jsx("time", { dateTime: new Date(hit.updatedAt).toISOString(), children: when(hit.updatedAt) })] })] }, hit.id)) }), (hidden > 0 || (open && meta.hits.length > FOLDED_HITS)) && _jsx("button", { type: "button", className: css['more'], onClick: () => setOpen(value => !value), children: open ? '收起' : `再看 ${hidden} 条` })] });
}
