/* ================================================================
   闲置换新会话 · 网页跟随 · 总导游图（改代码前必读）
   ▍这是什么
   服务端（@xtcausal/dot-turn-context rollover）闲置满 15 分钟会建一个新会话「接着上次聊」。
   本模块让网页在“我正看着的那个会话被换走了”时自己切到新会话；旧会话不动，仍在历史里。
   ▍信号（不按标题猜）
   本实例 GET /dot-session/api/current → { current, rollovers: { 新会话: { from: 旧会话, createdAt } } }
   （服务端只给最近 20 条、作废的不给、不带对话内容）。什么时候去问：装好后一次、原生会话目录有变化、
   页面回到前台、点进输入框，外加页面在前台时每 60 秒一次（一个几十字节的 GET）。
   ⚠️ 实测（2026-10-27）：服务端自己建的会话**不会推进**已打开网页的原生目录（目录只在重连/刷新时重取），
   所以换会话那一刻网页没有任何推送可等；不加这个 60 秒检查，桌面上一直开着的页面要等用户自己动了才知道，
   而那时用户多半已经在旧会话里打字了。目标会话不在目录里时先 sessions.refresh() 再打开——
   原生 retain 只认目录里有的会话，直接 openSession 一个目录里没有的编号会静默失败（选中不变）。
   ▍规则
   1. 只跟“我正看着的会话”的换会话链；看着别的会话不动。
   2. 正在打字（输入框里有字）先不切，3 秒后再看；草稿留在原会话里不丢。只是点进输入框（还没字）照切。
      用户若直接在旧会话发出去了，服务端把这次换会话作废，这里再问就不会再切。
   3. 同一次换会话在这台设备只跟一次（localStorage 记）；用户从历史里点回旧会话就留在旧会话。
   4. 本页里从历史点开的会话，只跟点开之后才发生的换会话；页面刚打开时恢复的那个会话，
      离开期间发生的换会话也跟（第二天打开就落在新会话）。
   ▍修改铁律
   1. 【不】按会话标题判断；【不】在后台标签页里查（只在前台 60 秒一次）；【不】动旧会话或草稿内容。
   2. 跟随失败（接口不通、目录里没有目标会话）就什么都不做，不报错打扰用户。
   ▍更新记录
   *更新：2026-10-27 · 首版（Hark）：网页跟随闲置换出来的新会话；实测目录不推送服务端建的会话 → 加前台 60 秒检查与点输入框检查*
================================================================ */
const HANDLED_KEY = 'dot.sessionFollow.handled';
/** 沿换会话链从 viewed 走到底；只走 openedAt 之后发生的换会话；跟过的不再跟；走不动返回 undefined。
    （目标不要求已在原生目录里：服务端建的会话不推进已打开的网页目录。） */
