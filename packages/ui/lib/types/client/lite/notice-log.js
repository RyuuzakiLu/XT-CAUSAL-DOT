export const NOTICE_LOG_KEY = 'xtcausal.dot.lite.notices.v1';
const LIMIT = 60;
/* 旧 localStorage 缺账号归属，不能跨账号读取。持久消息以服务端邮匣为准；
   尚未入邮匣的临时通知只保存在当前页面内存。旧数据保留原样，不做迁移或删除。 */
let items = [];
const listeners = new Set();
function save(next) {
    items = next.slice(0, LIMIT);
    for (const listener of listeners)
        listener();
}
export const noticeLog = {
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    get() { return items; },
    unread() { return items.reduce((count, item) => count + (item.read ? 0 : 1), 0); },
    record(notice, read = false) {
        const previous = items.find(item => item.key === notice.key);
        const entry = {
            key: notice.key, at: previous?.at ?? notice.at ?? Date.now(), kind: notice.kind, tone: notice.tone,
            eyebrow: notice.eyebrow, title: notice.title, text: notice.text, workId: notice.workId, postboxId: notice.postboxId,
            entryUrl: notice.entryUrl, read: previous ? previous.read || read : read,
        };
        if (previous && previous.title === entry.title && previous.text === entry.text && previous.read === entry.read)
            return;
        save([entry, ...items.filter(item => item.key !== notice.key)]);
    },
    markRead(key) {
        if (!items.some(item => !item.read && (key === undefined || item.key === key)))
            return;
        save(items.map(item => key === undefined || item.key === key ? { ...item, read: true } : item));
    },
    clear() { save([]); },
};
