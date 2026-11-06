import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/* ================================================================
   DOT 精灵气泡 · 从精灵旁边弹出的通知
   ▍这是什么
   全局叠层（position: fixed），在任何空间都弹。每帧量精灵当前的位置，气泡跟着走：
   精灵被拖到哪就在哪旁边；靠屏幕边时换到不出界的一侧，不压住精灵。
   三种气泡：
   ① 要确认：一直留着，直到点「确认」或「拒绝」；有风险说明就显示。
      原生审批请求不在手边（例如刚刷新）时，改显示「去处理」，【不】假装确认成功。
   ② 要补充：「去填写」跳到工作空间对应的工作卡。
   ③ 只是告诉你：几秒后自动收起，点一下跳到对应工作卡（提醒则打开星邮匣）。
   ▍修改铁律
   1. 【不】碰精灵的拖动、停靠、位置保存；这里只读精灵的位置。
   2. 定位直接写 style，【不】每帧 setState。
   3. 按钮不小于 36px 高。
   *更新：2026-10-24 · 建立*
================================================================ */
import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import css from './notify.module.css';
import { placeBubbles } from "./bubble-placement.js";
import { openNoticeEntry } from "./notices.js";
const noop = () => () => { };
const zero = () => 0;
function fallbackSpriteRect(width, height) {
    // 精灵被隐藏时，假装它停在右下角外侧，气泡贴右下角出现。
    return { left: width, top: height - 220, width: 0, height: 120 };
}
export function SpriteBubbles({ queue, actions, findSprite, reducedMotion }) {
    const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
    useSyncExternalStore(actions.subscribeDecidable ?? noop, actions.decidableVersion ?? zero, actions.decidableVersion ?? zero);
    const stackRef = useRef(null);
    const visible = snapshot.visible;
    useLayoutEffect(() => {
        const stack = stackRef.current;
        if (!stack || !visible.length)
            return;
        let frame = 0;
        let last = '';
        let swept = 0;
        const place = () => {
            // 每 300ms 看一眼：同一件事的工作卡已经出现在屏幕上，就把重复的气泡收掉。
            const now = performance.now();
            if (now - swept > 300) {
                swept = now;
                queue.sweepCovered();
            }
            const viewport = { width: window.innerWidth, height: window.innerHeight };
            const element = findSprite();
            const box = element?.getBoundingClientRect();
            const sprite = box && box.width > 0 ? { left: box.left, top: box.top, width: box.width, height: box.height } : fallbackSpriteRect(viewport.width, viewport.height);
            const size = { width: stack.offsetWidth, height: stack.scrollHeight };
            const placement = placeBubbles(sprite, size, viewport);
            const signature = `${Math.round(placement.left)}|${Math.round(placement.top)}|${placement.side}|${Math.round(placement.maxHeight)}|${Math.round(placement.tail)}`;
            if (signature !== last) {
                last = signature;
                stack.style.left = `${placement.left}px`;
                stack.style.top = `${placement.top}px`;
                stack.style.maxHeight = `${placement.maxHeight}px`;
                stack.style.setProperty('--bubble-tail', `${placement.tail}px`);
                stack.dataset['side'] = placement.side;
            }
            frame = requestAnimationFrame(place);
        };
        place();
        return () => cancelAnimationFrame(frame);
    }, [visible, findSprite, queue]);
    const hold = useCallback((key, holding) => queue.hold(key, holding), [queue]);
    if (!visible.length)
        return null;
    return _jsxs("div", { ref: stackRef, className: css['bubbleStack'], "data-side": "left", "data-reduced-motion": reducedMotion ? 'true' : undefined, role: "region", "aria-label": "\u7CBE\u7075\u901A\u77E5", "data-dot-sprite-bubbles": "", children: [visible.map(notice => _jsx(Bubble, { notice: notice, actions: actions, queue: queue, hold: hold }, notice.key)), snapshot.queued > 0 && _jsxs("div", { className: css['bubbleQueued'], "data-dot-bubble-queued": "", children: ["\u8FD8\u6709 ", snapshot.queued, " \u6761\u901A\u77E5\u6392\u7740\u961F"] })] });
}
function Bubble({ notice, actions, queue, hold }) {
    const dismiss = () => queue.dismiss(notice.key);
    const acknowledge = () => actions.acknowledge?.(notice);
    const open = () => {
        acknowledge();
        if (notice.kind === 'input' && openNoticeEntry(notice.entryUrl))
            return;
        if (notice.workId && notice.tone !== 'reminder')
            actions.openWork(notice.workId);
        else
            actions.openPostbox(notice.postboxId);
    };
    const holdProps = {
        onPointerEnter: () => hold(notice.key, true),
        onPointerLeave: () => hold(notice.key, false),
        onFocus: () => hold(notice.key, true),
        onBlur: () => hold(notice.key, false),
    };
    const head = _jsxs(_Fragment, { children: [_jsx("span", { className: css['bubbleEyebrow'], children: notice.eyebrow }), _jsx("strong", { className: css['bubbleTitle'], children: notice.title }), notice.text && _jsx("span", { className: css['bubbleText'], children: notice.text })] });
    if (notice.kind === 'confirm') {
        const decidable = actions.canDecide(notice);
        const decide = (decision) => { if (actions.decide(notice, decision)) {
            acknowledge();
            dismiss();
        } };
        return _jsxs("section", { className: css['bubble'], "data-kind": "confirm", "data-tone": notice.tone, role: "alertdialog", "aria-label": `${notice.eyebrow}：${notice.title}`, "data-dot-bubble": "confirm", ...holdProps, children: [head, notice.risk && _jsxs("span", { className: css['bubbleRisk'], "data-dot-bubble-risk": "", children: [_jsx("b", { children: "\u98CE\u9669" }), notice.risk] }), _jsx("span", { className: css['bubbleActions'], children: decidable
                        ? _jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: css['bubbleButton'], "data-variant": "ghost", onClick: () => decide('reject'), children: "\u62D2\u7EDD" }), _jsx("button", { type: "button", className: css['bubbleButton'], "data-variant": "primary", onClick: () => decide('allow'), children: "\u786E\u8BA4" })] })
                        : _jsx("button", { type: "button", className: css['bubbleButton'], "data-variant": "primary", onClick: open, "data-dot-bubble-handle": "", children: "\u53BB\u5904\u7406" }) })] });
    }
    if (notice.kind === 'input') {
        return _jsxs("section", { className: css['bubble'], "data-kind": "input", "data-tone": notice.tone, role: "alertdialog", "aria-label": `${notice.eyebrow}：${notice.title}`, "data-dot-bubble": "input", ...holdProps, children: [_jsx("button", { type: "button", className: css['bubbleClose'], onClick: dismiss, "aria-label": "\u7A0D\u540E\u518D\u8BF4", children: "\u00D7" }), head, _jsx("span", { className: css['bubbleActions'], children: _jsx("button", { type: "button", className: css['bubbleButton'], "data-variant": "primary", onClick: () => { open(); dismiss(); }, children: notice.entryLabel ?? '去填写' }) })] });
    }
    return _jsxs("section", { className: css['bubble'], "data-kind": "info", "data-tone": notice.tone, "data-sticky": notice.sticky ? 'true' : undefined, role: "status", "data-dot-bubble": "info", ...holdProps, children: [_jsx("button", { type: "button", className: css['bubbleBody'], onClick: () => { open(); dismiss(); }, "aria-label": `${notice.eyebrow}：${notice.title}。${notice.tone === 'reminder' ? '打开星邮匣' : '打开对应工作卡'}`, children: head }), notice.sticky
                ? _jsx("span", { className: css['bubbleActions'], children: _jsx("button", { type: "button", className: css['bubbleButton'], "data-variant": "primary", onClick: () => { acknowledge(); dismiss(); }, children: "\u77E5\u9053\u4E86" }) })
                : _jsx("button", { type: "button", className: css['bubbleClose'], onClick: dismiss, "aria-label": "\u6536\u8D77", children: "\u00D7" })] });
}
