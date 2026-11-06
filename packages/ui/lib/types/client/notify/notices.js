const WORK_PHASE = { 'waiting-approval': 'approval', 'waiting-input': 'input', succeeded: 'done', failed: 'failed' };
function workTopic(workId, phase) { return `work:${workId}:${phase}`; }
/**
 * 气泡「去填写」直达保密表单（2026-10-30 · Hark）。
 * 为什么：后台要用户钥匙时，入口原来只写在工作卡上，气泡点了先跳工作页、再点一次链接，
 * 手机上很容易断。这里只认**同源**、且路径在 /_dot/ 下的入口（服务端 blocked.action 下发的专用页），
 * 其余一律返回 false，调用方照旧打开工作页——不做任意外部跳转。
 */
export function openNoticeEntry(url, sameWindow = false) {
    if (typeof url !== 'string' || url === '' || typeof window === 'undefined' || typeof document === 'undefined')
        return false;
    let target;
    try {
        target = new URL(url, window.location.href);
    }
    catch {
        return false;
    }
    if (target.origin !== window.location.origin || !target.pathname.startsWith('/_dot/'))
        return false;
    /* 系统通知栏点进来不算页面内手势，新标签可能被拦；这条路径直接在当前页打开。 */
    if (sameWindow) {
        window.location.assign(target.href);
        return true;
    }
    const link = document.createElement('a');
    link.href = target.href;
    link.target = '_blank';
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    return true;
}
function shapeWork(phase, base) {
    const title = base.title.trim() || '一项工作';
    const common = { key: base.key, topic: workTopic(base.workId, phase), source: base.source, title, text: base.text, workId: base.workId, at: base.at, ...(base.postboxId ? { postboxId: base.postboxId } : {}) };
    switch (phase) {
        case 'approval': return { ...common, kind: 'confirm', tone: 'attention', eyebrow: '请你确认', sticky: true, ...(base.risk ? { risk: base.risk } : {}) };
        case 'input': return { ...common, kind: 'input', tone: 'attention', eyebrow: '要你补充', sticky: true, ...(base.entryUrl ? { entryUrl: base.entryUrl } : {}), ...(base.entryLabel ? { entryLabel: base.entryLabel } : {}) };
        case 'done': return { ...common, kind: 'info', tone: 'done', eyebrow: '做完了', sticky: false };
        case 'failed': return { ...common, kind: 'info', tone: 'failed', eyebrow: '没做成', sticky: false };
    }
}
/** 工作全局状态里「亲眼看到的状态变化」→ 通知。只认四种变化，其余返回 null。 */
export function noticeFromWork(notice, card) {
    const phase = WORK_PHASE[notice.status];
    if (!phase)
        return null;
    const attention = card?.attention;
    const text = phase === 'approval' || phase === 'input'
        ? (attention?.message || (phase === 'approval' ? '这一步需要你点头才能继续。' : '需要你补充信息才能继续。'))
        : phase === 'failed' ? (card?.error || notice.text) : notice.text;
    return shapeWork(phase, { key: `work:${notice.key}`, workId: notice.workId, title: notice.title || card?.title || '', text, at: notice.at, source: 'work', ...(phase === 'approval' && attention?.risk ? { risk: attention.risk } : {}), ...(phase === 'input' && typeof attention?.action?.url === 'string' ? { entryUrl: attention.action.url } : {}), ...(phase === 'input' && typeof attention?.action?.label === 'string' && attention.action.label.length > 0 && attention.action.label.length <= 8 ? { entryLabel: attention.action.label } : {}) });
}
const POSTBOX_WORK_PHASE = { 'work-completed': 'done', 'work-failed': 'failed', 'work-blocked': 'input', 'work-waiting-approval': 'approval' };
/**
 * 星邮匣事件 → 通知。
 * - 工作类事件（work-*）一律算工作通知，和工作推送共用 topic，只弹一次。
 * - 提醒 / 消息类只有「重要」「紧急」才走精灵气泡；普通的返回 null，沿用原来的顶部提示条。
 */
