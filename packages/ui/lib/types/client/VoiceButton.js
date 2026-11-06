import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/* ================================================================
   DOT 原生输入栏工具槽 · 总导游图
   ▍这是什么
   原生conversation输入槽（conversation.input.left）里的附件入口。
   ▍修改铁律
   1. 输入栏里不放语音按钮（2026-10-30 用户要求：点按转写和按住说话两个都去掉）；通话入口在右上角，不在这里。
   2. 附件按钮只复用原生文件选择器，上传和校验仍归原生输入栏。
   3. 图标用回形针（附件）：原生输入栏左边已经有“+”，再放一个加号会重复。
   ▍更新记录
   *更新：2026-10-23 · 对话语音插槽与错误反馈*
   *更新：2026-10-30 · 去掉两个语音按钮，图片按钮换成回形针*
   *更新：2026-11-01 · 简洁版：附件写盘的 EACCES 修好后放回，画成输入胶囊左边的「＋」，只收图片*
   *更新：2026-11-01 · 加号分为「插入图片 / 插入附件」，共用原生处理链路*
   *更新：2026-11-01 · 文件附件接通（按对话归属 + 50MB 放行、上传即转文字）：简洁版「＋」也收普通文件，不再限定图片*
================================================================ */
import { useEffect, useLayoutEffect, useId, useRef, useState } from 'react';
import { readUiMode } from "./lite/ui-mode.js";
import css, { cssText } from './attach-menu.module.css';
/* 槽位及注入保持不变。两个入口只控制原生选择器的过滤，不另建上传路径：
   原生 createDrafts 按 MIME 将图片内联提交、普通文件上传；归属和 50MB 校验仍归原生链路。 */
export const LITE_ATTACH_ACCEPT = '';
export const LITE_IMAGE_ACCEPT = 'image/*';
export function VoiceButton(_props) {
    const [error, setError] = useState('');
    const [open, setOpen] = useState(false);
    const root = useRef(null);
    const trigger = useRef(null);
    const menu = useRef(null);
    const menuId = useId();
    const lite = readUiMode() === 'lite';
    const label = '添加图片或文件';
    useEffect(() => {
        const composer = root.current?.closest('[data-composer-card]');
        if (!lite || !composer)
            return;
        const syncPreview = () => {
            const group = composer.querySelector('[data-slot="conversation.input.attachments"] [role="group"]');
            if (!group)
                return;
            group.dataset.attachmentCount = String(group.childElementCount);
            for (const card of group.querySelectorAll('[class*="_card"][title]')) {
                const ext = card.title.match(/\.([^.\s/]+)$/)?.[1];
                card.dataset.fileType = ext?.toUpperCase() || '文件';
            }
        };
        syncPreview();
        const observer = new MutationObserver(syncPreview);
        observer.observe(composer, { childList: true, subtree: true, attributes: true, attributeFilter: ['title'] });
        return () => observer.disconnect();
    }, [lite]);
    useLayoutEffect(() => {
        if (menu.current)
            menu.current.inert = !open;
    }, [lite, open]);
    useEffect(() => {
        if (!open)
            return;
        menu.current?.querySelector('button')?.focus({ preventScroll: true });
        const outside = (event) => {
            if (event.target instanceof Node && !root.current?.contains(event.target))
                setOpen(false);
        };
        const escape = (event) => {
            if (event.key !== 'Escape')
                return;
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            trigger.current?.focus({ preventScroll: true });
        };
        const navigate = () => setOpen(false);
        document.addEventListener('pointerdown', outside);
        window.addEventListener('keydown', escape, true);
        window.addEventListener('popstate', navigate);
        window.addEventListener('hashchange', navigate);
        return () => {
            document.removeEventListener('pointerdown', outside);
            window.removeEventListener('keydown', escape, true);
            window.removeEventListener('popstate', navigate);
            window.removeEventListener('hashchange', navigate);
        };
    }, [open]);
    const choose = (accept) => {
        setOpen(false);
        setError('');
        trigger.current?.focus({ preventScroll: true });
        const picker = root.current?.closest('[data-composer-card]')?.querySelector('input[type="file"]');
        if (!picker || picker.disabled) {
            setError('当前会话暂不能添加附件');
            return;
        }
        if (accept !== undefined)
            picker.accept = accept;
        // 取消后重选同一文件也能触发原生 change；不改已有草稿附件。
        picker.value = '';
        picker.click();
    };
    const moveFocus = (event) => {
        const items = Array.from(menu.current?.querySelectorAll('button') ?? []);
        const index = items.indexOf(document.activeElement);
        const next = event.key === 'ArrowDown' ? (index + 1) % items.length
            : event.key === 'ArrowUp' ? (index + items.length - 1) % items.length
                : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1;
        if (next >= 0) {
            event.preventDefault();
            items[next]?.focus();
        }
    };
    return _jsxs("div", { ref: root, "data-dot-input-tools": true, onBlur: event => {
            if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget))
                setOpen(false);
        }, children: [_jsx("button", { ref: trigger, type: "button", "aria-label": label, title: label, "data-dot-attach": true, "data-dot-attach-lite": lite ? '' : undefined, "aria-haspopup": lite ? 'menu' : undefined, "aria-expanded": lite ? open : undefined, "aria-controls": lite ? menuId : undefined, onClick: () => { if (lite) {
                    setError('');
                    setOpen(value => !value);
                }
                else
                    choose(); }, children: lite ? _jsx("svg", { className: css.plusIcon, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", "aria-hidden": "true", children: _jsx("path", { d: "M12 5v14M5 12h14" }) }) : _jsx("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: _jsx("path", { d: "m21 11.5-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9" }) }) }), lite && _jsxs(_Fragment, { children: [_jsx("style", { children: cssText }), _jsxs("div", { ref: menu, id: menuId, role: "menu", "aria-label": "\u63D2\u5165\u5185\u5BB9", "aria-hidden": !open, className: css.menu, onKeyDown: moveFocus, children: [_jsxs("button", { type: "button", role: "menuitem", onClick: () => choose(LITE_IMAGE_ACCEPT), children: [_jsxs("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.7", "aria-hidden": "true", children: [_jsx("rect", { x: "3", y: "3", width: "18", height: "18", rx: "3" }), _jsx("circle", { cx: "8", cy: "8", r: "1.5" }), _jsx("path", { d: "m3 17 5-5 4 4 4-6 5 7" })] }), "\u63D2\u5165\u56FE\u7247"] }), _jsxs("button", { type: "button", role: "menuitem", onClick: () => choose(LITE_ATTACH_ACCEPT), children: [_jsx("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.7", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: _jsx("path", { d: "m21 11.5-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9" }) }), "\u63D2\u5165\u9644\u4EF6"] })] })] }), error && _jsx("span", { role: "alert", children: error })] });
}
