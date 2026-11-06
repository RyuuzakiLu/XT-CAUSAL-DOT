/* 每个source只看最后一次delta，避免一问进度就把整本聊天翻一遍。 */
export function watchProgressCards(ctx, open) {
    const { sessions } = ctx;
    const watches = new Map();
    const reconcile = () => {
        const active = new Set();
        for (const id of sessions.list.getSnapshot().ids) {
            if ((sessions.retainInfo(id).getSnapshot().retainedBy.mainView ?? 0) <= 0)
                continue;
            const binding = sessions.binding(id);
            if (!binding)
                continue;
            const source = binding.eventSource;
            active.add(source);
            if (watches.has(source))
                continue;
            const watcher = { revision: source.getSnapshot().revision, stop: () => { } };
            watcher.stop = source.subscribe(() => {
                const snapshot = source.getSnapshot();
                if (snapshot.revision === watcher.revision)
                    return;
                watcher.revision = snapshot.revision;
                if (snapshot.change.kind !== 'append')
                    return;
                for (const entry of snapshot.change.entries) {
                    if (entry.type !== 'event' || entry.event.type !== 'tool/result')
                        continue;
                    const meta = entry.event.data.meta;
                    if (typeof meta !== 'object' || meta === null || Array.isArray(meta))
                        continue;
                    if (meta.dot !== 'work' || meta.kind !== 'work-progress' || !Array.isArray(meta.works))
                        continue;
                    const ids = meta.works.flatMap(item => typeof item === 'object' && item !== null && !Array.isArray(item) && typeof item.workId === 'string' ? [item.workId] : []);
                    if (ids.length === 1 && ids[0])
                        open(ids[0]);
                }
            });
            watches.set(source, watcher);
        }
        for (const [source, watcher] of watches)
            if (!active.has(source)) {
                watcher.stop();
                watches.delete(source);
            }
    };
    const stop = sessions.list.subscribe(reconcile);
    reconcile();
    return () => { stop(); for (const watcher of watches.values())
        watcher.stop(); watches.clear(); };
}
