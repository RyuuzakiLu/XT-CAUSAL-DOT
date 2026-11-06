import { RemoteStreamCarrierError } from '@deepseek-ai/dsh-api-gateway/client';
import runtimeContribution from '@xtcausal/dot-runtime/remote';
import workContribution from '@xtcausal/dot-work/remote';
import memoryContribution from '@xtcausal/dot-memory/remote';
import postboxContribution from '@xtcausal/dot-postbox/remote';
import { letterRowOf } from "./postbox-letters.js"; // postbox-todo 2026-10-30：知序待办折叠行 + 角标时间
import { showNotification } from "./platform.js";
/* 原生 Remote 的失败值必须显式展开，不能把业务失败当成功传进界面。 */
function unwrap(result) {
    if (!result.ok)
        throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.value;
}
/* 挂载与流都属于同一 fiber；卸载后新旧实例不会同时订阅。 */
/* live（2026-10-24 联动）：工作推送原样交给全局工作状态，推送断开就退回 5 秒一次的查询；
   星邮匣的工作事件和「重要」「紧急」提醒改走精灵气泡，普通提醒仍走原来的顶部提示条。 */
export function installBusiness(ctx, model, setPort, openCard, live) {
    let stopped = false;
    let wired = false;
    const cleanups = [];
    const setup = async () => {
        const { remote } = ctx;
        for (const contribution of [runtimeContribution, workContribution, memoryContribution, postboxContribution]) {
            const dispose = await remote.$mount(contribution);
            if (stopped) {
                await dispose();
                return;
            }
            cleanups.push(dispose);
        }
        if (stopped)
            return;
        ctx.inject(['remote.dotWork', 'remote.dotMemory', 'remote.dotPostbox', 'remote.dotCapabilities'], child => {
            /* ⚠️ 同一 fiber 内 inject 可能因上下文刷新再来一次；已经接过流就不再重复挂，
               否则每来一次 ready 就多一条订阅 + 多一轮取数，页越用越卡。 */
            if (wired || stopped)
                return;
            wired = true;
            void connected(child).catch(error => { wired = false; if (!stopped)
                model.update({ error: String(error) }); });
        });
    };
    const connected = async (child) => {
        const { remote } = child;
        const work = remote.dotWork, memory = remote.dotMemory, postbox = remote.dotPostbox, capabilities = remote.dotCapabilities;
        const layout = child.layout;
        /* 成果正文缓存：只记住真正打开过的正文，列表本身不带正文。 */
        const artifactCache = new Map();
        /* 工作列表：只把引用元信息搬给界面，不逐个拉正文（研究 §6 第 4 条）。 */
        const rows = async () => {
            const list = unwrap(await work.list({ limit: 100 }));
            return list.works.map((detail) => ({
                id: detail.id, goal: detail.goal, status: detail.status, stage: detail.stage, updatedAt: detail.updatedAt, createdAt: detail.createdAt,
                ...(detail.progress === undefined ? {} : { progress: detail.progress * 100 }),
                ...(detail.error ? { error: detail.error } : {}),
                /* 「等你处理」原样透传：工作空间据此画可点入口（填表/授权）。
                   入口地址由服务端下发，界面不拼；秘密不会走到这一层。 */
                ...(detail.blocked === undefined ? {} : { blocked: detail.blocked }),
                /* 打开过的正文/下载地址拼回同一行；没打开过就只有标题与 id。 */
                artifacts: detail.artifacts.map(artifact => ({ id: artifact.id, title: artifact.title, kind: artifact.kind, ...(artifactCache.get(artifact.id) ?? {}) })),
            }));
        };
        const memories = (hits) => hits.map(hit => ({
            id: hit.id, text: hit.text, source: hit.namespace,
            ...(hit.updatedAt === undefined ? {} : { updatedAt: new Date(hit.updatedAt).toLocaleString() }),
            /* 2026-10-26 主线02：把种类/可见性/状态带进界面。
               ⚠️ 没有种类就留空，不填默认值——猜错等于把"假设"画成"事实"。 */
            ...(hit.kind === undefined ? {} : { kind: hit.kind }),
            ...(hit.visibility === undefined ? {} : { visibility: hit.visibility }),
            ...(hit.state === undefined ? {} : { state: hit.state }),
            ...(hit.supersededBy === undefined ? {} : { supersededBy: hit.supersededBy }),
        }));
        /** 历史行比普通行多 retireReason（解释"为什么退的"），其余同形。 */
        const historyRows = (hits) => hits.map(hit => ({
            id: hit.id, text: hit.text, source: hit.namespace,
            ...(hit.updatedAt === undefined ? {} : { updatedAt: new Date(hit.updatedAt).toLocaleString() }),
            ...(hit.kind === undefined ? {} : { kind: hit.kind }),
            ...(hit.visibility === undefined ? {} : { visibility: hit.visibility }),
            ...(hit.state === undefined ? {} : { state: hit.state }),
            ...(hit.supersededBy === undefined ? {} : { supersededBy: hit.supersededBy }),
            ...(hit.retireReason === undefined ? {} : { retireReason: hit.retireReason }),
        }));
        /* 按领域取数：每块只发自己的请求，谁先回来谁先发布。
           ⚠️ 失败清单必须是本次调用的局部变量：两个领域并发时共用一个数组，
              会把别人的失败算到自己头上（还会互相清空）。 */
        const loadDomain = async (domain) => {
            const previous = model.getSnapshot();
            const failures = [];
            /* 失败时保留上一份真值并记下原因，不让一块坏数据把别的领域也涂黑。 */
            const safely = async (name, run, fallback) => {
                try {
                    return await run();
                }
                catch (error) {
                    failures.push(`${name}：${String(error)}`);
                    return fallback;
                }
            };
            if (domain === 'work') {
                const works = await safely('工作', rows, previous.works);
                return { works, error: failures.length ? failures.join('\n') : null };
            }
            if (domain === 'plans') {
                const plans = await safely('持续职责', async () => [...unwrap(await work.listPlans({})).plans], previous.plans);
                return { plans, error: failures.length ? failures.join('\n') : null };
            }
            if (domain === 'memory') {
                const [memoryRows, status] = await Promise.all([
                    safely('记忆', async () => memories(unwrap(await memory.list({ limit: 50 })).hits), previous.memories),
                    safely('记忆状态', async () => unwrap(await memory.status()), { available: false, reason: '连接未就绪', engine: 'xtmem', actor: 'dot', namespace: 'dot', dbIsolated: false, sharedLibrary: true }),
                ]);
                return { memories: memoryRows, memoryStatus: status, error: failures.length ? failures.join('\n') : null };
            }
            if (domain === 'postbox') {
                const [mail, dnd, ps] = await Promise.all([
                    safely('星邮匣', async () => unwrap(await postbox.list({ limit: 100 })).items.map(letterRowOf), previous.letters),
                    safely('提醒偏好', async () => unwrap(await postbox.preferences()), previous.reminderSettings),
                    safely('投递状态', async () => { const state = unwrap(await postbox.status()); return { channels: state.channels }; }, { channels: { native: { available: false }, feishu: { configured: false, reason: '连接未就绪' }, wechat: { available: false, reason: '未提供微信接入' } } }),
                ]);
                return {
                    letters: mail,
                    dnd: Boolean(dnd?.preferences.dnd.enabled && (dnd.preferences.dnd.until === undefined || dnd.preferences.dnd.until > Date.now())),
                    ...(dnd ? { reminderSettings: dnd } : {}),
                    channelStatus: { feishuConfigured: ps.channels.feishu.configured, ...(ps.channels.feishu.reason ? { reason: ps.channels.feishu.reason } : {}) },
                    error: failures.length ? failures.join('\n') : null,
                };
            }
            /* 能力目录要报"记忆/飞书到底可不可用"，所以并行取两条轻量状态：
               memory.status 是一次 CLI 只读探测（不是 memory.list，不搬条目），
               postbox.status 只读渠道可用性。少了它们，能力页会把已就绪的插件显示成未连接。 */
            const [tools, ms, ps] = await Promise.all([
                safely('能力目录', async () => unwrap(await capabilities.list()).tools, []),
                safely('记忆状态', async () => unwrap(await memory.status()), { available: false, reason: '连接未就绪', engine: 'xtmem', actor: 'dot', namespace: 'dot', dbIsolated: false, sharedLibrary: true }),
                safely('投递状态', async () => { const state = unwrap(await postbox.status()); return { channels: state.channels }; }, { channels: { native: { available: false }, feishu: { configured: false, reason: '连接未就绪' }, wechat: { available: false, reason: '未提供微信接入' } } }),
            ]);
            return {
                memoryStatus: ms,
                channelStatus: { feishuConfigured: ps.channels.feishu.configured, ...(ps.channels.feishu.reason ? { reason: ps.channels.feishu.reason } : {}) },
                capabilities: [{ id: 'work', title: '后台工作', available: true },
                    { id: 'memory', title: 'XTMEM 长期记忆', available: ms.available, ...(ms.reason ? { reason: ms.reason } : {}) },
                    { id: 'feishu', title: '飞书提醒', available: ps.channels.feishu.configured, ...(ps.channels.feishu.reason ? { reason: ps.channels.feishu.reason } : {}) },
                    { id: 'wechat', title: '微信提醒', available: false, reason: ps.channels.wechat.reason },
                    ...tools.map(tool => ({ id: `tool:${tool.name}`, title: tool.name, available: true, reason: tool.description }))],
                error: failures.length ? failures.join('\n') : null,
            };
        };
        /* 成果正文按工作一次取齐，写进缓存供下一次列表拼装；只给真正打开的那张卡用。 */
        const readArtifacts = async (workId) => {
            const detail = unwrap(await work.get({ workId: workId }));
            const contents = await Promise.all(detail.work.artifacts.map(async (artifact) => {
                const cached = artifactCache.get(artifact.id);
                if (cached)
                    return { id: artifact.id, ...cached };
                const content = unwrap(await work.artifact({ artifactId: artifact.id }));
                const value = content.kind === 'text' ? { text: content.text } : { url: `data:${content.mimeType};base64,${content.base64}` };
                artifactCache.set(artifact.id, value);
                return { id: artifact.id, ...value };
            }));
            return contents;
        };
        const port = {
            /* 旧整包入口保留（外部仍可能调），但只取"当前空间要的那几块"：
               记忆空间的刷新不该把工作+邮件+能力也重查一遍，首页刷新也不该去碰记忆。
               真正的按领域入口是下面的 loadDomain。 */
            load: async () => {
                const parts = await Promise.all(model.spaceDomains().map(domain => loadDomain(domain)));
                return Object.assign({}, ...parts);
            },
            loadDomain,
            readArtifacts,
            /* 历史查询单独一条：只读、按需（用户点"历史"才发），不混进正常召回。
               ⚠️ 2026-10-26 R1：把 complete/scanned 一起带回去——项目过滤只能在适配器侧做，
                  不完整却当成"查全了"就是骗用户。 */
            readMemoryHistory: async (options) => {
                const page = unwrap(await memory.history({
                    ...(options.query === undefined || options.query === '' ? {} : { query: options.query }),
                    ...(options.project === undefined || options.project === '' ? {} : { project: options.project }),
                    ...(options.limit === undefined ? {} : { limit: options.limit }),
                }));
                return { rows: historyRows(page.hits), complete: page.complete, scanned: page.scanned };
            },
            search: async (query) => memories(unwrap(await memory.search({ query })).hits),
            command: async (action, value) => {
                const operationId = String(value.operationId ?? crypto.randomUUID());
                if (action === 'work.create')
                    unwrap(await work.create({ goal: String(value.goal), operationId }));
                else if (action === 'work.cancel') {
                    const result = unwrap(await work.cancel({ workId: String(value.workId) }));
                    if (result.externalActions === 'observed-may-have-happened')
                        model.update({ error: '已停止后续动作；已经发生的外部动作没有撤回。' });
                }
                else if (action === 'work.retry')
                    unwrap(await work.retry({ workId: String(value.workId), operationId }));
                else if (action === 'work.supplement')
                    unwrap(await work.supplement({ workId: String(value.workId), text: String(value.text), operationId }));
                else if (action === 'plan.create')
                    unwrap(await work.createPlan({ title: String(value.goal).slice(0, 40), goal: String(value.goal), timing: { kind: 'every', everySeconds: Number(value.minutes) * 60 }, operationId }));
                else if (action === 'plan.pause')
                    unwrap(await work.pausePlan({ planId: String(value.planId), operationId }));
                else if (action === 'plan.resume')
                    unwrap(await work.resumePlan({ planId: String(value.planId), operationId }));
                else if (action === 'plan.cancel')
                    unwrap(await work.cancelPlan({ planId: String(value.planId), operationId }));
                else if (action === 'memory.store') {
                    /* 2026-10-26 主线02：保存可带 kind / visibility。
                       ⚠️ 没给 visibility 就交给引擎的默认 private——界面不要替用户"顺手共享"。 */
                    const result = unwrap(await memory.store({
                        text: String(value.text), operationId,
                        ...(typeof value.kind === 'string' && value.kind !== '' ? { kind: value.kind } : {}),
                        ...(typeof value.visibility === 'string' && value.visibility !== '' ? { visibility: value.visibility } : {}),
                        ...(Array.isArray(value.sharedWith) ? { sharedWith: value.sharedWith.map(String) } : {}),
                    }));
                    if (!result.ok)
                        throw new Error(result.reason ?? '记忆未保存');
                }
                else if (action === 'memory.correct') {
                    const result = unwrap(await memory.correct({
                        id: String(value.id), text: String(value.text), operationId,
                        ...(typeof value.kind === 'string' && value.kind !== '' ? { kind: value.kind } : {}),
                    }));
                    if (!result.ok)
                        throw new Error('记忆纠正未完成');
                }
                else if (action === 'memory.forget')
                    unwrap(await memory.forget({ id: String(value.id), operationId, confirmed: true }));
                /* 恢复被归档的记忆：缺省只预览；真恢复必须显式 confirmed:true（与删除同闸）。 */
                else if (action === 'memory.restore') {
                    const result = unwrap(await memory.restore({
                        id: String(value.id),
                        confirmed: value.confirmed === true,
                    }));
                    if (!result.ok)
                        throw new Error(result.reason ?? '记忆恢复未完成');
                }
                else if (action === 'postbox.read')
                    unwrap(await postbox.read({ id: String(value.id), operationId }));
                else if (action === 'postbox.archive')
                    unwrap(await postbox.archive({ id: String(value.id), operationId }));
                else if (action === 'postbox.retry')
                    unwrap(await postbox.retryDelivery({ id: String(value.id), channel: 'native', operationId }));
                else if (action === 'settings.reminders') {
                    const current = unwrap(await postbox.preferences());
                    if (!current.personalReminders && !('channel' in value))
                        throw new Error('这项提醒扩展需要加载新版 DOT 宿主；当前未保存，显示设置仍可直接使用。');
                    const preferences = { ...current.preferences };
                    if (value.restore) {
                        if (JSON.stringify(current.preferences) !== JSON.stringify(value.expected))
                            throw new Error('提醒后来又被改过，不能用旧撤销覆盖');
                        unwrap(await postbox.setPreferences({ preferences: value.restore, rev: current.rev, operationId }));
                        return;
                    }
                    if ('until' in value) {
                        const until = value.until;
                        if (until !== null && (typeof until !== 'number' || !Number.isFinite(until) || until <= Date.now()))
                            throw new Error('免打扰结束时间需要在未来');
                        preferences.dnd = { ...preferences.dnd, enabled: until !== null, ...(until === null ? { until: undefined } : { until, allowUrgent: false }) };
                    }
                    else if (value.category === 'completed' || value.category === 'attention' || value.category === 'failed') {
                        if (typeof value.enabled !== 'boolean')
                            throw new Error('提醒偏好需要开或关');
                        preferences.events = { completed: true, attention: true, failed: true, ...preferences.events, [value.category]: value.enabled };
                    }
                    else if (value.channel === 'native' || value.channel === 'feishu') {
                        if (typeof value.enabled !== 'boolean')
                            throw new Error('渠道偏好需要开或关');
                        preferences.channels = { ...preferences.channels, [value.channel]: value.enabled };
                    }
                    else
                        throw new Error('未登记的提醒设置');
                    unwrap(await postbox.setPreferences({ preferences, rev: current.rev, operationId }));
                }
                else if (action === 'postbox.preferences') {
                    const current = unwrap(await postbox.preferences());
                    unwrap(await postbox.setPreferences({ preferences: { ...current.preferences, dnd: { ...current.preferences.dnd, enabled: Boolean(value.dnd), until: undefined, allowUrgent: true } }, rev: current.rev, operationId }));
                }
                else if (action === 'plugins.open')
                    layout.selectPanel('plugins');
                else
                    throw new Error(`当前能力尚未提供此动作：${action}`);
            },
        };
        setPort(port);
        /* 领域源挂给模型：界面切空间时按需取；成果正文也走这里。卸载时摘钩子，旧连接不再写快照。 */
        const detach = model.attachDomainSource(port);
        cleanups.push(detach);
        /* 首屏只取当前空间需要的领域；【不】再发整包八组请求，更不碰记忆。
           用 warmSpace 而不是 setSpace：主端还没接空间钩子时，刷新按钮仍保持老整包行为。 */
        model.warmSpace();
        if (stopped)
            return;
        const feed = live?.connect({ list: async () => unwrap(await work.list({ limit: 100 })).works });
        cleanups.push(() => { if (live?.feed === feed)
            live?.disconnect(); });
        const follow = remote.$stream({ name: 'dot work', open: signal => work.follow({}, signal), ended: accepted => accepted ? new RemoteStreamCarrierError('dot work stream ended') : new Error('dot work stream did not open'), carrierFailed: error => feed?.pushLost(error) });
        live?.setPostboxReceipt((id, via) => {
            const receipt = via === 'sprite'
                ? { operationId: `sprite-click:${id}`, detail: '用户点了精灵气泡，非用户已读' }
                : { operationId: `web:${id}`, detail: '已从手机系统通知栏提示，非用户已读' };
            void Promise.resolve(postbox.deliveryReceipt({ id, channel: 'native', status: 'delivered', ...receipt })).then(unwrap).catch(() => { });
        });
        const mailStream = remote.$stream({ name: 'dot postbox', open: signal => postbox.watch(signal), ended: accepted => accepted ? new RemoteStreamCarrierError('dot postbox stream ended') : new Error('dot postbox stream did not open') });
        /*
         * 2026-10-26 主线02：记忆变化流。
         *
         * ▍为什么必须接（卡 §2-B 点名"接现有 memory.watch 前端刷新"）
         * 没有它，模型在对话里存/改/恢复了一条记忆，记忆空间仍显示旧快照；
         * 用户下次进记忆页看到的可能是已被纠正的旧版本——比不刷新更坏。
         *
         * ⚠️ 只在"记忆领域已经取过"时才刷新：没进过记忆页就别为它启动一次 Python 查询，
         *    那是首开提速已经确认过的教训（见 model.ts 铁律 4）。
         */
        const memoryStream = remote.$stream({
            name: 'dot memory',
            open: signal => memory.watch(signal),
            ended: accepted => accepted ? new RemoteStreamCarrierError('dot memory stream ended') : new Error('dot memory stream did not open'),
        });
        cleanups.push(() => follow.dispose(), () => mailStream.dispose(), () => memoryStream.dispose());
        void (async () => {
            try {
                for await (const item of follow) {
                    item.accept();
                    if (stopped)
                        break;
                    feed?.push(item.value); /* 只刷工作这一块。 */
                    if (model.hasDomain('work'))
                        void model.refreshDomain('work');
                }
            }
            catch (error) {
                if (!stopped) {
                    feed?.pushLost(error);
                    model.update({ error: String(error) });
                }
            }
        })();
        void (async () => {
            try {
                for await (const item of memoryStream) {
                    item.accept();
                    if (stopped)
                        break;
                    /* 记忆流只刷记忆本领域，且只在它已经取过时才刷（理由见上面 memoryStream 注释）。
                       历史面板若开着，也顺带重取——否则"恢复了一条"之后历史里还写着 archived。
                       ⚠️ 2026-10-27 记忆房下线后，记忆域不会再进入"已取过"状态（没有任何房间取它），
                       所以这里自然不会再发请求；保留分支是为了将来恢复那间房时不用重写这段。 */
                    if (model.hasDomain('memory')) {
                        void model.refreshDomain('memory');
                        if (model.getSnapshot().memoryHistory !== undefined)
                            void model.readHistory();
                    }
                }
            }
            catch (error) {
                if (!stopped)
                    model.update({ error: String(error) });
            }
        })();
        void (async () => {
            try {
                for await (const item of mailStream) {
                    item.accept();
                    if (stopped)
                        break;
                    /* 邮匣流只刷邮匣本领域；工作进度有自己的工作流。 */
                    if (model.hasDomain('postbox'))
                        void model.refreshDomain('postbox');
                    if (window.dotAndroid && document.visibilityState === 'hidden')
                        continue;
                    if (live) {
                        /* 工作事件和重要 / 紧急提醒归联动运行时管：在 DOT 里从精灵弹，不在 DOT 时走系统通知栏（用户定第 2 项 C）。
                           回执也由它在合适的时候记（用户定第 3 项 C）：点了精灵气泡才记，没点、自己收起的不记，下次打开 DOT 还会再弹。 */
                        const pending = unwrap(await postbox.pending({}));
                        const rest = pending.items.filter(event => !(window.dotAndroid && event.kind === 'reminder')).filter(event => !live.postbox({ id: event.id, kind: event.kind, severity: event.severity, title: event.title, body: event.body, workId: event.workId }));
                        if (document.visibilityState === 'hidden')
                            for (const event of rest) {
                                const shown = await showNotification({ id: event.id, title: event.title, body: event.body ?? '', ...(event.workId ? { workId: event.workId } : {}) }, () => { model.update({ noticeId: event.id }); if (event.workId)
                                    openCard(event.workId); });
                                if (shown)
                                    unwrap(await postbox.deliveryReceipt({ id: event.id, channel: 'native', status: 'delivered', operationId: `web:${event.id}` }));
                            }
                        else if (rest[0] && rest[0].kind !== 'reminder') {
                            /* 2026-10-30：前台不再弹底部通知条（用户要求彻底关掉），信已在星邮匣；回执照记，免得切到后台时把旧信再推一遍系统通知。 */
                            unwrap(await postbox.deliveryReceipt({ id: rest[0].id, channel: 'native', status: 'delivered', operationId: `foreground:${rest[0].id}`, detail: '前台不弹底部通知，信已进星邮匣，非用户已读' }));
                        }
                    }
                    else if (document.visibilityState === 'hidden') {
                        const pending = unwrap(await postbox.pending({}));
                        for (const event of pending.items) {
                            const shown = await showNotification({ id: event.id, title: event.title, body: event.body ?? '', ...(event.workId ? { workId: event.workId } : {}) }, () => { model.update({ noticeId: event.id }); if (event.workId)
                                openCard(event.workId); });
                            if (shown)
                                unwrap(await postbox.deliveryReceipt({ id: event.id, channel: 'native', status: 'delivered', operationId: `web:${event.id}` }));
                        }
                    }
                    else {
                        const pending = unwrap(await postbox.pending({}));
                        const event = pending.items[0];
                        if (event && event.kind !== 'reminder') {
                            /* 同上：前台不弹底部通知条。 */
                            unwrap(await postbox.deliveryReceipt({ id: event.id, channel: 'native', status: 'delivered', operationId: `foreground:${event.id}`, detail: '前台不弹底部通知，信已进星邮匣，非用户已读' }));
                        }
                    }
                }
            }
            catch (error) {
                if (!stopped)
                    model.update({ error: String(error) });
            }
        })();
    };
    void setup().catch(error => { if (!stopped)
        model.update({ error: String(error) }); });
    return async () => { stopped = true; for (const cleanup of cleanups.reverse())
        await cleanup(); };
}
