import { installGenui } from "./genui/install.js";
import { DotShell } from "./DotShell.js";
import { ANSWER_ONLY_CSS, HIDE_MESSAGE_ACTIONS, installMemoryRefScrubber } from "./answer-only.js";
import { TURN_STATUS_CSS, installTurnStatusDisplay, watchTurnStatus } from "./turn-status.js";
import { createDotViewStore, isRetiredSpace } from "./view-store.js";
import { DotLayout } from "./layout.js";
import { DotDataModel } from "./model.js";
import { zh } from "./locales.js";
import { createAstraChatCopy, ASTRA_CONNECTION_COPY, ASTRA_WAIT_CSS } from "./brand-copy.js";
import { recognizeSpeech, requestNotifications, showNotification } from "./platform.js";
import { installBusiness } from "./remote-adapter.js";
import { cssText } from './dot.module.css';
import { releaseChunkStyles } from "./chunks/styles.js";
// Lite 使用系统字体；保留样式变量供共享组件使用。
const dotFontCssText = ':root{--dot-font-heading:system-ui,sans-serif;--dot-font-accent:system-ui,sans-serif;--dot-font-body:system-ui,sans-serif;--dot-font-number:system-ui,sans-serif;--dot-font-code:monospace;--dot-size-body:16px;--dot-size-caption:14px;--dot-line-body:1.6;--dot-line-chat:1.6;}';
/* 各房间的 CSS Module 不再在这里首开挂载：它们跟随自己的按需块到达时才挂
   （见 entries/scene-*.ts 与 chunks/styles.ts）。这里只留壳、通知与对话工作卡。 */
