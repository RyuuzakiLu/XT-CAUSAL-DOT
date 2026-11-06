/* 地址只显示干净端点，查询、用户信息和可能带密钥的片段一律不进卡片。 */
export function safeEndpoint(value) {
    if (typeof value !== 'string')
        return undefined;
    try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol))
            return undefined;
        return `${url.origin}${url.pathname === '/' ? '' : '/…'}`;
    }
    catch {
        return undefined;
    }
}
/* 同一原生目录只读元信息，慢响应不能覆盖重连后的新目录。 */
export function installProviderDirectory(ctx, model) {
    let generation = 0, stopped = false;
    const mirror = ctx.configForms.describe();
    const load = async () => {
        const own = ++generation;
        try {
            const [live, declared, catalog] = await Promise.all([ctx.remote.llm.listProviders(), ctx.remote.llm.listConfigurableProviders(), ctx.remote.session.modelCatalog(), mirror.ensure()]);
            if (stopped || own !== generation)
                return;
            if (!live.ok)
                throw new Error(live.error.message);
            if (!declared.ok)
                throw new Error(declared.error.message);
            if (!catalog.ok)
                throw new Error(catalog.error.message);
            const active = new Set(live.value.map(row => row.id));
            const namespaces = mirror.getSnapshot().view?.namespaces ?? [];
            const directory = new Map(declared.value.map(row => [row.provider, row]));
            const configured = (entry) => {
                let value = namespaces.find(row => row.ns === entry.settingsNs)?.user;
                for (const key of entry.settingsPath)
                    value = value && typeof value === 'object' ? value[key] : undefined;
                return value !== undefined && (entry.settingsPath.length > 0 || value !== null && typeof value === 'object' && Object.keys(value).length > 0);
            };
            const ids = [...new Set([...live.value.map(row => row.id), ...declared.value.filter(row => row.declared || configured(row)).map(row => row.provider), ...catalog.value.groups.map(row => row.id)])];
            const providers = ids.map(id => {
                const entry = directory.get(id);
                let config = namespaces.find(row => row.ns === entry?.settingsNs)?.value;
                for (const key of entry?.settingsPath ?? [])
                    config = config && typeof config === 'object' ? config[key] : undefined;
                const endpoint = safeEndpoint(config && typeof config === 'object' ? config.baseURL ?? entry?.defaultBaseURL : entry?.defaultBaseURL);
                const group = catalog.value.groups.find(row => row.id === id);
                const error = entry?.error ?? catalog.value.failures.find(row => row.id === id)?.message;
                return { id, name: entry?.displayName ?? group?.name ?? live.value.find(row => row.id === id)?.name ?? id, active: active.has(id), ...(endpoint ? { endpoint } : {}), ...(error ? { error } : {}), models: group?.models.map(row => ({ id: row.id, name: row.name, selected: catalog.value.default.provider === id && catalog.value.default.model === row.id, ...(row.reasoning ? { reasoning: row.reasoning.efforts.map(level => level.name) } : {}) })) ?? (config && typeof config === 'object' && Array.isArray(config.models) ? config.models.flatMap(value => value && typeof value === 'object' && typeof value.id === 'string' ? [{ id: value.id, name: typeof value.name === 'string' ? value.name : value.id }] : []) : []) };
            });
            model.update({ providers, providerError: null });
        }
        catch (error) {
            if (!stopped && own === generation)
                model.update({ providerError: String(error) });
        }
    };
    const stops = [ctx.remote.$on('llm/adapters-updated', () => { void load(); }), ctx.remote.$on('settings/document-updated', () => { void load(); }), ctx.on('connection/reset', () => { void load(); })];
    void load();
    return () => { stopped = true; ++generation; for (const stop of stops)
        stop(); };
}
