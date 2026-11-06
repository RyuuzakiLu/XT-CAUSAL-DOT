/* 登记表提供的是 owner 自己返回同一个实例的句柄，不从私有变量偷状态。 */
export function nativeSettings(ctx) {
    const resolve = () => {
        for (const entry of ctx.slots.entries('sidebar.settings')) {
            const handle = entry.store;
            if (!handle || typeof handle !== 'object' || !('create' in handle) || typeof handle.create !== 'function')
                continue;
            const instance = handle.create();
            if (typeof instance.actions?.openSection === 'function' && typeof instance.actions?.close === 'function')
                return instance;
        }
        return null;
    };
    return {
        open(section) { const store = resolve(); if (!store)
            throw new Error('插件设置尚未就绪，请待连接恢复后重试'); if (section)
            store.actions.openSection(section);
        else
            store.actions.open(); },
        close() { const store = resolve(); if (!store?.getSnapshot().open)
            return false; store.actions.close(); return true; },
        isOpen() { return resolve()?.getSnapshot().open ?? false; },
    };
}