import { VoiceButton } from "./VoiceButton.js";
import { watchProgressCards } from "./progress-cards.js";
import { observeRenderErrors } from "./render-diagnostics.js";
import { PersonalSettings, parseSettingIntent } from "./personal-settings.js";
import { installProviderDirectory } from "./provider-directory.js";
import { installSettingSubmission } from "./settings-submission.js";
import { NativeSettingsChrome } from "./NativeSettingsChrome.js";
import { nativeSettings } from "./native-settings.js";
import { createApiSettingsPort } from "./api-settings.js";
import { selectDotModel } from "./model-selection.js";
import { composerBusy, installSessionFollow, loadFollowState } from "./session-follow.js"; // hark-next-2026-10-27
import { createChainSource, installChainHistory, mergeChainRows, pickSingleSession, singleSessionBefore } from "./session-chain.js"; // hark-seamless-rollover-20261028
import { cssText as notifyCssText } from './notify/notify.module.css';
import { cssText as workCardsCssText } from './work-cards/work-cards.module.css';
import { cssText as liteCssText } from './lite/lite.module.css';
import { cssText as messagesCssText } from './lite/messages.module.css';
import { cssText as calendarTodoCssText } from './lite/calendar-todo.module.css';
import { cssText as workPageCssText } from './lite/work-page.module.css';
import { cssText as galleryCssText } from './gallery/gallery.module.css';
import { DotImageStack } from "./gallery/ImageStack.js";
import { createChainImageMounter } from "./chain-images.js"; // hark-reloadfix-20261101
import { FILE_CARD_CSS, installFileCardOpen } from "./files/file-card.js"; // sesame 文件附件 2026-11-01
import { DotLive } from "./notify/live-runtime.js";
import { WORK_TOOL_NAMES, createWorkToolView } from "./work-cards/WorkToolView.js";
import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { readUiMode } from "./lite/ui-mode.js";
import { clearLoginBoot } from "./lite/login-boot.js";
import { LITE_LOGO, LITE_NAME, liteIconUrl, liteRename, liteRenameCopy } from "./lite/lite-brand.js"; // lite-single-20261031
import { LiteWorkCard, viewOfCard } from "./lite/LiteWorkCard.js";
import { WorkCardActions } from "./lite/WorkCardActions.js";
import { MEMORY_CARD_TOOL_NAMES, MemoryToolView } from "./memory-cards/MemoryToolView.js";
import { CallEngine } from "./call/engine.js"; // dot-call-2026-10-27
import { installPersonaOnboarding } from "./persona/PersonaOnboarding.js"; // dot-persona-2026-10-27
import { installDotName } from "./persona/dot-name.js"; // dot-name-2026-10-27
import { loadPersona } from "./persona/persona-api.js";
export const inject = ['slots', 'locale'];
/* 注册器共用一个视图实例，业务模型则由原生 Remote 生命周期持有。 */
export function apply(ctx) {
    installGenui(ctx); // inline-only; upstream full client must not be loaded
    ctx.effect(observeRenderErrors, 'dot: 渲染故障探针');
    /* 简洁版（?ui=lite）：给用户看的「ASTRA」一律换成 lite-brand.ts 的 LITE_NAME；经典版原样。 */
    const liteMode = readUiMode() === 'lite';
    // Classic keeps its existing boot UX; discard the hint so switching to lite cannot replay it.
    if (!liteMode)
        clearLoginBoot();
    const named = (copy) => liteMode ? liteRenameCopy(copy) : copy;
    const dotCopy = named(zh);
    ctx.effect(() => ctx.locale.register('dot', { zh: dotCopy, en: dotCopy }), 'dot: 中文文案');
    ctx.inject(['uiConversation'], scope => scope.effect(() => {
        const previous = scope.locale.getSnapshot().active;
        const removeLanguage = scope.locale.addLanguage({ id: 'zh-Hans-x-dot', label: liteMode ? liteRename('中文 · ASTRA') : '中文 · ASTRA', fallback: 'zh' });
        /* 输入框占位：经典版保持 ASTRA（dot-name 会换成本户名字）；简洁版读本户在设置里定的助手名，
           改名后（persona-api 发 dot-persona:changed）就地换掉，不再写死 LITE_NAME（2026-11-01）。
           同一命名空间同一语言只能注册一份，所以换名是整份 conversation 文案撤掉重注册。 */
        const conversationCopy = (placeholderName) => ({
            ...named({ 'placeholder.hero': '和 ASTRA 说点什么……', 'placeholder.default': '和 ASTRA 说点什么……', 'hero.headline': 'ASTRA 在这里', 'hero.preview': '个人 DOT' }),
            /* 名字还不知道（新设备没缓存、人设还没读到或读失败）时不带名字，免得先闪一下产品名；
               原生输入框的 aria-label 与占位同源，两处一起变（2026-11-01 sesame）。 */
            ...(liteMode ? { 'placeholder.hero': litePlaceholder(placeholderName), 'placeholder.default': litePlaceholder(placeholderName) } : {}),
        });
        let placeholderName = liteMode ? readCachedAssistantName() : '';
        let removeConversation = scope.locale.register('conversation', 'zh-Hans-x-dot', conversationCopy(placeholderName));
        const removeCopy = () => removeConversation();
        let placeholderAlive = true;
        const setPlaceholderName = (value) => {
            const name = (typeof value === 'string' ? value.trim() : '') || LITE_NAME;
            if (!liteMode || !placeholderAlive || name === placeholderName)
                return;
            placeholderName = name;
            removeConversation();
            removeConversation = scope.locale.register('conversation', 'zh-Hans-x-dot', conversationCopy(name));
        };
        const onPersonaChanged = (event) => { const name = event.detail?.name; cacheAssistantName(name); setPlaceholderName(name); };
        if (liteMode) {
            loadPersona().then(view => { cacheAssistantName(view.profile.name); setPlaceholderName(view.profile.name); }).catch(() => { });
            window.addEventListener('dot-persona:changed', onPersonaChanged);
        }
        const removeChat = scope.locale.register('chat', 'zh-Hans-x-dot', named(createAstraChatCopy()));
        const removeConnection = scope.locale.register('settings', 'zh-Hans-x-dot', named(ASTRA_CONNECTION_COPY));
        const removeAccount = scope.locale.register('settings.account', 'zh-Hans-x-dot', named({
            onboardingBrand: 'XTCausal DOT · ASTRA',
            onboardingIntroduction: 'ASTRA 是你的私人秘书，帮你记事、整理资料和处理日常事务。文件与记忆使用当前DOT服务保存。',
            onboardingCreditDescription: '模型与工具的费用由你选择的服务商计费，实际额度请查看对应服务商。',
            onboardingProcessDescription: '这里只调整过程展示，不改变ASTRA的能力。',
            onboardingNoCreditDescription: '当前账号服务没有可用额度时，相关模型暂不可用；其他API连接按各自配置使用。',
        }));
        scope.locale.setLocale('zh-Hans-x-dot');
        return () => { placeholderAlive = false; window.removeEventListener('dot-persona:changed', onPersonaChanged); scope.locale.setLocale(previous); removeAccount(); removeConnection(); removeChat(); removeCopy(); removeLanguage(); };
    }, 'dot: 官方语言包接入助理文案'));
    /* 共享组件通过这些变量使用系统字体。 */
    ctx.effect(() => {
        const style = document.createElement('style');
        style.dataset.dotCss = '@xtcausal/dot-ui-shell/fonts';
        style.textContent = dotFontCssText;
        document.head.appendChild(style);
        return () => { style.remove(); };
    }, 'dot: 全局字体');
    ctx.effect(() => {
        const style = document.createElement('style');
        style.dataset.dotCss = '@xtcausal/dot-ui-shell';
        style.textContent = `${cssText}\n${ASTRA_WAIT_CSS}\n${ANSWER_ONLY_CSS}\n${HIDE_MESSAGE_ACTIONS}\n${TURN_STATUS_CSS}`;
        document.head.appendChild(style);
        return () => style.remove();
    }, 'dot: 可卸载样式');
    /* 2026-10-27：对话里只显示最终回答；回答里的 [m:条目id] 记忆标注只在界面上去掉。 */
    ctx.effect(() => installMemoryRefScrubber(), 'dot: 去掉回答里的记忆编号');
    /* 简洁版：运行行不再带「···」打字点，改由简洁版样式里的呼吸点表示「在干活」（2026-11-01）。 */
    ctx.effect(() => installTurnStatusDisplay(document, { dots: !liteMode }), 'dot: 对话进度状态行');
    ctx.effect(() => installPersonaOnboarding(), 'dot: 新账号引导页'); // dot-persona-2026-10-27
    ctx.effect(() => installDotName(liteMode ? LITE_NAME : undefined), 'dot: 界面名字跟账号的 DOT 名称走（简洁版固定 LITE_NAME）'); // dot-name-2026-10-27
    /* 简洁版的标签页图标：lite-brand.ts 的 LITE_ICON 不空才换；空的时候沿用服务端那枚。
       2026-11-01：标签页用 32px 的品牌 favicon（顶栏图标位才用 64px）。 */
    if (liteMode)
        ctx.effect(() => {
            const url = liteIconUrl() ? liteIconUrl(LITE_LOGO.favicon32) : null;
            if (!url)
                return () => { };
            const links = [...document.querySelectorAll('link[rel~="icon"]')];
            const saved = links.map(link => link.href);
            const own = document.createElement('link');
            own.rel = 'icon';
            own.href = url;
            own.dataset.liteBrandIcon = '';
            links.forEach(link => { link.href = url; });
            if (!links.length)
                document.head.appendChild(own);
            return () => { links.forEach((link, i) => { link.href = saved[i]; }); own.remove(); };
        }, 'dot: 简洁版标签页图标');
    ctx.effect(() => {
        const title = document.title;
        document.title = liteMode ? LITE_NAME : 'XTCausal DOT · ASTRA';
        /* 原生布局主题插件已停用，DOT必须自己声明深色主题；否则代码和菜单仍是白底暖白字。 */
        const dark = document.body.hasAttribute('data-ds-dark-theme');
        document.body.setAttribute('data-ds-dark-theme', '');
        return () => { document.title = title; if (!dark)
            document.body.removeAttribute('data-ds-dark-theme'); };
    }, 'dot: 页面标题');
    /* 精灵气泡和对话小卡的样式各开一个标签，理由同上。 */
    ctx.effect(() => {
        const style = document.createElement('style');
        style.dataset.dotCss = '@xtcausal/dot-ui-shell/notify';
        style.textContent = `${notifyCssText}\n${workCardsCssText}`;
        document.head.appendChild(style);
        return () => style.remove();
    }, 'dot: 精灵气泡与对话工作卡样式');
    /* 简洁版（?ui=lite）自己的样式单独一个标签；经典版不插，一个字节都不多。 */
    ctx.effect(() => {
        if (readUiMode() !== 'lite')
            return () => { };
        const style = document.createElement('style');
        style.dataset.dotCss = '@xtcausal/dot-ui-shell/lite';
        style.textContent = [liteCssText, messagesCssText, calendarTodoCssText, workPageCssText].join("\n");
        document.head.appendChild(style);
        return () => style.remove();
    }, 'dot: 简洁版样式');
    const handle = createDotViewStore();
    const instance = handle.create();
    const store = { ...handle, create: () => instance };
    const personal = new PersonalSettings(localStorage, { reducedMotion: instance.getSnapshot().reducedMotion, spriteEdge: instance.getSnapshot().sprite.edge });
    /* 旧版保存的弹层不是业务事实，刷新不能自动把菜单锁在不可见的内层。 */
    instance.actions.settings(null);
    const syncPersonal = () => {
        const value = personal.getSnapshot().value;
        instance.actions.motion(value.reducedMotion);
        const current = instance.getSnapshot();
        if (current.sprite.edge !== value.spriteEdge)
            instance.actions.dock(value.spriteEdge, current.sprite.y);
        if (!current.homeSprite || current.homeSprite.edge !== value.spriteEdge)
            instance.actions.dockHome(value.spriteEdge, current.homeSprite?.y ?? .59);
        if (!value.idleShrink)
            instance.actions.shrink(false);
        document.documentElement.style.setProperty('--dot-font-scale', String(value.fontScale / 100));
        document.documentElement.style.setProperty('--dot-glass-opacity', String(value.glassOpacity / 100));
        document.documentElement.style.setProperty('--dot-sprite-scale', String(value.spriteScale / 100));
        document.documentElement.dataset.dotStateFeedback = String(value.stateFeedback);
        document.documentElement.dataset.dotCardMotion = String(value.cardMotion);
    };
    ctx.effect(() => { syncPersonal(); const stop = personal.subscribe(syncPersonal); const storage = (event) => personal.receive(event.key, event.newValue); window.addEventListener('storage', storage); return () => { stop(); window.removeEventListener('storage', storage); }; }, 'dot: 当前设备偏好');
    const layout = new DotLayout(space => instance.actions.navigate(space), () => instance.actions.menu(true), panel => instance.actions.nativePanel(panel), shown => instance.actions.rightbar(shown));
    ctx.effect(() => ctx.reflect.provide('layout', layout), 'dot: 原生布局服务');
    ctx.effect(() => () => layout.dispose(), 'dot: 布局释放');
    ctx.slots.provideRoot({ hooks: { panelInfo: layout.panelInfo } });
    let port = {
        load: async () => { throw new Error('原生业务连接尚未就绪'); },
        search: async () => { throw new Error('记忆服务尚未就绪'); },
        command: async () => { throw new Error('原生业务连接尚未就绪'); },
    };
    const model = new DotDataModel({ load: () => port.load(), search: query => port.search(query), command: (action, value) => port.command(action, value) });
    ctx.effect(() => () => model.dispose(), 'dot: 显示快照释放');
    /* 当前空间与打开的临时卡直接告诉模型：进哪间房才取哪块数据，开哪张卡才读成果正文。
       ⚠️ 这里只是视图→数据的单向通知，不参与按需块装载：块没到也要先把当前空间的数据挂上，
       否则记忆/能力页面会等到块下载完才开始取数。 */
    ctx.effect(() => {
        /* ⚠️ 2026-10-27 记忆房下线后的存档兜底：store 会把"上次停在哪一间"持久化，
           老存档里可能就是 memory——那间房的入口已经撤了，不纠正就会把人送进一个
           没有返回路径、也没有入口可回的孤岛。发现就送回书房，并把历史里残留的
           memory 一并清掉（否则按返回键又会退回去）。 */
        /* 2026-10-27：能力空间同样删除，老存档停在 capabilities 也一样送回书房。 */
        const retireMemorySpace = () => {
            if (!isRetiredSpace(instance.getSnapshot().space))
                return;
            instance.actions.navigate('study');
        };
        retireMemorySpace();
        const apply = () => {
            const state = instance.getSnapshot();
            model.setSpace(state.space);
            model.setOpenWork(state.card);
        };
        apply();
        const unsubscribe = instance.subscribe(() => { retireMemorySpace(); apply(); });
        return unsubscribe;
    }, 'dot: 当前空间与打开的工作卡');
    /* 插件卸载时清掉按需块挂上的样式；房间没进过的块本来就没有标签。 */
    ctx.effect(() => () => releaseChunkStyles(), 'dot: 按需块样式释放');
    /* 联动运行时：工作全局状态（推送优先、轮询兜底）、通知分发、精灵气泡、确认桥接。 */
    /* 用户定第 2 项 C：不在 DOT 时走手机系统通知栏（安卓壳 / 网页通知），在 DOT 里从精灵弹。 */
    const live = new DotLive({ system: showNotification });
    ctx.effect(() => () => live.dispose(), 'dot: 联动运行时释放');
    /* dot-call-2026-10-27 打电话模式：引擎全局一份，通话层挂在 DotShell 上；发进会话的函数等会话服务就绪后接上。 */
    let callTurn;
    const call = new CallEngine((text, hooks) => callTurn ? callTurn(text, hooks) : Promise.reject(new Error('对话还没连上，稍等再说一遍')));
    ctx.effect(() => () => call.hangup(), 'dot: 通话随页面卸载挂断');
    const navigate = (space) => {
        layout.selectPanel((space === 'conversation' ? null : `dot.${space}`));
        history.pushState({ dotSpace: space }, '', location.href);
    };
    const native = nativeSettings(ctx);
    /* 对话小卡 / 气泡 → 工作空间对应大卡：清筛选、对准这张卡；返回键回到原来的空间。 */
    const revealWork = (id) => {
        const from = instance.getSnapshot().space;
        instance.actions.revealWork(id);
        /* 简洁版详情由 card 驱动，focus 只对经典版工作画布有效。 */
        if (liteMode)
            instance.actions.openCard(id);
        layout.selectPanel('dot.work');
        if (from !== 'work')
            history.pushState({ dotSpace: 'work' }, '', location.href);
    };
    live.setNavigation({
        openWork: revealWork,
        openPostbox: id => { navigate('postbox'); if (id)
            model.update({ noticeId: id }); },
    });
    const back = () => {
        if (native.close())
            return;
        /* 工作详情占一层浏览器记录：先收详情，不能让外层导航把整间工作室一起退掉。 */
        if (instance.getSnapshot().space === 'work' && history.state?.dotWorkspaceDetail) {
            history.back();
            return;
        }
        const before = instance.getSnapshot();
        instance.actions.back();
        if (before.settings || before.orbitMenu || before.menu || before.card || before.rightbar)
            return;
        const state = instance.getSnapshot();
        layout.selectPanel((state.space === 'conversation' ? null : `dot.${state.space}`));
    };
    /* 当前设备的明确设置指令在本机执行并回实际值，不发付费模型，也不广播到别的设备。 */
    const handleSettingText = async (text) => {
        const intent = parseSettingIntent(text, personal.getSnapshot().value);
        if (!intent)
            return false;
        if (intent.kind === 'unavailable') {
            personal.notify(intent.message);
            return true;
        }
        if (intent.kind === 'local') {
            personal.change(intent.patch);
            const value = personal.getSnapshot().value;
            const labels = Object.keys(intent.patch).map(key => key === 'spriteScale' ? `精灵 ${value.spriteScale}%` : key === 'spriteEdge' ? `停靠${value.spriteEdge === 'left' ? '左' : '右'}侧` : key === 'fontScale' ? `字体 ${value.fontScale}%` : key === 'glassOpacity' ? `玻璃浓度 ${value.glassOpacity}%` : `动态效果${value.reducedMotion ? '减少' : '恢复'}`);
            personal.notify(`这台设备已调整：${labels.join('，')}。其他设备不变。`);
            return true;
        }
        if (intent.kind === 'undo') {
            await personal.undoLast();
            return true;
        }
        const before = model.getSnapshot().reminderSettings?.preferences;
        await model.command('settings.reminders', intent.kind === 'dnd' ? { until: intent.until } : { category: intent.category, enabled: intent.enabled });
        const after = model.getSnapshot().reminderSettings?.preferences;
        if (before && after)
            personal.offerServerUndo(async () => { await model.command('settings.reminders', { restore: before, expected: after }); });
        personal.notify(intent.kind === 'dnd' ? intent.until ? `当前 DOT 免打扰至 ${new Date(intent.until).toLocaleString()}，信仍进星邮匣。` : '已关闭当前 DOT 的免打扰。' : `${intent.category === 'completed' ? '任务完成' : intent.category === 'failed' ? '任务失败' : '需要确认'}主动提醒已${intent.enabled ? '开启' : '关闭'}，信仍进星邮匣。`);
        return true;
    };
    let quickSend = async () => { throw new Error('对话尚未连接'); };
    let openSession = (_id) => { throw new Error('对话尚未连接'); };
    let newConversation = async () => { throw new Error('对话尚未连接'); };
    let apiPort;
    const apiSettings = {
        load: async () => { if (!apiPort)
            throw new Error('API设置尚未连接'); return apiPort.load(); },
        create: async (provider) => { if (!apiPort)
            throw new Error('API设置尚未连接'); return apiPort.create(provider); },
        save: async (input) => { if (!apiPort)
            throw new Error('API设置尚未连接'); return apiPort.save(input); },
        discover: async (input) => { if (!apiPort)
            throw new Error('API设置尚未连接'); return apiPort.discover(input); },
    };
    let selectModel = async (_provider, _model) => { throw new Error('模型目录尚未连接'); };
    /* dsh-im 只装在单个账号的实例上：有这个服务才在简洁版设置里露出「微信」入口。 */
    let imService = null;
    const imListeners = new Set();
    const imClient = {
        subscribe: listener => { imListeners.add(listener); return () => { imListeners.delete(listener); }; },
        getSnapshot: () => imService,
    };
    ctx.inject(['dshImClient'], scope => scope.effect(() => {
        imService = scope.dshImClient ?? null;
        for (const listener of imListeners)
            listener();
        return () => { imService = null; for (const listener of imListeners)
            listener(); };
    }, 'dot: dsh-im 微信入口'));
    ctx.slots.register({
        name: 'root', locale: 'dot', store,
        children: {
            main: { kind: 'keyed', scope: 'root' }, sidebar: { kind: 'single', scope: 'root' },
            rightbar: { kind: 'single', scope: 'root' }, 'sidebar.settings': { kind: 'single', scope: 'root' }, 'shell.bottom': { kind: 'single', scope: 'root' },
            'shell.overlay': { kind: 'list', scope: 'root' }, 'shell.leading': { kind: 'single', scope: 'root' },
        },
        inject: () => ({
            hooks: { dotData: model }, personalSettings: personal, apiSettings, imClient, nativeSettingsOpen: native.isOpen, readData: model.getSnapshot, navigate, back,
            refresh: () => model.refresh(), search: query => model.search(query),
            readWorkArtifacts: id => model.setOpenWork(id),
            /* 简洁版「我的」页按需取能力状态（含 XTMEM）：能力 / 记忆空间下线后没人再取它，设置里才一直「状态尚未取得」。 */
            loadDomain: domain => model.refreshDomain(domain),
            /* 历史查询按需取：不进首屏、不进正常召回，只在记忆空间点"历史"时发一次。 */
            readHistory: (query, project) => model.readHistory(query, project),
            command: async (action, value) => {
                if (action === 'settings.models') {
                    instance.actions.settings('models');
                    return;
                }
                if (action === 'model.select') {
                    await selectModel(String(value?.provider ?? ''), String(value?.model ?? ''));
                    return;
                }
                if (action === 'plugins.open' || action === 'settings.native') {
                    native.open('plugins');
                    return;
                }
                if (action === 'settings.quick') {
                    instance.actions.settings('quick');
                    return;
                }
                if (action === 'notice.dismiss') {
                    model.update({ noticeId: null });
                    return;
                }
                if (action === 'notifications.enable') {
                    await requestNotifications();
                    return;
                }
                if (action === 'connection.configure') {
                    if (window.dotAndroid)
                        await window.dotAndroid.configureConnection();
                    else {
                        const address = prompt('输入你自己的 DOT 服务完整地址', location.origin);
                        if (address) {
                            const url = new URL(address);
                            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
                                throw new Error('需要 HTTP/HTTPS 服务地址');
                            location.assign(url.href);
                        }
                    }
                    return;
                }
                await model.command(action, value);
            },
            quickSend: async (text) => { if (!await handleSettingText(text))
                await quickSend(text); }, startVoice: recognizeSpeech,
            openSession: (id) => openSession(id), newConversation: () => newConversation(), live, call,
        }),
    }, DotShell);
    ctx.slots.inject('settings.header', () => ctx.slots.register({ name: 'settings.header', priority: -50 }, NativeSettingsChrome));
    ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
        name: 'conversation.input.left', id: 'dot.voice', locale: 'dot',
        inject: () => ({ recognize: recognizeSpeech }),
    }, VoiceButton));
    /* ASTRA 在对话里调工作工具时，原生聊天的工具格换成工作小卡（工作空间主卡的缩小版），点了跳到大卡。
       tool.call.toolview 由 ui-tool 声明，本包不直接依赖它的类型，所以这里按名字注册。 */
    /* 简洁版：对话里的工作小卡下面直接长出确认 / 拒绝 / 去填写（经典版不传，小卡不变）。 */
    let chooseCandidate;
    ctx.inject(['remote', 'remote.dotWork'], scope => scope.effect(() => {
        chooseCandidate = async (ticket, readOnly = false) => {
            const result = await scope.remote.dotWork.confirmCandidate({ ticket, readOnly });
            if (!result.ok)
                throw new Error(result.error.message);
            return result.value;
        };
        return () => { chooseCandidate = undefined; };
    }, 'dot: 确认工单候选'));
    const WorkToolView = createWorkToolView({
        store: live.store, open: revealWork,
        choose: (ticket, readOnly) => chooseCandidate ? chooseCandidate(ticket, readOnly) : Promise.reject(new Error('尚未连接')),
        ...(readUiMode() === 'lite' ? { renderCard: (card, now) => createElement(LiteWorkCard, {
                view: viewOfCard(card), now, inline: true, onOpen: revealWork,
                actions: createElement(WorkCardActions, { card, approvals: live.approvals, onOpen: revealWork, command: (action, value) => model.command(action, value) }),
            }) } : {}),
    });
    const looseSlots = ctx.slots;
    /* 2026-11-01 S3：简洁版的消息图片改成 DOT 图集（一张原尺寸 / 两张错开 / 三张以上扇形 → 网格总览 → 全屏左右滑）。
       优先级 -50 压过原生（100）；缩略图模式组件内部交还原生。经典版不换。 */
    if (liteMode) {
        ctx.effect(() => {
            const style = document.createElement('style');
            style.dataset.dotCss = '@xtcausal/dot-ui-shell/gallery';
            style.textContent = galleryCssText;
            document.head.appendChild(style);
            return () => style.remove();
        }, 'dot: 简洁版图集样式');
        /* 2026-11-01 sesame：普通文件卡片按新色卡画（白卡 + 浅色图标底），跟图片缩略图框区分开。 */
        ctx.effect(() => {
            const style = document.createElement('style');
            style.dataset.dotCss = '@xtcausal/dot-ui-shell/file-card';
            style.textContent = FILE_CARD_CSS;
            document.head.appendChild(style);
            return () => style.remove();
        }, 'dot: 简洁版文件卡片样式');
        for (const name of ['conversation.chat.user.images', 'conversation.chat.message.images']) {
            const slots = ctx.slots;
            slots.inject(name, () => slots.register({ name, priority: -50 }, DotImageStack));
        }
    }
    /* 文件卡片点开：能预览的新开标签页，其余下载（经典版、简洁版都装）。 */
    ctx.effect(() => installFileCardOpen(document), 'dot: 文件卡片预览与下载');
    for (const toolName of WORK_TOOL_NAMES)
        looseSlots.inject('tool.call.toolview', () => looseSlots.register({ name: 'tool.call.toolview', key: toolName, locale: 'dot' }, WorkToolView));
    /* 2026-10-27：ASTRA 检索 XTMEM 时，工具格画成记忆卡（替代独立记忆空间）。 */
    for (const toolName of MEMORY_CARD_TOOL_NAMES)
        looseSlots.inject('tool.call.toolview', () => looseSlots.register({ name: 'tool.call.toolview', key: toolName, locale: 'dot' }, MemoryToolView));
    ctx.inject(['conversation'], scope => scope.effect(() => {
        try {
            return installSettingSubmission(scope.conversation, handleSettingText);
        }
        catch (error) {
            personal.notify(String(error));
            return () => { };
        }
    }, 'dot: 普通设置指令回到发起设备'));
    ctx.inject(['remote', 'remote.llm', 'remote.session', 'configForms'], scope => scope.effect(() => installProviderDirectory(scope, model), 'dot: 原生模型目录'));
    ctx.inject(['remote', 'remote.llm', 'remote.settings', 'remote.credentials', 'configForms'], scope => scope.effect(() => {
        const own = createApiSettingsPort(scope);
        apiPort = own;
        return () => { if (apiPort === own)
            apiPort = undefined; };
    }, 'dot: 自有API表单复用原生配置与密钥服务'));
    ctx.inject(['remote', 'remote.session', 'sessions', 'workspaces', 'uiWorkspace', 'uiSession', 'connection'], scope => {
        const { sessions, workspaces, uiWorkspace, uiSession } = scope;
        const connection = scope.get('connection');
        openSession = id => uiWorkspace.openSession(id);
        const createConversation = async () => {
            const existing = workspaces.list.getSnapshot().items;
            const workspace = await workspaces.initializeDefault() ?? (existing.length === 1 ? existing[0] : undefined);
            if (!workspace)
                throw new Error('DOT默认工作目录尚未确定；现有多个目录不会被自动合并或迁移');
            const id = await sessions.create({ workspaceId: workspace.workspaceId, agentPreset: 'astra' });
            uiWorkspace.openSession(id);
            return id;
        };
        newConversation = async () => { await createConversation(); navigate('conversation'); };
        selectModel = async (provider, selectedModel) => {
            const name = await selectDotModel({
                rows: () => model.getSnapshot().providers ?? [], busy: () => model.getSnapshot().busy,
                session: async () => sessions.list.getSnapshot().ids.find(id => (sessions.retainInfo(id).getSnapshot().retainedBy.mainView ?? 0) > 0) ?? await createConversation(),
                select: input => scope.remote.session.selectModel({ ...input, sessionId: input.sessionId }),
                selected: (providerId, modelId) => model.update({ providers: (model.getSnapshot().providers ?? []).map(row => ({ ...row, models: row.models.map(item => ({ ...item, selected: row.id === providerId && item.id === modelId })) })) }),
            }, provider, selectedModel);
            personal.notify(`已切换到 ${name}`);
        };
        /* hark-seamless-rollover-20261028：闲置换会话对前端无感——历史里一条换会话链只显示一条（点开最新那个、用最早的真标题），
           对话页在当前会话上方拼上链上前面会话的原话（只读）。链来自 /dot-session/api/current，原话走原生 session/page。 */
        let followState = null;
        let updateHistory = () => { };
        let chainView;
        /* lite-single-20261031：简洁版只有一个对话界面——本账号所有主会话（非子工作、非空）的摘要。 */
        const mainBriefs = () => {
            const catalog = sessions.list.getSnapshot();
            return catalog.ids.flatMap(id => { const row = catalog.byId[id]; return row && row.origin !== 'subagent' ? [{ id, updatedAt: row.updatedAt, ...(row.blank === true ? { blank: true } : {}) }] : []; });
        };
        const chain = createChainSource({
            page: ((request) => scope.remote.session.page(request)),
            load: () => loadFollowState(),
            /* 简洁版：当前会话上方拼的是其余所有主会话（按时间），不只换会话链；经典版不给，照旧只拼链。 */
            ...(liteMode ? { before: (id) => singleSessionBefore(id, mainBriefs()) } : {}),
        });
        const loadFollow = async () => {
            const next = await loadFollowState();
            if (next && JSON.stringify(next.rollovers) !== JSON.stringify(followState?.rollovers ?? null)) {
                const first = followState === null;
                followState = next;
                chain.setState(next);
                updateHistory();
                if (!first)
                    chainView?.refresh();
            }
            return next;
        };
        scope.effect(() => {
            const update = () => { const catalog = sessions.list.getSnapshot(); model.update({ sessions: mergeChainRows(catalog.ids.flatMap(id => { const row = catalog.byId[id]; return row && row.origin !== 'subagent' ? [{ id, title: row.displayTitle, ...(row.blank === true ? { blank: true } : {}) }] : []; }), followState).map(({ id, title }) => ({ id, title })) }); };
            updateHistory = update;
            update();
            void loadFollow().catch(() => null);
            const off = sessions.list.subscribe(update);
            return () => { off(); updateHistory = () => { }; };
        }, 'dot: 原生历史入口');
        scope.effect(() => {
            const view = installChainHistory({
                rowsFor: id => chain.rowsFor(id),
                mountWork(host, meta) {
                    const root = createRoot(host);
                    root.render(createElement(WorkToolView, { history: meta }));
                    return () => root.unmount();
                },
                /* 简洁版的对话区没有经典版那个 aria-label="对话空间" 的 section，原来的选择器找不到滚动区，
                   前文从来没拼上——这就是上次「从抽屉点开历史对话不显示内容」（打开的是闲置换出来的空会话）。 */
                ...(liteMode ? { scrollSelector: '[data-page="chat"] [data-conversation-scroll]' } : {}),
                /* hark-reloadfix-20261101：前文里用户发的图片按来源会话走原生 session/attachment 取回，画成 DOT 图集（以前写成〔图片〕）。
                   经典版没有 DOT 图集样式，照旧占位。 */
                ...(liteMode ? { mountImages: createChainImageMounter(((request) => scope.remote.session.attachment(request))) } : {}),
                trace: info => { window.__dotSessionChain = info; },
            });
            chainView = view;
            return () => { view.stop(); if (chainView === view)
                chainView = undefined; };
        }, 'dot: 换会话链前文拼接');
        /* hark-next-2026-10-27：服务端闲置换出新会话后，正看着旧会话的网页跟过去。
           信号是本实例 /dot-session/api/current（不按标题猜）；目录变化/回到前台/点输入框/前台每 60 秒问一次；输入框有字时不切。
           hark-seamless-rollover-20261028：不再弹提示；切过去后上方由“换会话链前文拼接”接上旧会话原话。 */
        scope.effect(() => installSessionFollow({
            ids: () => sessions.list.getSnapshot().ids,
            subscribe: listener => sessions.list.subscribe(listener),
            viewed: () => sessions.list.getSnapshot().ids.find(id => (sessions.retainInfo(id).getSnapshot().retainedBy.mainView ?? 0) > 0),
            open: async (id) => {
                /* 先把前文取好再切（切过去时上面马上就是刚才的对话，不闪空白页）；取不到也照切。 */
                await chain.rowsFor(id).catch(() => []);
                /* 服务端建的会话不会推进已打开网页的目录；目录里没有就先整表刷新，否则 openSession 静默失败。 */
                if (!sessions.list.getSnapshot().ids.includes(id))
                    await sessions.refresh();
                uiWorkspace.openSession(id);
            },
            load: () => loadFollow(),
            draftBusy: () => composerBusy(),
            /* hark-seamless-rollover-20261028：跟随不再弹提示——前端看不出换了会话。 */
            storage: (() => { try {
                return localStorage;
            }
            catch {
                return null;
            } })(),
            trace: info => { window.__dotSessionFollow = info; },
            onVisible: listener => {
                const handler = () => { if (document.visibilityState === 'visible')
                    listener(); };
                document.addEventListener('visibilitychange', handler);
                return () => document.removeEventListener('visibilitychange', handler);
            },
            onComposerFocus: listener => {
                const handler = (event) => { if (event.target instanceof Element && event.target.closest('[data-composer-card]'))
                    listener(); };
                document.addEventListener('focusin', handler);
                return () => document.removeEventListener('focusin', handler);
            },
            visible: () => document.visibilityState === 'visible',
        }), 'dot: 闲置换新会话跟随');
        /* lite-single-20261031：简洁版只有一个对话界面。打开时直接进「那一个」会话（pickSingleSession：服务端当前会话，
           或最近有消息的那个），不落到原生的欢迎页 / 某个旧的空会话上；上方由前文拼接接上其余会话。之后的换会话交给上面的跟随。 */
        if (liteMode)
            scope.effect(() => {
                let stopped = false;
                let settled = false;
                const viewed = () => sessions.list.getSnapshot().ids.find(id => (sessions.retainInfo(id).getSnapshot().retainedBy.mainView ?? 0) > 0);
                const trace = (info) => { window.__dotLiteSingle = { ...info, at: Date.now() }; };
                const settle = async (round) => {
                    if (stopped)
                        return;
                    const state = await loadFollow().catch(() => null) ?? followState;
                    const target = pickSingleSession(mainBriefs(), state);
                    const before = viewed();
                    trace({ round, target: target ?? null, viewed: before ?? null, current: state?.current ?? null });
                    if (stopped || !target || before === target || composerBusy())
                        return;
                    await chain.rowsFor(target).catch(() => []);
                    if (stopped)
                        return;
                    if (!sessions.list.getSnapshot().ids.includes(target))
                        await sessions.refresh();
                    uiWorkspace.openSession(target);
                    trace({ round, target, viewed: before ?? null, opened: true, current: state?.current ?? null });
                };
                const timers = [];
                const check = () => {
                    if (settled || stopped || sessions.list.getSnapshot().phase !== 'ready')
                        return;
                    settled = true;
                    void settle(1).catch(() => { });
                    /* 原生可能稍后才恢复上次看过的会话，覆盖掉刚打开的；过一会儿再对一次。
                       hark-reloadfix-20261101：手机冷启动（App 被杀后重开）比电脑慢得多，原生恢复可能晚于 2.5 秒；
                       落在旧会话上时，比它新的会话会被拼到它「上方」，最新消息就跑到中间去了。所以 6 秒、12 秒再各对一次（对上了就什么都不做）。 */
                    for (const [round, ms] of [[2, 2500], [3, 6000], [4, 12000]])
                        timers.push(setTimeout(() => { void settle(round).catch(() => { }); }, ms));
                };
                const off = sessions.list.subscribe(check);
                check();
                return () => { stopped = true; off(); for (const t of timers)
                    clearTimeout(t); };
            }, 'dot: 简洁版只留一个会话');
        quickSend = async (text) => {
            let id = sessions.list.getSnapshot().ids.find(id => (sessions.retainInfo(id).getSnapshot().retainedBy.mainView ?? 0) > 0);
            if (!id)
                id = await createConversation();
            uiWorkspace.openSession(id);
            await sessions.using(id, { source: 'controllerOperation' }, async (reference) => {
                await reference.ready;
                const result = await reference.binding.session.prompt([{ type: 'text', text }], 'queue');
                if (!result.ok)
                    throw new Error(`${result.error.code}: ${result.error.message}`);
            });
        };
        /* dot-call-2026-10-27 电话里的一句话：发进当前对话，边接 ASTRA 的流式文字边交给通话引擎念；
           插话（打电话时开口、按键说话时再按）不取消这一轮：新话用 steer 插进当前回合，不经过要二次确认的停止。 */
        callTurn = async (text, hooks) => {
            let id = sessions.list.getSnapshot().ids.find(id => (sessions.retainInfo(id).getSnapshot().retainedBy.mainView ?? 0) > 0);
            if (!id)
                id = await createConversation();
            uiWorkspace.openSession(id);
            const sessionId = id;
            const running = () => uiSession.sessionStatus.getSnapshot().get(sessionId)?.running === true;
            await sessions.using(sessionId, { source: 'controllerOperation' }, async (reference) => {
                await reference.ready;
                const events = reference.binding.eventSource;
                /* 只念这句话之后的回复：等这条消息真正落进对话记录（steer 时是上一步跑完、它被插进去的那一刻），再开始收字。 */
                const probe = text.slice(0, 24);
                let full = '', submitted = false, landed = false, sawRunning = false, settled = false;
                let stepText = '', stepLive = false;
                const flushStep = () => { if (!stepText)
                    return; const piece = stepText; stepText = ''; full += piece; hooks.onDelta(piece); };
                let finish = () => { };
                const done = new Promise(resolve => { finish = () => { if (!settled) {
                    settled = true;
                    resolve();
                } }; });
                let revision = events.getSnapshot().revision;
                const offEvents = events.subscribe(() => {
                    const win = events.getSnapshot();
                    if (win.revision === revision)
                        return;
                    revision = win.revision;
                    if (!submitted || hooks.signal.aborted || win.change.kind !== 'append')
                        return;
                    for (const entry of win.change.entries ?? []) {
                        if (entry.type !== 'transient') {
                            if (!landed && JSON.stringify(entry.event?.data ?? '').includes(probe))
                                landed = true;
                            continue;
                        }
                        const chunk = landed ? entry.event?.data?.chunk : undefined;
                        /* 2026-10-27：只念最终回答。一步里的字先攒着：这一步后面跟了工具调用，就是过程文字，扔掉；
                           这一步结束或攒够一长句（很可能就是回答）再交给引擎念。 */
                        if (chunk?.type === 'text-delta' && chunk.text) {
                            stepText += chunk.text;
                            if (stepLive || stepText.length > 60) {
                                stepLive = true;
                                flushStep();
                            }
                        }
                        else if (chunk?.type === 'tool-call-delta') {
                            stepText = '';
                            stepLive = false;
                        }
                        else if (chunk?.type === 'finish') {
                            flushStep();
                            stepLive = false;
                        }
                    }
                });
                const offStatus = uiSession.sessionStatus.subscribe(() => { if (!submitted)
                    return; if (running())
                    sawRunning = true;
                else if (sawRunning)
                    finish(); });
                /* 插话时引擎会 abort：这里只是不再把这一轮的字交给引擎念，不取消 ASTRA 的回合；
                   新的话会用 steer 插进这一回合，也就不经过界面上那个要二次确认的“停止”。 */
                const onAbort = () => finish();
                hooks.signal.addEventListener('abort', onAbort, { once: true });
                const timer = setTimeout(finish, 180_000);
                try {
                    submitted = true;
                    let mode = running() ? 'steer' : 'queue';
                    let result = await reference.binding.session.prompt([{ type: 'text', text }], mode);
                    if (!result.ok && mode === 'steer') {
                        mode = 'queue';
                        result = await reference.binding.session.prompt([{ type: 'text', text }], mode);
                    }
                    if (!result.ok)
                        throw new Error(`${result.error.code}: ${result.error.message}`);
                    const w = window;
                    (w.__dotCallLog ??= []).push({ at: Date.now(), mode, text: probe });
                    if (running())
                        sawRunning = true;
                    if (!running() && full)
                        finish();
                    await done;
                    if (!hooks.signal.aborted) {
                        flushStep();
                        hooks.onFinal(full);
                    }
                }
                finally {
                    clearTimeout(timer);
                    offEvents();
                    offStatus();
                    hooks.signal.removeEventListener('abort', onAbort);
                }
            });
        };
        scope.effect(() => () => { callTurn = undefined; }, 'dot: 通话会话通道');
        scope.effect(() => {
            /* 2026-11-01 设计稿修正轮：顶栏连接灯要真实状态，所以连 connection.state（connected / connecting / disconnected）一起报。 */
            const update = () => {
                const connected = connection.generation.getSnapshot() !== undefined;
                model.update({ connected, link: connected ? 'connected' : connection.state?.getSnapshot() ?? 'connecting' });
            };
            update();
            const offGeneration = connection.generation.subscribe(update);
            const offState = connection.state?.subscribe(update) ?? (() => { });
            return () => { offGeneration(); offState(); };
        }, 'dot: 原生连接状态');
        scope.effect(() => {
            const update = () => model.update({ busy: [...uiSession.sessionStatus.getSnapshot()].some(([id, status]) => status.running === true && (sessions.retainInfo(id).getSnapshot().retainedBy.mainView ?? 0) > 0) });
            update();
            return uiSession.sessionStatus.subscribe(update);
        }, 'dot: ASTRA 实际会话状态');
        scope.effect(() => watchTurnStatus({ sessions: sessions, uiSession: uiSession }), 'dot: 对话进度状态');
        scope.effect(() => live.approvals.attach(uiSession.sessionStatus), 'dot: 气泡确认桥接原生审批');
        scope.effect(() => installBusiness(scope, model, next => { port = next; }, id => instance.actions.openCard(id), live), 'dot: 业务 Remote');
        /* 对话空间里工作卡已经插在消息流里，不再另弹临时工作卡；其他空间照旧。 */
        scope.effect(() => watchProgressCards(scope, id => { if (personal.getSnapshot().value.autoWorkCard && instance.getSnapshot().space !== 'conversation')
            instance.actions.openCard(id); void model.refresh(); }), 'dot: 按需工作卡');
    });
    ctx.effect(() => {
        let idle;
        const notificationClick = (event) => { const id = event.detail; if (typeof id === 'string' && id) {
            instance.actions.navigate('postbox');
            model.update({ noticeId: id });
            localStorage.removeItem('dot.pending.letter');
        } };
        const pendingLetter = localStorage.getItem('dot.pending.letter');
        if (pendingLetter) {
            instance.actions.navigate('postbox');
            model.update({ noticeId: pendingLetter });
            localStorage.removeItem('dot.pending.letter');
        }
        const awaken = () => { instance.actions.shrink(false); clearTimeout(idle); if (personal.getSnapshot().value.idleShrink)
            idle = setTimeout(() => { if (personal.getSnapshot().value.idleShrink)
                instance.actions.shrink(true); }, 30000); };
        const openWork = (event) => { const id = event.detail; if (typeof id === 'string' && id) {
            instance.actions.openCard(id);
            localStorage.removeItem('dot.pending.work');
        } };
        const pendingWork = localStorage.getItem('dot.pending.work');
        if (pendingWork) {
            instance.actions.openCard(pendingWork);
            localStorage.removeItem('dot.pending.work');
        }
        let previousBrowserState = history.state;
        const rememberBrowserState = () => { previousBrowserState = history.state; };
        const pop = (event) => {
            const wasDetail = Boolean(previousBrowserState?.dotWorkspaceDetail);
            previousBrowserState = event.state;
            /* 详情只收本层；工作页自身的监听负责收卡，外层不再执行 actions.back。 */
            if (wasDetail || event.state?.dotWorkspaceDetail)
                return;
            back();
        };
        window.addEventListener('dot-work-detail', rememberBrowserState);
        const escape = (event) => {
            if (event.key !== 'Escape')
                return;
            const state = instance.getSnapshot();
            if (state.menu || state.card) {
                event.preventDefault();
                back();
            }
        };
        const viewport = window.visualViewport;
        const avoidKeyboard = () => {
            const height = viewport?.height ?? window.innerHeight;
            // 只补布局视口仍被遮住的部分。WebView 已随键盘缩小时，这个差值为零。
            const visibleBottom = height + (viewport?.offsetTop ?? 0);
            const covered = viewport && Math.abs(viewport.scale - 1) < 0.01 ? Math.max(0, window.innerHeight - visibleBottom) : 0;
            document.documentElement.style.setProperty('--dot-chat-bottom-inset', `${covered}px`);
            document.documentElement.style.setProperty('--dot-viewport-height', `${height}px`);
            document.documentElement.style.setProperty('--dot-keyboard-open', height < window.innerHeight * 0.78 ? '1' : '0');
        };
        viewport?.addEventListener('resize', avoidKeyboard);
        viewport?.addEventListener('scroll', avoidKeyboard);
        window.addEventListener('resize', avoidKeyboard);
        avoidKeyboard();
        const previous = window.dotBack;
        window.dotBack = () => {
            const state = instance.getSnapshot();
            if (native.isOpen()) {
                native.close();
                return true;
            }
            if (!state.settings && !state.orbitMenu && !state.menu && !state.card && !state.rightbar && !state.nativePanel && state.space === 'study' && state.history.length === 0)
                return false;
            back();
            return true;
        };
        window.addEventListener('pointerdown', awaken);
        window.addEventListener('keydown', awaken);
        window.addEventListener('dot-open-work', openWork);
        window.addEventListener('dot-open-letter', notificationClick);
        window.addEventListener('popstate', pop);
        window.addEventListener('keydown', escape);
        awaken();
        return () => { viewport?.removeEventListener('resize', avoidKeyboard); viewport?.removeEventListener('scroll', avoidKeyboard); window.removeEventListener('resize', avoidKeyboard); document.documentElement.style.removeProperty('--dot-chat-bottom-inset'); document.documentElement.style.removeProperty('--dot-viewport-height'); document.documentElement.style.removeProperty('--dot-keyboard-open'); clearTimeout(idle); if (previous)
            window.dotBack = previous;
        else
            delete window.dotBack; window.removeEventListener('pointerdown', awaken); window.removeEventListener('keydown', awaken); window.removeEventListener('dot-open-work', openWork); window.removeEventListener('dot-open-letter', notificationClick); window.removeEventListener('popstate', pop); window.removeEventListener('dot-work-detail', rememberBrowserState); window.removeEventListener('keydown', escape); };
    }, 'dot: 返回、深链接、闲置精灵');
}
/* 简洁版输入框占位用的助手名：本机记一份上次取到的名字，首屏不闪「Xtcausal dot」。 */
const ASSISTANT_NAME_CACHE_KEY = 'xtcausal.dot.lite.assistant-name';
/** 简洁版输入框占位（也是它的 aria-label）：有名字写「跟 X 说点什么…」（设计稿 11），还不知道名字就只写「说点什么…」。 */
function litePlaceholder(name) {
    const n = name.trim();
    return n ? `跟 ${n} 说点什么…` : '说点什么…';
}
function readCachedAssistantName() {
    try {
        return globalThis.localStorage?.getItem(ASSISTANT_NAME_CACHE_KEY) ?? '';
    }
    catch {
        return '';
    }
}
function cacheAssistantName(value) {
    const name = typeof value === 'string' ? value.trim() : '';
    try {
        if (name)
            globalThis.localStorage?.setItem(ASSISTANT_NAME_CACHE_KEY, name);
    }
    catch { /* 隐私模式等存不了就算了 */ }
}
