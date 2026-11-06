/* ================================================================
   键盘守卫：等比画布在键盘弹起时不整页缩小
   ▍这是什么
   工作空间、记忆空间都把整张原图画布按「宽、高取小」等比缩放。
   手机键盘弹起时可见高度变矮、宽度不变，比例就跟着掉，整页缩小。
   这里给一套公用的判断和一个 React 钩子：
   - 正在本画布里打字、宽度没变、只是高度变矮 → 沿用键盘弹起前的尺寸（比例不变）；
   - 焦点所在的输入框如果落在可见区底边以下，给出上移量 lift，让它露在键盘上方；
   - 焦点离开输入框（或宽度变化、高度恢复）→ 照常重算。
   ▍约定
   1. 只在「打字 + 宽不变 + 高变矮」时保持；旋转、分屏改宽度等一律照常重算。
   2. 纯函数不碰 DOM，便于测试；钩子只负责采样和事件。
   3. 能力空间（原先自带 capabilityCanvasScale）已于 2026-10-27 整页删除。
   *新建：2026-10-24 · 工作空间、记忆空间键盘弹起不整页缩小*
================================================================ */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
/* 键盘只会为这些控件弹起：文本类 input、textarea、可编辑区。 */
export function isTypingTarget(active) {
    if (!active)
        return false;
    if (active.tagName === 'TEXTAREA')
        return !active.readOnly;
    if (active.isContentEditable)
        return true;
    if (active.tagName !== 'INPUT')
        return false;
    const input = active;
    return !input.readOnly && !/^(button|checkbox|radio|range|color|file|submit|reset|image|hidden)$/i.test(input.type);
}
/* 焦点是否落在本画布里的可输入控件上。 */
export function isTypingWithin(node, active) {
    return Boolean(node && active && node.contains(active) && isTypingTarget(active));
}
/* 是否沿用上一次的尺寸：正在打字、宽度没变（差不到 1px）、高度变矮了。 */
export function keyboardHold(stable, next, typing) {
    if (!typing || !stable)
        return false;
    return Math.abs(stable.width - next.width) < 1 && next.height < stable.height - 0.5;
}
/* 同一套判断写成比例版，和原能力空间的 capabilityCanvasScale 入参、结果一致：
   fit 是本次按宽高取小算出的比例，held 是键盘弹起前的记录（不在打字时传 null）。 */
export function holdScale(fit, width, held) {
    if (held && Math.abs(held.width - width) < 1 && fit < held.scale)
        return { scale: held.scale, holding: true };
    return { scale: fit, holding: false };
}
/* 上移量：输入框在「未上移」时相对画布顶边的位置 target，可见高度 visible。
   输入框底边要留出 margin 露在可见区里；输入框比可见区还高时，优先保证顶边看得见。
   只往上移，不往下移；结果取整到 0.5px，避免来回抖动。 */
export function keyboardLift(target, visible, margin = 12) {
    if (!(visible > 0))
        return 0;
    let lift = target.bottom + margin - visible;
    if (target.top - lift < margin)
        lift = target.top - margin;
    return lift > 0 ? Math.round(lift * 2) / 2 : 0;
}
const same = (a, b) => a.holding === b.holding && a.lift === b.lift
    && a.size?.width === b.size?.width && a.size?.height === b.size?.height && a.box?.width === b.box?.width && a.box?.height === b.box?.height;
/* 采样：ResizeObserver、窗口/visualViewport 变化、焦点进出都重算一次。
   焦点离开后稍等（约 300ms）再重算，给键盘收起留时间，避免先缩一下再弹回。
   状态没变就不 setState，尽量不触发重渲染。 */
export function useKeyboardHold(ref, options = {}) {
    const [state, setState] = useState({ size: null, box: null, holding: false, lift: 0 });
    const opts = useRef(options);
    opts.current = options;
    /* 已经画到页面上的上移量。一次布局变化里 ResizeObserver 和 resize 事件会连着来，
       这时页面还没按新的 lift 重画，要用「已画上去的」那个值把位置换算回未上移的位置，不能用刚算出的。 */
    const applied = useRef(0);
    useLayoutEffect(() => { applied.current = state.lift; }, [state.lift]);
    useEffect(() => {
        const node = ref.current;
        if (!node)
            return;
        let stable = null;
        let box = null;
        let current = { size: null, box: null, holding: false, lift: 0 };
        let timer;
        const measure = () => opts.current.measure ? opts.current.measure(node) : { width: node.clientWidth, height: node.clientHeight };
        const update = () => {
            const next = measure();
            if (!next.width || !next.height)
                return;
            const active = document.activeElement;
            const typing = isTypingWithin(node, active);
            const holding = keyboardHold(stable, next, typing);
            if (!holding) {
                stable = next;
                box = { width: node.offsetWidth, height: node.offsetHeight };
            }
            let lift = 0;
            if (typing && active) {
                const frame = node.getBoundingClientRect(), target = active.getBoundingClientRect();
                const viewport = window.visualViewport;
                const visibleBottom = Math.min(frame.top + (opts.current.measure ? next.height : node.clientHeight), viewport ? viewport.offsetTop + viewport.height : window.innerHeight);
                /* 页面上的位置已带着上次画上去的上移，先加回去得到「未上移」的位置。 */
                lift = keyboardLift({ top: target.top - frame.top + applied.current, bottom: target.bottom - frame.top + applied.current }, visibleBottom - frame.top, opts.current.margin);
            }
            const result = { size: holding ? stable : next, box, holding, lift };
            if (same(result, current))
                return;
            current = result;
            setState(result);
        };
        const later = () => { clearTimeout(timer); timer = setTimeout(update, 300); };
        const soon = () => { clearTimeout(timer); timer = setTimeout(update, 0); };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(node);
        const viewport = window.visualViewport;
        window.addEventListener('resize', update);
        viewport?.addEventListener('resize', update);
        node.addEventListener('focusin', soon);
        node.addEventListener('focusout', later);
        return () => {
            clearTimeout(timer);
            observer.disconnect();
            window.removeEventListener('resize', update);
            viewport?.removeEventListener('resize', update);
            node.removeEventListener('focusin', soon);
            node.removeEventListener('focusout', later);
        };
    }, [ref]);
    return state;
}
