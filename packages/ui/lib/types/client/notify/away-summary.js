export const AWAY_SEEN_KEY = 'dot.away.lastSeen.v1';
export const localAwaySeen = {
    get() {
        try {
            const raw = globalThis.localStorage?.getItem(AWAY_SEEN_KEY);
            const value = raw == null ? NaN : Number(raw);
            return Number.isFinite(value) && value > 0 ? value : null;
        }
        catch {
            return null;
        }
    },
    set(at) {
        try {
            globalThis.localStorage?.setItem(AWAY_SEEN_KEY, String(Math.round(at)));
        }
        catch { /* 存不下就算了 */ }
    },
};
function timeOf(card) {
    const at = Date.parse(card.updatedAt || '');
    return Number.isFinite(at) ? at : 0;
}
/** 数「上次在之后」变成做完 / 没做成 / 等你处理 / 被打断的工作。 */
export function countAway(cards, since) {
    let done = 0, failed = 0, attention = 0, interrupted = 0;
    const picked = [];
    for (const card of cards) {
        if (card.partial || timeOf(card) <= since)
            continue;
        if (card.status === 'succeeded')
            done++;
        else if (card.status === 'failed')
            failed++;
        else if (card.status === 'waiting-input' || card.status === 'waiting-approval')
            attention++;
        else if (card.status === 'interrupted')
            interrupted++;
        else
            continue;
        picked.push(card);
    }
    picked.sort((a, b) => timeOf(b) - timeOf(a));
    return { done, failed, attention, interrupted, workIds: picked.map(card => card.id) };
}
/** 计数 → 一条气泡。什么都没有时返回 null。 */
export function awayNotice(counts, since, now) {
    if (counts.workIds.length === 0)
        return null;
    const parts = [];
    if (counts.done)
        parts.push(`完成了 ${counts.done} 件`);
    if (counts.failed)
        parts.push(`${counts.failed} 件没做成`);
    if (counts.attention)
        parts.push(`${counts.attention} 件等你处理`);
    if (counts.interrupted)
        parts.push(`${counts.interrupted} 件被打断了`);
    const needsYou = counts.attention + counts.interrupted + counts.failed > 0;
    const title = `你不在时${parts.join('，')}`;
    return {
        key: `away:${Math.round(since)}`,
        topic: `away:${Math.round(since)}`,
        kind: 'info',
        tone: needsYou ? 'attention' : 'done',
        source: 'work',
        eyebrow: '你不在时',
        title,
        text: counts.workIds.length === 1 ? '点这里去看那件工作。' : '点这里去工作空间看，最新的一件会先对准。',
        workId: counts.workIds[0],
        sticky: needsYou,
        at: now,
    };
}
/** 记「上次在 DOT 里」的时间，并在第一次全量时给出那条汇总。 */
export class AwayTracker {
    store;
    clock;
    visible;
    checked = false;
    timer = null;
    stopListeners;
    constructor(options = {}) {
        this.store = options.store ?? localAwaySeen;
        this.clock = options.clock ?? Date.now;
        this.visible = options.visible ?? (() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
        if (typeof document !== 'undefined' && typeof window !== 'undefined') {
            /* 切到后台或关页前记一笔；回到前台也记。只在已经对过一次之后记，免得把离线期间盖掉。 */
            const onVisibility = () => { if (this.checked)
                this.store.set(this.clock()); };
            document.addEventListener('visibilitychange', onVisibility);
            window.addEventListener('pagehide', onVisibility);
            this.stopListeners = () => { document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('pagehide', onVisibility); };
            this.timer = setInterval(() => this.touch(), options.intervalMs ?? 30_000);
        }
        else
            this.stopListeners = () => { };
    }
    /** 页面可见且已经对过一次时，把「上次在」推到现在。 */
    touch() { if (this.checked && this.visible())
        this.store.set(this.clock()); }
    /**
     * 第一次全量到了：返回那条汇总（可能为 null），之后再调一律返回 null。
     * @param cards - 第一次全量里的工作卡
     * @returns 汇总气泡或 null
     */
    hydrated(cards) {
        if (this.checked)
            return null;
        this.checked = true;
        const now = this.clock();
        const since = this.store.get();
        this.store.set(now);
        if (since === null)
            return null;
        return awayNotice(countAway(cards, since), since, now);
    }
    dispose() {
        if (this.timer !== null)
            clearInterval(this.timer);
        this.timer = null;
        this.stopListeners();
    }
}
