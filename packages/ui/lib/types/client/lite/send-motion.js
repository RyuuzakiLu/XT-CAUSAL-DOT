/* DSH 先显示本机的发送回显，随后用正式消息替换它。两次渲染共用开始时间。 */
const echo = '[data-submission-echo]';
const action = '[data-clock="start"]';
const liveUser = '[data-chat-flow-kind="user"]:not([data-dot-chain-row]), [data-pending-steering]';
const arriveMs = 420;
// 入场之后保留原来的停顿、上移和操作栏淡入时间。
const duration = arriveMs + 392;
export function installSendMotion(root) {
    const pending = new Map();
    const observed = new WeakSet(root.querySelectorAll(echo));
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const active = new Set();
    const clear = () => {
        for (const animation of active)
            animation.cancel();
        active.clear();
        pending.clear();
    };
    function animate(node, frames, start, done) {
        const animation = node.animate(frames, { duration, fill: 'backwards' });
        animation.startTime = start;
        active.add(animation);
        animation.onfinish = animation.oncancel = () => { active.delete(animation); done?.(); };
    }
    function show(row) {
        if (observed.has(row) || !root.contains(row))
            return;
        const bar = row.querySelector(action);
        const bubble = bar?.previousElementSibling;
        if (!bar || !(bubble instanceof HTMLElement))
            return;
        observed.add(row);
        const now = Number(document.timeline.currentTime ?? performance.now());
        const session = row.closest('[data-conversation-session]');
        const text = bubble.textContent?.trim() ?? '';
        for (const [key, entry] of pending)
            if (now - entry.start >= duration)
                pending.delete(key);
        let entry;
        if (row.matches(echo)) {
            const gap = parseFloat(getComputedStyle(bar.parentElement).rowGap) || 0;
            entry = { start: now, session, text, lift: bar.offsetHeight + gap };
        }
        else {
            // 只有刚刚被移除的同一会话回显可以交给新节点。历史消息与普通重绘直接静态显示。
            const previous = Array.from(pending).find(([old, value]) => !old.isConnected && value.session === session && value.text === text);
            if (!previous)
                return;
            pending.delete(previous[0]);
            entry = previous[1];
        }
        pending.set(row, entry);
        const { start, lift } = entry;
        const ease = 'cubic-bezier(.22,.65,.25,1)';
        animate(bubble, [
            { offset: 0, opacity: 0, translate: '0 ' + (lift + 22) + 'px', easing: 'cubic-bezier(.25,.35,.25,1)' },
            { offset: arriveMs / duration, opacity: 1, translate: '0 ' + lift + 'px' },
            { offset: (arriveMs + 45) / duration, opacity: 1, translate: '0 ' + lift + 'px', easing: ease },
            { offset: 1, opacity: 1, translate: '0 0' },
        ], start);
        animate(bar, [
            { offset: 0, visibility: 'hidden', opacity: 0 },
            { offset: (arriveMs + 73) / duration, visibility: 'hidden', opacity: 0 },
            { offset: (arriveMs + 78) / duration, visibility: 'visible', opacity: 0, translate: '0 6px', easing: ease },
            { offset: 1, visibility: 'visible', opacity: 1, translate: '0 0' },
        ], start, () => pending.delete(row));
    }
    const observer = new MutationObserver(records => {
        if (media.matches)
            return;
        for (const record of records)
            for (const node of record.addedNodes) {
                if (!(node instanceof HTMLElement))
                    continue;
                const selector = pending.size ? echo + ', ' + liveUser : echo;
                if (node.matches(selector))
                    show(node);
                for (const row of node.querySelectorAll(selector))
                    show(row);
                // 正式消息的外层可能先到，正文和操作栏在下一次提交才挂上。
                if (pending.size) {
                    const owner = node.closest(liveUser);
                    if (owner)
                        show(owner);
                }
            }
    });
    observer.observe(root, { childList: true, subtree: true });
    const reduce = () => { if (media.matches)
        clear(); };
    media.addEventListener('change', reduce);
    return () => { observer.disconnect(); media.removeEventListener('change', reduce); clear(); };
}
