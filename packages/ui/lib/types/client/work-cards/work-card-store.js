import { describeWorkCard, isTerminal, preferCard, workCardFromSnapshot } from "./work-card.js";
const MAX_NOTICES = 4;
function noticeFor(previous, next, now) {
    if (!previous || previous.status === next.status || previous.partial)
        return null;
    const kind = next.status === 'succeeded' ? 'done'
        : next.status === 'waiting-input' || next.status === 'waiting-approval' ? 'attention'
            : next.status === 'failed' ? 'failed' : null;
    if (!kind)
        return null;
    return { key: `${next.id}:${next.status}:${next.revision}`, workId: next.id, kind, status: next.status, title: next.title, text: describeWorkCard(next, now), at: now };
}
export class WorkCardStore {
    clock;
    snapshot = { cards: {}, order: [], source: 'idle', notices: [], syncedAt: null, error: null };
    listeners = new Set();
    dismissed = new Set();
    filled = false;
    constructor(clock = Date.now) {
        this.clock = clock;
    }
    getSnapshot = () => this.snapshot;
    subscribe = (listener) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
    get(id) { return this.snapshot.cards[id]; }
    /** 是否已经拿到过一次全量。 */
    get hydrated() { return this.filled; }
    publish(patch) {
        this.snapshot = { ...this.snapshot, ...patch };
        for (const listener of [...this.listeners])
            listener();
    }
    orderOf(cards) {
        return Object.values(cards).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '') || a.id.localeCompare(b.id)).map(card => card.id);
    }
    merge(incoming, replace) {
        const now = this.clock();
        const before = this.snapshot.cards;
        const cards = replace ? {} : { ...before };
        if (replace)
            for (const [id, card] of Object.entries(before))
                if (card.partial)
                    cards[id] = card;
        const notices = [...this.snapshot.notices];
        let changed = replace;
        for (const card of incoming) {
            const previous = before[card.id];
            const chosen = preferCard(replace ? (previous?.partial ? previous : undefined) : previous, card);
            // 全量替换时，老全量的修订号也要参与比较，防止慢一拍的轮询把推送带来的新状态打回去。
            const kept = replace && previous && !previous.partial ? preferCard(previous, chosen) : chosen;
            if (kept !== previous)
                changed = true;
            cards[card.id] = kept;
            if (this.filled) {
                const notice = noticeFor(previous, kept, now);
                if (notice && !this.dismissed.has(notice.key) && !notices.some(item => item.key === notice.key))
                    notices.unshift(notice);
            }
        }
        if (!changed && notices.length === this.snapshot.notices.length)
            return;
        this.publish({ cards, order: this.orderOf(cards), notices: notices.slice(0, MAX_NOTICES), syncedAt: now });
    }
    /** 全量（推送 snapshot 帧或轮询结果）。 */
    replaceAll(works) {
        this.merge(works.map(workCardFromSnapshot), true);
        this.filled = true;
        if (this.snapshot.syncedAt === null)
            this.publish({ syncedAt: this.clock() });
    }
    /** 增量（推送 changed 帧）。 */
    upsert(work) { this.merge([workCardFromSnapshot(work)], false); }
    /** 对话里工具结果带来的精简行：只在全量还没有这项工作时当种子。 */
    seed(cards) {
        const missing = cards.filter(card => !this.snapshot.cards[card.id]);
        if (missing.length)
            this.merge(missing, false);
    }
    frame(frame) {
        if (frame.type === 'snapshot')
            this.replaceAll(frame.works);
        else
            this.upsert(frame.work);
    }
    setSource(source, error = null) {
        if (this.snapshot.source === source && this.snapshot.error === error)
            return;
        this.publish({ source, error });
    }
    dismissNotice(key) {
        this.dismissed.add(key);
        if (this.snapshot.notices.some(item => item.key === key))
            this.publish({ notices: this.snapshot.notices.filter(item => item.key !== key) });
    }
    /** 还在跑的工作（非终态）。 */
    active() { return this.snapshot.order.map(id => this.snapshot.cards[id]).filter(card => !isTerminal(card.status)); }
}
/** 推送优先、轮询兜底的馈送器。push() 由推送循环调，pushLost() 在推送断开时调。 */
export class WorkFeed {
    store;
    port;
    pollHandle = null;
    stopped = false;
    polling = false;
    pollMs;
    setTimer;
    clearTimer;
    constructor(store, port, options = {}) {
        this.store = store;
        this.port = port;
        this.pollMs = options.pollMs ?? 5000;
        this.setTimer = options.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms));
        this.clearTimer = options.clearInterval ?? (handle => globalThis.clearInterval(handle));
    }
    /** 收到一帧推送：写入全局状态，推送恢复就停轮询。 */
    push(frame) {
        if (this.stopped)
            return;
        this.stopPolling();
        this.store.frame(frame);
        this.store.setSource('push');
    }
    /** 推送断了或没开成：退回定时查询。 */
    pushLost(error) {
        if (this.stopped)
            return;
        this.store.setSource('poll', error === undefined ? null : String(error));
        if (this.pollHandle !== null)
            return;
        void this.pollOnce();
        this.pollHandle = this.setTimer(() => { void this.pollOnce(); }, this.pollMs);
    }
    async pollOnce() {
        if (this.stopped || this.polling)
            return;
        this.polling = true;
        try {
            const works = await this.port.list();
            if (!this.stopped && this.pollHandle !== null) {
                this.store.replaceAll(works);
                this.store.setSource('poll');
            }
            else if (!this.stopped)
                this.store.replaceAll(works);
        }
        catch (error) {
            if (!this.stopped)
                this.store.setSource('offline', String(error));
        }
        finally {
            this.polling = false;
        }
    }
    get isPolling() { return this.pollHandle !== null; }
    stopPolling() {
        if (this.pollHandle === null)
            return;
        this.clearTimer(this.pollHandle);
        this.pollHandle = null;
    }
    stop() { this.stopped = true; this.stopPolling(); }
}
