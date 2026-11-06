/* 从镜像只取编辑所需非秘密字段，不把整个配置树送进React或日志。 */
function profileAt(value, path) {
    for (const key of path)
        value = value && typeof value === 'object' ? value[key] : undefined;
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
/* 空模型名合法，空ID不合法；模型条目额外能力字段由原配置保留。 */
export function mergeModelRows(existing, selected) {
    const old = Array.isArray(existing) ? existing.filter((x) => !!x && typeof x === 'object') : [];
    return selected.map(row => ({ ...old.find(x => x.id === row.id), ...row }));
}
/* 所有操作由当前宿主连接执行。 */
export function createApiSettingsPort(ctx) {
    const mirror = ctx.configForms.describe();
    const getView = (ns) => mirror.getSnapshot().view?.namespaces.find(x => x.ns === ns);
    return {
        async load() {
            await mirror.ensure();
            const result = await ctx.remote.llm.listConfigurableProviders();
            if (!result.ok)
                throw new Error(result.error.message);
            return result.value.filter(x => x.settingsNs && x.provider !== 'deepseek-account').map(entry => {
                const view = getView(entry.settingsNs);
                const profile = profileAt(view?.value, entry.settingsPath);
                return { provider: entry.provider, name: entry.displayName, settingsNs: entry.settingsNs, path: [...entry.settingsPath], revision: view?.revision ?? 0, baseURL: typeof profile.baseURL === 'string' ? profile.baseURL : entry.defaultBaseURL ?? '', api: typeof profile.api === 'string' ? profile.api : '', keyRef: typeof profile.apiKeyEnv === 'string' ? profile.apiKeyEnv : `${entry.provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`, models: Array.isArray(profile.models) ? profile.models.flatMap(x => x && typeof x === 'object' && typeof x.id === 'string' ? [{ id: x.id, ...typeof x.name === 'string' ? { name: x.name } : {} }] : []) : [], writable: !!view && mirror.getSnapshot().view?.writable === true };
            });
        },
        async create(provider) {
            if (!/^[a-z][a-z0-9_-]{1,47}$/.test(provider))
                throw new Error('连接标识需为2—48位小写字母、数字、横线或下划线');
            await mirror.ensure();
            const view = getView('llm-pi-ai');
            if (!view)
                throw new Error('当前服务未提供自定义API适配器');
            if (mirror.getSnapshot().view?.writable !== true)
                throw new Error('当前服务未开放API配置写入');
            if (Object.keys(profileAt(view.value, ['providers', provider])).length)
                throw new Error('这个连接标识已存在，请从列表编辑');
            return { provider, name: provider, settingsNs: 'llm-pi-ai', path: ['providers', provider], revision: view.revision, baseURL: '', api: 'openai-completions', keyRef: `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`, models: [], writable: true };
        },
        async save({ draft, baseURL, api, key, models }) {
            const url = new URL(baseURL);
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
                throw new Error('需要不含账号密码的HTTP/HTTPS地址');
            await mirror.ensure();
            const view = getView(draft.settingsNs);
            if (mirror.getSnapshot().view?.writable !== true)
                throw new Error('当前服务未开放API配置写入');
            if (!view || view.revision !== draft.revision)
                throw new Error('配置后来已变化，请重新读取后再保存');
            const profile = profileAt(view.value, draft.path);
            const ops = [];
            if (key && typeof profile.apiKeyEnv !== 'string' && draft.settingsNs !== 'llm-pi-ai')
                throw new Error('当前连接未提供可确认的密钥引用，请使用其专属账号设置，不会猜测保存位置');
            if (baseURL !== draft.baseURL)
                ops.push({ op: 'set', path: [...draft.path, 'baseURL'], value: baseURL });
            if (api && (api !== draft.api || typeof profile.api !== 'string') && draft.settingsNs === 'llm-pi-ai')
                ops.push({ op: 'set', path: [...draft.path, 'api'], value: api });
            if (models) {
                const adapted = draft.settingsNs === 'llm-pi-ai' ? models : models.map(({ input, ...row }) => ({ ...row, ...input ? { inputModalities: input } : {} }));
                ops.push({ op: 'set', path: [...draft.path, 'models'], value: mergeModelRows(profile.models, adapted) });
            }
            if (key && typeof profile.apiKeyEnv !== 'string')
                ops.push({ op: 'set', path: [...draft.path, 'apiKeyEnv'], value: draft.keyRef });
            if (ops.length) {
                const saved = await ctx.remote.settings.mutate(draft.settingsNs, ops, draft.revision);
                if (!saved.ok)
                    throw new Error(saved.error.message);
                mirror.acceptView(saved.value);
            }
            if (key) {
                const saved = await ctx.remote.credentials.set(draft.keyRef, key);
                if (!saved.ok)
                    throw new Error(`配置已保存，但密钥保存失败：${saved.error.message}`);
            }
        },
        async discover({ draft, baseURL, api, key }) {
            const result = await ctx.remote.llm.discoverModels(draft.settingsNs, { provider: draft.provider, baseURL, ...api ? { api } : {}, ...key ? { apiKey: key } : {} });
            if (!result.ok)
                throw new Error(result.error.message);
            return result.value.map(x => ({ id: x.id, ...x.name ? { name: x.name } : {}, ...x.contextWindow ? { contextWindow: x.contextWindow } : {}, ...x.maxTokens ? { maxTokens: x.maxTokens } : {}, ...x.inputModalities ? { input: x.inputModalities.filter((v) => v === 'text' || v === 'image') } : {} }));
        },
    };
}
