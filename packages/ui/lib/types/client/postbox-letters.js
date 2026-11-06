export const TODO_ID_PREFIX = 'zhixu-task:';
const STATUS_BY_LABEL = { 待办: 'pending', 进行中: 'in_progress', 已完成: 'done', 已取消: 'canceled' };
const LABEL_BY_STATUS = { pending: '待办', in_progress: '进行中', done: '已完成', canceled: '已取消' };
function todoOf(event) {
    const raw = event.todo;
    if (raw && typeof raw === 'object' && typeof raw.taskId === 'string' && raw.status && raw.status in LABEL_BY_STATUS) {
        const status = raw.status;
        return {
            taskId: raw.taskId,
            status,
            statusLabel: LABEL_BY_STATUS[status],
            done: status === 'done',
            closed: status === 'done' || status === 'canceled',
            progress: typeof raw.progress === 'string' ? raw.progress : '',
            updates: Array.isArray(raw.updates)
                ? raw.updates.map(update => ({ id: String(update.id), title: String(update.title ?? ''), body: String(update.body ?? ''), at: new Date(Number(update.at)).toLocaleString(), read: Boolean(update.read) }))
                : [],
        };
    }
    if (!event.id.startsWith(TODO_ID_PREFIX))
        return undefined;
    const label = /^状态：(待办|进行中|已完成|已取消)/.exec(event.body ?? '')?.[1];
    const status = (label && STATUS_BY_LABEL[label]) || 'pending';
    const progress = /最新进展：([^\n]+)/.exec(event.body ?? '')?.[1] ?? '';
    return { taskId: event.id.slice(TODO_ID_PREFIX.length), status, statusLabel: LABEL_BY_STATUS[status], done: status === 'done', closed: status === 'done' || status === 'canceled', progress, updates: [] };
}
/** 投递摘要中只把真实 failed 状态视作失败；suppressed 不算失败。 */
export function deliveryFailed(delivery) {
    return (delivery ?? '').split('·').some(part => /:\s*failed\s*$/.test(part));
}
/** 一条信 → 界面行。 */
export function letterRowOf(event) {
    const todo = todoOf(event);
    const changedAt = Number(event.todo?.changedAt);
    /* postbox-quiet：待办显示最近一次动态（含安静的进度更新）；普通信的 updatedAt 会随已读/回执变，仍显示 createdAt。 */
    const shownAt = todo && Number(event.updatedAt) > event.createdAt ? Number(event.updatedAt) : event.createdAt;
    return {
        id: event.id,
        title: event.title,
        body: event.body ?? '',
        read: event.read,
        archived: event.archived,
        createdAt: new Date(shownAt).toLocaleString(),
        at: Number.isFinite(changedAt) && changedAt > 0 ? changedAt : event.createdAt,
        ...(event.kind ? { kind: event.kind } : {}),
        ...(event.dedupeKey?.startsWith('dot:greeting:') ? { proactive: true } : {}),
        ...(event.severity ? { severity: event.severity } : {}),
        ...(event.workId ? { workId: event.workId } : {}),
        ...(todo ? { todo } : {}),
        delivery: event.deliveries.map(value => `${value.channel}: ${value.status}`).join(' · '),
    };
}