export function noticeFromPostbox(event, card, now) {
    const phase = POSTBOX_WORK_PHASE[event.kind];
    if (phase && event.workId) {
        const attention = card?.attention;
        const text = (phase === 'approval' || phase === 'input') && attention?.message ? attention.message : (event.body || event.title);
        return shapeWork(phase, { key: `postbox:${event.id}`, workId: event.workId, title: card?.title || event.title, text, at: now, source: 'postbox', postboxId: event.id, ...(phase === 'approval' && attention?.risk ? { risk: attention.risk } : {}), ...(phase === 'input' && typeof attention?.action?.url === 'string' ? { entryUrl: attention.action.url } : {}), ...(phase === 'input' && typeof attention?.action?.label === 'string' && attention.action.label.length > 0 && attention.action.label.length <= 8 ? { entryLabel: attention.action.label } : {}) });
    }
    if (event.severity !== 'important' && event.severity !== 'urgent')
        return null;
    return {
        key: `postbox:${event.id}`, topic: `postbox:${event.id}`, kind: 'info', tone: 'reminder', source: 'postbox',
        eyebrow: event.severity === 'urgent' ? '紧急提醒' : '重要提醒', title: event.title, text: event.body ?? '',
        postboxId: event.id, ...(event.workId ? { workId: event.workId } : {}),
        // 紧急提醒要用户点「知道了」才收；重要提醒和其他「只是告诉你」一样自动收起。
        sticky: event.severity === 'urgent', at: now,
    };
}
/** 旧规则：不管前台后台都从精灵弹。现在只留给测试和截图用。 */
export const spriteEverywhere = () => ['sprite'];
/** 现在的规则（用户 2026-10-24 定第 2 项 C）：前台走精灵，后台走手机系统通知栏。 */
export const foregroundSpriteBackgroundNative = (_notice, environment) => environment.visible ? ['sprite'] : ['native'];
export class NoticeDispatcher {
    channels = new Map();
    seenKeys = new Set();
    topics = new Map();
    route;
    environment;
    clock;
    topicWindowMs;
    deferred = new Map();
    constructor(channels, options = {}) {
        for (const channel of channels)
            this.channels.set(channel.id, channel);
        this.route = options.route ?? foregroundSpriteBackgroundNative;
        this.environment = options.environment ?? (() => ({ visible: typeof document === 'undefined' || document.visibilityState !== 'hidden' }));
        this.clock = options.clock ?? Date.now;
        this.topicWindowMs = options.topicWindowMs ?? 10 * 60_000;
    }
    /** 接系统通知栏：addChannel(createSystemNoticeChannel(...)) 或 addChannel(createAndroidNoticeChannel(...))。 */
    addChannel(channel) {
        this.channels.set(channel.id, channel);
        return () => { if (this.channels.get(channel.id) === channel)
            this.channels.delete(channel.id); };
    }
    setRoute(route) { this.route = route; }
    /** 分发一条通知；被去重挡下或没有可用渠道时返回 false。 */
    dispatch(notice) {
        if (this.seenKeys.has(notice.key))
            return false;
        const now = this.clock();
        const previous = this.topics.get(notice.topic);
        this.seenKeys.add(notice.key);
        if (previous && now - previous.at < this.topicWindowMs)
            return false;
        let targets = this.route(notice, this.environment()).filter(id => this.channels.has(id));
        /* 路由要的渠道一个都没有（例如没接系统通知）时退回精灵，不让通知丢掉。 */
        if (!targets.length && this.channels.has('sprite'))
            targets = ['sprite'];
        if (!targets.length)
            return false;
        this.deferred.delete(notice.key);
        this.topics.set(notice.topic, { at: now, key: notice.key, channels: targets });
        const results = targets.map(id => this.channels.get(id).deliver(notice));
        const failed = (values) => values.every(value => value === false);
        if (results.some(result => result instanceof Promise)) {
            void Promise.all(results.map(result => Promise.resolve(result).catch(() => false))).then(values => { if (failed(values))
                this.defer(notice); });
        }
        else if (failed(results))
            this.defer(notice);
        return true;
    }
    /** 这条没弹出来：放开去重，留到 flushDeferred（回到前台）再分发一次。 */
    defer(notice) {
        if (this.topics.get(notice.topic)?.key === notice.key)
            this.topics.delete(notice.topic);
        this.seenKeys.delete(notice.key);
        this.deferred.set(notice.key, notice);
    }
    /** 回到前台时调用：把后台没弹出来的通知重新分发（此时会走精灵）。 */
    flushDeferred() {
        const pending = [...this.deferred.values()];
        this.deferred.clear();
        return pending.filter(notice => this.dispatch(notice)).length;
    }
    /** 还在等回前台补弹的通知数（测试用）。 */
    get deferredCount() { return this.deferred.size; }
    /** 收回某个主题的通知（例如工作已经不在等确认）。 */
    withdrawTopic(topic) {
        const entry = this.topics.get(topic);
        if (!entry)
            return;
        for (const id of entry.channels)
            this.channels.get(id)?.withdraw(entry.key);
    }
    /** 某个主题重新允许弹（例如工作离开了等确认，下次再进来要再弹）。 */
    forgetTopic(topic) {
        this.topics.delete(topic);
        /* 已经不成立的事，回前台也不用补弹了。 */
        for (const [key, notice] of this.deferred)
            if (notice.topic === topic)
                this.deferred.delete(key);
    }
}
/** 工作当前状态对应的「还成立」的主题；不在等待中就没有。 */
export function liveWorkTopic(card) {
    if (!card)
        return null;
    if (card.status === 'waiting-approval')
        return workTopic(card.id, 'approval');
    if (card.status === 'waiting-input')
        return workTopic(card.id, 'input');
    return null;
}
export function workTopicOf(workId, kind) { return workTopic(workId, kind); }
/**
 * 手机系统通知栏渠道：在安卓壳里走 window.dotAndroid.notify，网页里走 Notification。
 * show 返回 false 表示没弹出来（没权限 / 不支持），分发器会留到回前台从精灵补弹。
 * onShown：真的弹出来了（星邮匣据此记投递回执）；onOpen：用户点了系统通知。
 */
