/* ================================================================
   简洁版对话 · 打开即贴底（2026-11-01 Hark reloadfix，取代 e881b5b 里 ChatPage 的内联版本）
   ▍要解决什么
   App 被杀后重开（或网页刷新），对话要停在最新消息。内容是分几拨到的：原生消息 → 拼接的前文（最多 300 条）
   → 前文里的工作卡/图集（React 异步挂）→ 图片解码、GenUI iframe、字体。每一拨都会把总高度往上推。
   ▍e881b5b 版本的问题
   1. 任何一次 pointerdown（手机上手指一碰屏幕，哪怕没滑）就永久停止贴底；冷启动时内容要涨好几秒，
      这期间一碰，后面再涨的几千像素就把视口顶到中间。
   2. 停止贴底后没有任何位置保持：前文区 overflow-anchor: none，浏览器不会替你锚定，上方一涨视口就往旧消息漂。
   3. 只盯滚动区的直接子节点尺寸，图片 load / iframe load 不算。
   ▍现在的规则
   1. 贴底（following）只有「用户真的往上滑离底部」才解除：触摸/滚轮/键盘期间发生的滚动、离底超过 THRESHOLD。
      单纯点一下（点输入框、点图片）不解除。用户滑回底部附近就重新贴底。
   2. 开场「装填期」（会话打开后到内容连续 SETTLE_MS 不再长高，最长 MAX_HYDRATE_MS）：
      若用户中途上滑了，按「离底距离」保持他的位置——装填期长高的几乎都在他上方（前文、工作卡）。
   3. 程序自己触发的滚动（原生恢复位置、前文拼接重设）不算用户意图：贴底中就再贴回去。
   4. 会话变了（data-conversation-session）重新从贴底开始；同一会话只是滚动区节点被重建，保留原状态。
================================================================ */
export const THRESHOLD = 80;
export const SETTLE_MS = 1500;
export const MAX_HYDRATE_MS = 20000;
const INTENT_MS = 700;
const gapOf = (el) => Math.max(0, el.scrollHeight - el.clientHeight - el.scrollTop);
export function installStickToBottom(root, options = {}) {
    const selector = options.selector ?? '[data-conversation-scroll]';
    const now = options.now ?? (() => Date.now());
    const win = root.ownerDocument.defaultView;
    const schedule = options.schedule ?? ((fn) => { if (win?.requestAnimationFrame)
        win.requestAnimationFrame(() => fn());
    else
        setTimeout(fn, 16); });
    const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = options.clearTimer ?? ((h) => clearTimeout(h));
    let scroller = null;
    let session = null;
    let following = true;
    let hydrating = true;
    let openedAt = now();
    let lastGrowth = now();
    let lastHeight = -1;
    let keptGap = 0;
    let intentUntil = 0;
    let touching = false;
    let queued = false;
    let stopped = false;
    let settleTimer;
    let expectTop = null;
    let lastTop = 0;
    const watched = new WeakSet();
    const sizes = typeof ResizeObserver === 'function' ? new ResizeObserver(() => request('resize')) : undefined;
    const trace = (reason) => options.trace?.({ following, hydrating, gap: scroller ? gapOf(scroller) : -1, session, reason });
    const userActive = () => touching || now() < intentUntil;
    const setTop = (el, top) => {
        const max = Math.max(0, el.scrollHeight - el.clientHeight);
        const next = Math.min(max, Math.max(0, top));
        if (Math.abs(el.scrollTop - next) < 1)
            return;
        expectTop = next;
        el.scrollTop = next;
        lastTop = el.scrollTop;
    };
    const armSettle = () => {
        if (settleTimer !== undefined)
            clearTimer(settleTimer);
        settleTimer = undefined;
        if (!hydrating || stopped)
            return;
        settleTimer = setTimer(() => { settleTimer = undefined; checkSettled(); }, SETTLE_MS);
    };
    const checkSettled = () => {
        if (!hydrating || stopped)
            return;
        const t = now();
        if (t - openedAt >= MAX_HYDRATE_MS || (t - lastGrowth >= SETTLE_MS && t - openedAt >= SETTLE_MS)) {
            hydrating = false;
            trace('settled');
            return;
        }
        armSettle();
    };
    const apply = (reason) => {
        queued = false;
        if (stopped)
            return;
        bind();
        const el = scroller;
        if (!el)
            return;
        const h = el.scrollHeight;
        if (h !== lastHeight) {
            if (lastHeight >= 0 && h > lastHeight)
                lastGrowth = now();
            lastHeight = h;
            if (hydrating)
                armSettle();
        }
        if (following)
            setTop(el, el.scrollHeight);
        else if (hydrating && !userActive())
            setTop(el, el.scrollHeight - el.clientHeight - keptGap);
        trace(reason);
    };
    const request = (reason) => { if (queued || stopped)
        return; queued = true; schedule(() => apply(reason)); };
    /* 只给新出现的节点挂尺寸观察（observe 本身会回调一次，反复重挂会变成每帧循环）。 */
    /* border-box：输入栏 seat 只改 padding（底部安全区，安卓壳晚到的 --dot-inset-bottom）时内容框不变，
       默认 content-box 观察不到，会停在离底 12–24px 的位置（2026-11-01 实测）。 */
    const watch = (node) => { if (sizes && !watched.has(node)) {
        watched.add(node);
        sizes.observe(node, { box: 'border-box' });
    } };
    const observeTree = (el) => {
        if (!sizes)
            return;
        watch(el);
        for (const child of Array.from(el.children)) {
            watch(child);
            /* 前文块、原生消息列：再往下一层，工作卡/图集各自长高也能看见。 */
            for (const grand of Array.from(child.children))
                watch(grand);
        }
    };
    const bind = () => {
        const next = root.querySelector(selector);
        const id = next?.closest('[data-conversation-session]')?.getAttribute('data-conversation-session') ?? null;
        if (next === scroller && id === session) {
            if (next)
                observeTree(next);
            return;
        }
        if (scroller)
            scroller.removeEventListener('scroll', onScroll);
        const sessionChanged = id !== session;
        scroller = next;
        session = id;
        if (sessionChanged) {
            following = true;
            hydrating = true;
            openedAt = now();
            lastGrowth = now();
            lastHeight = -1;
            keptGap = 0;
            armSettle();
            trace('session');
        }
        if (next) {
            next.addEventListener('scroll', onScroll, { passive: true });
            observeTree(next);
        }
    };
    function onScroll() {
        const el = scroller;
        if (!el)
            return;
        const top = el.scrollTop;
        const movedUp = top < lastTop - 2;
        lastTop = top;
        if (expectTop !== null && Math.abs(top - expectTop) < 2) {
            expectTop = null;
            return;
        }
        expectTop = null;
        const gap = gapOf(el);
        if (userActive()) {
            if (gap <= THRESHOLD) {
                if (!following) {
                    following = true;
                    trace('user-back-to-bottom');
                }
            }
            /* 只有真的往上滚了才解除；键盘弹起/视口变矮造成的离底不算（scrollTop 没变小）。 */
            else if (movedUp || !following) {
                following = false;
                keptGap = gap;
                trace('user-scrolled-up');
            }
            else
                request('viewport-shrink');
            return;
        }
        /* 不是用户：原生恢复位置/前文重设之类。贴底中就贴回去；没贴底时装填期按离底距离保持。 */
        if (following || hydrating)
            request('foreign-scroll');
    }
    const intent = () => { intentUntil = now() + INTENT_MS; };
    const onTouchStart = () => { touching = true; intent(); };
    const onTouchEnd = () => { touching = false; intent(); /* 惯性滚动还会再滚一会儿 */ };
    const onKey = (event) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key))
        intent(); };
    const onMouseDown = (event) => { if (event.target === scroller) {
        touching = true;
        intent();
    } /* 拖滚动条 */ };
    const onMouseUp = () => { if (touching) {
        touching = false;
        intent();
    } };
    const onLoad = (event) => { const t = event.target; if (t && scroller?.contains(t))
        request('load'); };
    const tree = new MutationObserver(() => request('mutation'));
    tree.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-conversation-session', 'src'] });
    const onWinResize = () => request('window-resize');
    root.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    root.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
    root.addEventListener('touchcancel', onTouchEnd, { capture: true, passive: true });
    root.addEventListener('wheel', intent, { capture: true, passive: true });
    root.addEventListener('keydown', onKey, true);
    root.addEventListener('mousedown', onMouseDown, true);
    win?.addEventListener('mouseup', onMouseUp, true);
    root.addEventListener('load', onLoad, true);
    win?.addEventListener('resize', onWinResize);
    bind();
    apply('install');
    return {
        jump(target) {
            bind();
            if (!scroller)
                return;
            following = !target;
            hydrating = false;
            if (target) {
                const offset = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
                setTop(scroller, scroller.scrollTop + offset - scroller.clientHeight / 4);
                keptGap = gapOf(scroller);
            }
            else
                setTop(scroller, scroller.scrollHeight);
            trace('jump');
        },
        stop() {
            stopped = true;
            tree.disconnect();
            sizes?.disconnect();
            if (settleTimer !== undefined)
                clearTimer(settleTimer);
            scroller?.removeEventListener('scroll', onScroll);
            root.removeEventListener('touchstart', onTouchStart, true);
            root.removeEventListener('touchend', onTouchEnd, true);
            root.removeEventListener('touchcancel', onTouchEnd, true);
            root.removeEventListener('wheel', intent, true);
            root.removeEventListener('keydown', onKey, true);
            root.removeEventListener('mousedown', onMouseDown, true);
            win?.removeEventListener('mouseup', onMouseUp, true);
            root.removeEventListener('load', onLoad, true);
            win?.removeEventListener('resize', onWinResize);
        },
        state: () => ({ following, hydrating, session }),
    };
}