export function followTarget(viewed, state, openedAt = 0, handled = new Set()) {
    if (!viewed || !state)
        return undefined;
    const next = new Map();
    for (const [to, row] of Object.entries(state.rollovers ?? {})) {
        if (!row || typeof row.from !== 'string')
            continue;
        const createdAt = row.createdAt ?? 0;
        const prev = next.get(row.from);
        if (!prev || createdAt > prev.createdAt)
            next.set(row.from, { to, createdAt });
    }
    const first = next.get(viewed);
    if (!first || first.createdAt < openedAt)
        return undefined;
    const key = `${viewed}>${first.to}`;
    if (handled.has(key))
        return undefined;
    let sid = viewed;
    const seen = new Set([sid]);
    for (let hop = next.get(sid); hop && !seen.has(hop.to); hop = next.get(sid)) {
        seen.add(hop.to);
        sid = hop.to;
    }
    return sid === viewed ? undefined : { from: viewed, to: sid, key };
}
function readHandled(storage) {
    try {
        const v = JSON.parse(storage?.getItem(HANDLED_KEY) ?? '[]');
        return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
    }
    catch {
        return [];
    }
}
export function installSessionFollow(deps) {
    const now = deps.now ?? (() => Date.now());
    const retryMs = deps.retryMs ?? 3000;
    const debounceMs = deps.debounceMs ?? 400;
    const installedAt = now();
    const restoreWindow = deps.restoreWindowMs ?? 8000;
    let stopped = false;
    let busy = false;
    let again = false;
    let debounce;
    let retry;
    let lastViewed;
    let openedAt = 0;
    const handled = new Set(readHandled(deps.storage));
    const markHandled = (key) => {
        handled.add(key);
        try {
            deps.storage?.setItem(HANDLED_KEY, JSON.stringify([...handled].slice(-50)));
        }
        catch { /* 存不了就只记在内存里 */ }
    };
    const trackViewed = () => {
        const v = deps.viewed();
        if (v !== lastViewed) {
            /* 页面刚打开时恢复的会话：离开期间的换会话也跟；之后从历史点开的：只跟点开之后的。 */
            openedAt = lastViewed === undefined && now() - installedAt <= restoreWindow ? 0 : now();
            lastViewed = v;
        }
        return v;
    };
    const check = async () => {
        if (stopped)
            return;
        if (busy) {
            again = true;
            return;
        }
        busy = true;
        try {
            const viewed = trackViewed();
            const known = deps.ids();
            const note = (reason, target) => deps.trace?.({ at: now(), ...(viewed ? { viewed } : {}), ...(target ? { target } : {}), reason, known: known.length });
            if (!viewed)
                return note('no-viewed');
            const state = await deps.load().catch(() => null);
            if (stopped)
                return;
            if (!state)
                return note('no-state');
            const target = followTarget(viewed, state, openedAt, handled);
            if (!target)
                return note('no-target');
            if (deps.draftBusy()) {
                note('typing', target.to);
                clearTimeout(retry);
                retry = setTimeout(() => { void check(); }, retryMs);
                return;
            }
            if (deps.viewed() !== viewed)
                return note('moved', target.to);
            note('follow', target.to);
            markHandled(target.key);
            try {
                await deps.open(target.to);
            }
            catch {
                return note('open-failed', target.to);
            }
            lastViewed = target.to;
            openedAt = now();
            deps.onFollow?.(target.from, target.to);
        }
        finally {
            busy = false;
            if (again && !stopped) {
                again = false;
                void check();
            }
        }
    };
    const schedule = () => { clearTimeout(debounce); debounce = setTimeout(() => { void check(); }, debounceMs); };
    const offList = deps.subscribe(() => { trackViewed(); schedule(); });
    const offVisible = deps.onVisible?.(schedule);
    const offFocus = deps.onComposerFocus?.(() => { void check(); });
    const pollMs = deps.pollMs ?? 60_000;
    const poll = pollMs > 0 ? setInterval(() => { if (deps.visible?.() !== false)
        void check(); }, pollMs) : undefined;
    trackViewed();
    schedule();
    return () => { stopped = true; clearTimeout(debounce); clearTimeout(retry); clearInterval(poll); offList(); offVisible?.(); offFocus?.(); };
}
/** 浏览器里的默认接线：本实例跟随接口 + 原生输入框是否在打字。 */
export async function loadFollowState(fetchImpl = fetch) {
    try {
        const res = await fetchImpl('/dot-session/api/current', { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } });
        if (!res.ok)
            return null;
        const body = await res.json();
        return body && typeof body === 'object' && body.rollovers && typeof body.rollovers === 'object' ? { current: typeof body.current === 'string' ? body.current : null, rollovers: body.rollovers } : null;
    }
    catch {
        return null;
    }
}
export function composerBusy(doc = document) {
    const cards = doc.querySelectorAll('[data-composer-card]');
    for (const card of cards) {
        const input = card.querySelector('[data-composer-input]');
        const text = input ? (input.value ?? input.textContent ?? '') : '';
        if (text.trim())
            return true;
    }
    return false;
}
