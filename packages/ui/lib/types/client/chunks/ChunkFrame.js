import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
/* ================================================================
   房间占位与失败重试 · 总导游图
   ▍这是什么
   分块还没到 / 取块失败时，房间位置显示的东西。它只负责"告诉你正在搬、搬失败可重来"，
   不冒充房间内容，也不挡导航与精灵。
   ▍为什么用行内样式
   这段占位要在任何房间 CSS 都还没到、甚至模块样式本身失败时也能看清，
   所以不引用任何 CSS Module 类名，避免"有类名没规则"时变成整块透明。
   ▍修改铁律
   1. 【不】无限转圈：超过等待阈值就显示"仍在加载 + 重试"，给用户出口。
   2. 失败必须同时给「重试」和「回书房」两个出口；回书房走既有 navigate，不新建路由。
   ▍更新记录
   2026-10-25 · 建立：按需块占位、慢网提示与两条回退出口。
   ================================================================ */
import { useEffect, useState } from 'react';
/** 转圈多久之后开始显示"仍在加载"，避免慢网看起来像卡死。 */
const SLOW_MS = 4000;
const box = (overlay) => ({
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minHeight: overlay ? undefined : 200,
    padding: overlay ? '18px 20px' : '48px 24px',
    color: '#f3e3c3',
    background: overlay ? 'rgba(8, 14, 26, .92)' : 'transparent',
    border: overlay ? '1px solid rgba(214, 178, 108, .45)' : 'none',
    borderRadius: overlay ? 14 : 0,
    position: overlay ? 'fixed' : undefined,
    left: overlay ? '50%' : undefined,
    bottom: overlay ? 24 : undefined,
    transform: overlay ? 'translateX(-50%)' : undefined,
    maxWidth: overlay ? 420 : undefined,
    zIndex: overlay ? 40 : undefined,
    textAlign: 'center',
    font: '14px/1.7 system-ui, sans-serif',
});
const button = {
    padding: '8px 16px',
    borderRadius: 999,
    border: '1px solid rgba(214, 178, 108, .7)',
    background: 'rgba(214, 178, 108, .12)',
    color: 'inherit',
    font: 'inherit',
    cursor: 'pointer',
};
export function ChunkFrame({ label, error, retry, fallback, overlay }) {
    const [slow, setSlow] = useState(false);
    useEffect(() => {
        if (error)
            return;
        const timer = setTimeout(() => setSlow(true), SLOW_MS);
        return () => clearTimeout(timer);
    }, [error]);
    if (error) {
        return _jsxs("section", { role: "alert", "data-chunk-error": "", style: box(overlay), children: [_jsxs("p", { style: { margin: 0 }, children: [label, "\u6CA1\u6709\u52A0\u8F7D\u6210\u529F\uFF1A", error.message] }), _jsx("p", { style: { margin: 0, opacity: .8 }, children: "\u5176\u4ED6\u623F\u95F4\u548C\u5DF2\u4FDD\u5B58\u7684\u8349\u7A3F\u90FD\u8FD8\u5728\uFF0C\u53EF\u4EE5\u91CD\u8BD5\uFF0C\u4E5F\u53EF\u4EE5\u5148\u56DE\u4E66\u623F\u3002" }), _jsxs("span", { style: { display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }, children: [_jsxs("button", { type: "button", style: button, onClick: retry, children: ["\u91CD\u65B0\u52A0\u8F7D", label] }), _jsx("button", { type: "button", style: button, onClick: fallback, children: overlay ? '先关掉' : '回书房' })] })] });
    }
    return _jsxs("section", { role: "status", "data-chunk-loading": "", "aria-busy": "true", style: box(overlay), children: [_jsxs("p", { style: { margin: 0 }, children: ["\u6B63\u5728\u51C6\u5907", label, "\u2026"] }), slow && _jsxs(_Fragment, { children: [_jsx("p", { style: { margin: 0, opacity: .8 }, children: "\u7F51\u7EDC\u6709\u70B9\u6162\uFF0C\u8FD8\u5728\u53D6\u8FD9\u4E00\u95F4\u7684\u7D20\u6750\u3002" }), _jsxs("span", { style: { display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }, children: [_jsxs("button", { type: "button", style: button, onClick: retry, children: ["\u91CD\u65B0\u52A0\u8F7D", label] }), _jsx("button", { type: "button", style: button, onClick: fallback, children: overlay ? '先关掉' : '先回书房' })] })] })] });
}
