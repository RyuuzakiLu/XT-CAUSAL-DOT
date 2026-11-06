export const MAX_VISIBLE = 2;
export const INFO_DISMISS_MS = 6000;
const defaultTimers = {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: handle => globalThis.clearTimeout(handle),
};
function rank(notice) { return notice.kind === 'confirm' ? 0 : notice.kind === 'input' ? 1 : notice.sticky ? 2 : 3; }
export class SpriteBubbleQueue {
    timer;
    dismissMs;
    covered;
    items = [];
    snapshot = { visible: [], queued: 0, confirmShown: false };
    listeners = new Set();
    timers = new Map();
    held = new Set();
    constructor(timer = defaultTimers, dismissMs = INFO_DISMISS_MS, covered = () => false) {
        this.timer = timer;
        this.dismissMs = dismissMs;
        this.covered = covered;
    }
    getSnapshot = () => this.snapshot;
    subscribe = (listener) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
    /** 作为分发层的「精灵」渠道。 */
    channel = { id: 'sprite', deliver: notice => this.push(notice), withdraw: key => this.dismiss(key) };
    push(notice) {
        if (this.items.some(item => item.key === notice.key))
            return;
        // 工作卡已经在屏幕上展示了同样的内容：不再在精灵上重复弹。
        if (this.covered(notice))
            return;
        // 稳定插入：同一等级先来的在前。已经露在外面的不会被新来的挤回队里，免得用户正要点时气泡换了。
        const shown = this.snapshot.visible.length;
        let index = this.items.length;
        for (let i = shown; i < this.items.length; i += 1)
            if (rank(this.items[i]) > rank(notice)) {
                index = i;
                break;
            }
        this.items.splice(index, 0, notice);
        this.publish();
    }
    dismiss(key) {
        if (!this.items.some(item => item.key === key))
            return;
        this.items = this.items.filter(item => item.key !== key);
        this.clearTimer(key);
        this.held.delete(key);
        this.publish();
    }
    /** 收掉已经被屏幕上的工作卡展示了的气泡（卡后出现、或滚进视口时）。只收起，不记回执。 */
    sweepCovered() {
        const drop = this.items.filter(item => this.covered(item));
        if (!drop.length)
            return;
        for (const item of drop) {
            this.clearTimer(item.key);
            this.held.delete(item.key);
        }
        this.items = this.items.filter(item => !drop.includes(item));
        this.publish();
    }
    /** 手指 / 焦点停在气泡上：暂停自动收起；离开后重新计时。 */
    hold(key, holding) {
        if (holding) {
            this.held.add(key);
            this.clearTimer(key);
            return;
        }
        this.held.delete(key);
        const notice = this.snapshot.visible.find(item => item.key === key);
        if (notice)
            this.arm(notice);
    }
    clear() {
        for (const key of [...this.timers.keys()])
            this.clearTimer(key);
        this.items = [];
        this.held.clear();
        this.publish();
    }
    arm(notice) {
        if (notice.sticky || this.timers.has(notice.key) || this.held.has(notice.key))
            return;
        this.timers.set(notice.key, this.timer.setTimeout(() => { this.timers.delete(notice.key); this.dismiss(notice.key); }, this.dismissMs));
    }
    clearTimer(key) {
        const handle = this.timers.get(key);
        if (handle === undefined)
            return;
        this.timer.clearTimeout(handle);
        this.timers.delete(key);
    }
    publish() {
        const visible = this.items.slice(0, MAX_VISIBLE);
        this.snapshot = { visible, queued: Math.max(0, this.items.length - visible.length), confirmShown: visible.some(item => item.kind === 'confirm') };
        for (const notice of visible)
            this.arm(notice);
        for (const listener of [...this.listeners])
            listener();
    }
}