export function createSystemNoticeChannel(show, hooks = {}) {
    return {
        id: 'native',
        deliver: async (notice) => {
            const body = [notice.text, notice.risk ? `风险：${notice.risk}` : ''].filter(Boolean).join('\n');
            const shown = await show({ id: notice.key, title: `${notice.eyebrow} · ${notice.title}`, body, ...(notice.workId ? { workId: notice.workId } : {}) }, () => hooks.onOpen?.(notice));
            if (shown)
                hooks.onShown?.(notice);
            return shown;
        },
        withdraw: () => { },
    };
}
/**
 * 直接把通知交给原生壳的渠道（壳支持动作按钮时用）。现在注册的是 createSystemNoticeChannel。
 * payload 是 JSON：{ id, kind, title, body, risk?, workId?, postboxId?, actions }，
 * actions 里 confirm 类给 ['confirm','reject']，input 给 ['fill']，info 给 ['open']。
 * 原生点按后回调网页（例如 dot://notice?id=…&action=confirm），由壳调 onAction 交回来。
 */
export function createAndroidNoticeChannel(bridge) {
    return {
        id: 'native',
        deliver: notice => bridge.notify(JSON.stringify({
            id: notice.key, kind: notice.kind, title: `${notice.eyebrow} · ${notice.title}`, body: notice.text,
            ...(notice.risk ? { risk: notice.risk } : {}), ...(notice.workId ? { workId: notice.workId } : {}), ...(notice.postboxId ? { postboxId: notice.postboxId } : {}),
            actions: notice.kind === 'confirm' ? ['confirm', 'reject'] : notice.kind === 'input' ? ['fill'] : ['open'],
        })),
        withdraw: () => { },
    };
}
