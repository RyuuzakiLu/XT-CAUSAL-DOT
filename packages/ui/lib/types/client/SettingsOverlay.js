import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/* ================================================================
   个人 DOT 设置覆盖层 · 总导游图
   ▍这是什么
   本人手机/电脑的快捷与完整设置；React 消费同一设备偏好和原生提醒状态。
   ▍结构
   焦点/遮罩契约 → 通用控件 → 六组设置 → 原生配置内层。
   ▍修改铁律
   1. 【不】替换 main 场景，覆盖层关闭后草稿与轮播必须还在。
   2. 【不】渲染精灵隐藏、账号或假健康值；菜单入口必须可找回。
   3. 服务保存成功才显示回执；自有API表单复用原生配置/凭据服务，插件设置不复制。
   ▍更新记录
   *更新：2026-10-24 · 个人版共享设置与能力原生配置覆盖层*
   *更新：2026-10-24 · 快捷设置换成底座原画面板（QuickPanel），控件仍是同一份本机偏好与免打扰接口*
   *更新：2026-10-24 · 设置中心（一级分组页与六个二级页）换成 settings_bg 书房背景 + 横条底座 + 分组图标；二级页控件统一为金色自绘控件，接线不变*
   *更新：2026-10-26 · API改自有表单，插件保留原配置，撤其他原生设置入口*
================================================================ */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { DEFAULT_PERSONAL } from "./personal-settings.js";
import { settingsCenterBackground, settingsCenterBanner, settingsCenterIcons } from "./settings-center-art.js";
import { quickPanelArt } from "./quick-settings-art.js";
import { ArtSlot } from "./visuals.js";
import { ApiSettingsPanel } from "./ApiSettingsPanel.js";
import { useChunk } from "./chunks/use-chunk.js";
import css from './settings.module.css';
import { PersonaSettings } from "./persona/PersonaSettings.js"; // dot-persona-2026-10-27
/* 只有在遮罩上完成整次点击才关闭，拖动滑杆到外面松手不会误关或穿透。 */
export function SettingsOverlay(props) {
    /* 浮层里的 ASTRA 入口用坐姿图，在 client.art.js；打开设置才取，没到前显示占位。 */
    useChunk('art');
    const view = props.useStore(value => value);
    const data = props.useDotData(value => value);
    const settings = props.personalSettings;
    const local = useSyncExternalStore(settings.subscribe, settings.getSnapshot);
    const panel = useRef(null);
    const pressed = useRef(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [until, setUntil] = useState(() => { const end = new Date(); end.setMinutes(0, 0, 0); end.setHours(end.getHours() + 2); return end.getTime(); });
    const [diagOpen, setDiagOpen] = useState(false);
    const [permission, setPermission] = useState(typeof Notification === 'undefined' ? '当前环境未提供浏览器通知权限查询' : Notification.permission);
    const page = view.settings;
    /* 完整设置首页=参考图的分组列表；进组只是本地层级，不改原生返回栈。 */
    const [group, setGroup] = useState(null);
    useEffect(() => { if (page !== 'full')
        setGroup(null); }, [page]);
    /* 进组/返回后把焦点放到新页面的返回键，键盘与读屏不会落在已卸载的按钮上。 */
    const firstGroupRender = useRef(true);
    useEffect(() => { if (firstGroupRender.current) {
        firstGroupRender.current = false;
        return;
    } panel.current?.querySelector('button')?.focus({ preventScroll: true }); }, [group]);
    const groupRef = useRef(group);
    groupRef.current = group;
    const edge = local.value.spriteEdge ?? 'right';
    useEffect(() => {
        const root = panel.current;
        const previous = document.activeElement;
        const siblings = Array.from(root?.parentElement?.children ?? []).filter(node => node !== root);
        const old = siblings.map(node => node.inert);
        siblings.forEach(node => { node.inert = true; });
        root?.querySelector('button')?.focus();
        const keyboard = (event) => {
            if (props.nativeSettingsOpen?.())
                return;
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopImmediatePropagation();
                if (groupRef.current)
                    setGroup(null);
                else
                    props.actions.back();
                return;
            }
            if (event.key !== 'Tab')
                return;
            const items = Array.from(root?.querySelectorAll('button:not(:disabled),input,select,textarea,a[href]') ?? []).filter(node => node.offsetParent !== null);
            const first = items[0], last = items.at(-1);
            if (event.shiftKey && (document.activeElement === first || !root?.contains(document.activeElement))) {
                event.preventDefault();
                last?.focus();
            }
            else if (!event.shiftKey && (document.activeElement === last || !root?.contains(document.activeElement))) {
                event.preventDefault();
                first?.focus();
            }
        };
        document.addEventListener('keydown', keyboard, true);
        return () => { document.removeEventListener('keydown', keyboard, true); siblings.forEach((node, i) => { node.inert = old[i] ?? false; }); if (previous?.isConnected)
            previous.focus(); };
    }, [page]);
    /* 提醒使用带 rev 的实例保存；离线/冲突保留错误，不伪报本机已保存。 */
    const server = async (patch) => {
        setBusy(true);
        setError('');
        try {
            const before = data.reminderSettings?.preferences;
            await props.command('settings.reminders', patch);
            const expected = props.readData?.().reminderSettings?.preferences;
            settings.notify('提醒习惯已保存到当前 DOT，电脑和手机共用；星邮匣仍收信。');
            if (before && expected)
                settings.offerServerUndo(() => props.command('settings.reminders', { restore: before, expected }));
        }
        catch (cause) {
            setError(String(cause));
        }
        finally {
            setBusy(false);
        }
    };
    const change = (patch) => { try {
        settings.change(patch);
        setError('');
    }
    catch (cause) {
        setError(String(cause));
    } };
    /* 设置中心二级页控件：全部是同风格的自绘控件（金色开关/滑条/分段/步进），不出现浏览器原生复选框与日期框。 */
    const slider = (key, label, min, max, icon) => _jsx(CSlider, { icon: icon, label: label, min: min, max: max, value: local.value[key], onChange: value => change({ [key]: value }) });
    const toggle = (key, label, icon) => _jsx(CRow, { icon: icon, label: label, control: _jsx(CSwitch, { label: label, checked: Boolean(local.value[key]), onChange: value => change({ [key]: value }) }) });
    const prefs = data.reminderSettings?.preferences;
    const quiet = Boolean(prefs?.dnd.enabled && (prefs.dnd.until === undefined || prefs.dnd.until > Date.now()));
    const reminderOff = busy || !data.connected || !data.reminderSettings?.personalReminders;
    const quietUntil = (end) => { if (!Number.isFinite(end) || end <= Date.now()) {
        setError('结束时间需要在未来');
        return;
    } void server({ until: end }); };
    const permissionText = window.dotAndroid ? '由 Android 系统管理' : { granted: '已允许', denied: '已拒绝', default: '尚未询问' }[permission] ?? permission;
    const quietControls = _jsxs(_Fragment, { children: [data.reminderSettings?.personalReminders !== true && _jsx("p", { role: "status", className: css.cNotice, children: "\u4E34\u65F6\u514D\u6253\u6270\u4E0E\u5206\u7C7B\u63D0\u9192\u4EE3\u7801\u5DF2\u66F4\u65B0\uFF0C\u5F53\u524D\u8FD0\u884C\u670D\u52A1\u5C1A\u672A\u52A0\u8F7D\uFF1B\u8FD9\u4E24\u9879\u6682\u4E0D\u53EF\u7528\uFF0C\u666E\u901A\u5916\u89C2\u8BBE\u7F6E\u4E0D\u53D7\u5F71\u54CD\u3002" }), _jsxs(CSection, { caption: "\u514D\u6253\u6270", children: [_jsx(CRow, { icon: "quiet", label: "\u514D\u6253\u6270", desc: quiet ? prefs?.dnd.until ? `免打扰至 ${formatEnd(prefs.dnd.until)}` : '按每日时间窗免打扰' : '免打扰已关闭' }), _jsxs("div", { className: css.cBlock, children: [_jsx("span", { className: css.cBlockLabel, children: "\u65F6\u957F" }), _jsx(CSegment, { label: "\u514D\u6253\u6270\u65F6\u957F", wide: true, value: quiet ? '' : 'off', disabled: reminderOff, options: [{ key: 'off', label: '关闭' }, { key: 'hour', label: '1小时' }, { key: 'night', label: '今晚' }], onPick: key => {
                                    if (key === 'off')
                                        void server({ until: null });
                                    else if (key === 'hour')
                                        void server({ until: Date.now() + 3600000 });
                                    else {
                                        const end = new Date();
                                        end.setHours(8, 0, 0, 0);
                                        if (end.getTime() <= Date.now())
                                            end.setDate(end.getDate() + 1);
                                        void server({ until: end.getTime() });
                                    }
                                } })] }), _jsxs("div", { className: css.cBlock, children: [_jsxs("span", { className: css.cBlockLabel, children: ["\u81EA\u5B9A\u4E49\u7ED3\u675F", _jsx("b", { children: formatEnd(until) })] }), _jsx(EndPicker, { value: until, onChange: setUntil, disabled: reminderOff }), _jsx("div", { className: css.cActions, "data-align": "end", children: _jsx("button", { type: "button", className: css.cBtn, "data-primary": "true", disabled: reminderOff, onClick: () => quietUntil(until), children: "\u8BBE\u5B9A" }) })] })] }), _jsx("p", { className: css.cHint, children: "\u5F53\u524D DOT \u7684\u7535\u8111\u4E0E\u624B\u673A\u5171\u7528\u3002\u53EA\u6682\u505C\u4E3B\u52A8\u63D0\u9192\uFF0C\u4FE1\u7167\u5E38\u8FDB\u661F\u90AE\u5323\u3002" })] });
    const groups = [
        { key: 'appearance', title: '外观与阅读', en: 'APPEARANCE', desc: '字体大小、玻璃浓度与动态效果', icon: 'appearance', body: _jsxs(_Fragment, { children: [_jsxs(CSection, { caption: "\u9605\u8BFB", children: [slider('fontScale', '字体大小', 85, 130, 'font'), slider('glassOpacity', '玻璃浓度', 35, 100, 'glass')] }), _jsx(CSection, { caption: "\u52A8\u6001", children: toggle('reducedMotion', '减少动态效果', 'motion') }), _jsx("p", { className: css.cHint, children: "\u661F\u591C\u98CE\u683C\u4FDD\u7559\u3002\u5B57\u4F53\u5F71\u54CD\u5B9E\u9645\u9605\u8BFB\u4E0E\u8F93\u5165\uFF0C\u73BB\u7483\u5F71\u54CD\u771F\u5B9E\u9762\u677F\uFF1B\u4EC5\u5F53\u524D\u8BBE\u5907\u3002" }), _jsx("div", { className: css.cActions, children: _jsxs("button", { type: "button", className: css.cBtn, onClick: () => change({ fontScale: DEFAULT_PERSONAL.fontScale, glassOpacity: DEFAULT_PERSONAL.glassOpacity, reducedMotion: DEFAULT_PERSONAL.reducedMotion }), children: [_jsx(RowIcon, { name: "reset" }), "\u6062\u590D\u672C\u7EC4\u9ED8\u8BA4"] }) })] }) },
        { key: 'astra', title: 'ASTRA 与菜单', en: 'ASTRA & MENU', desc: '精灵大小、停靠侧与状态提示', icon: 'astra', body: _jsxs(_Fragment, { children: [_jsxs(CSection, { caption: "\u7CBE\u7075", children: [slider('spriteScale', '精灵大小', 40, 100, 'size'), _jsx(CRow, { icon: "edge", label: "\u7CBE\u7075\u505C\u9760\u4FA7", control: _jsx(CSegment, { label: "\u7CBE\u7075\u505C\u9760\u4FA7", value: local.value.spriteEdge ?? '', options: [{ key: 'left', label: '左侧' }, { key: 'right', label: '右侧' }], onPick: key => change({ spriteEdge: key }) }) })] }), _jsxs(CSection, { caption: "\u72B6\u6001", children: [toggle('idleShrink', '闲置时适度缩小', 'idle'), toggle('stateFeedback', '显示状态提示', 'feedback')] }), _jsx("p", { className: css.cHint, children: "\u7CBE\u7075\u59CB\u7EC8\u662F\u83DC\u5355\u5165\u53E3\uFF0C\u62D6\u52A8\u4ECD\u53EF\u505C\u9760\uFF1B\u6CA1\u6709\u9690\u85CF\u5F00\u5173\u3002" })] }) },
        { key: 'persona', title: '人格与称呼', en: 'PERSONA', desc: 'DOT 的名字、对你的称呼、性别与人格', icon: 'astra', body: _jsx(PersonaSettings, { css: css }) }, // dot-persona-2026-10-27
        { key: 'notice', title: '提醒习惯', en: 'NOTIFICATIONS', desc: '免打扰、系统通知与主动提醒', icon: 'notice', body: _jsxs(_Fragment, { children: [quietControls, _jsxs(CSection, { caption: "\u7CFB\u7EDF\u901A\u77E5", children: [_jsx(CRow, { icon: "bell", label: "\u672C\u8BBE\u5907\u7CFB\u7EDF\u901A\u77E5", value: permissionText }), _jsxs("button", { type: "button", className: `${css.cRow} ${css.cNav}`, onClick: () => void props.command('notifications.enable').then(() => setPermission(typeof Notification === 'undefined' ? '无法从浏览器查询' : Notification.permission)).catch(cause => setError(String(cause))), children: [_jsx(RowIcon, { name: "spark" }), _jsx("span", { className: css.cLabel, children: "\u7533\u8BF7\u7CFB\u7EDF\u901A\u77E5" }), _jsx(Chevron, {})] })] }), _jsx(CSection, { caption: "\u4E3B\u52A8\u63D0\u9192", children: ['completed', 'attention', 'failed'].map((category, i) => {
                            const label = `${['任务完成', '需要确认或介入', '任务失败'][i]}主动提醒`;
                            return _jsx(CRow, { icon: ['done', 'attention', 'failed'][i], label: label, control: _jsx(CSwitch, { label: label, disabled: reminderOff || !prefs, checked: prefs?.events?.[category] ?? true, onChange: value => void server({ category, enabled: value }) }) }, category);
                        }) }), _jsx("p", { className: css.cHint, children: "\u5173\u95ED\u540E\u4E0D\u518D\u4E3B\u52A8\u5F39\u51FA\uFF0C\u76F8\u5173\u6D88\u606F\u4ECD\u7559\u5728\u661F\u90AE\u5323\u3002" }), _jsxs(CSection, { caption: "\u63D0\u9192\u6E20\u9053", children: [_jsx(CRow, { icon: "phone", label: "\u672C\u673A/\u524D\u53F0\u63D0\u9192\u6E20\u9053", control: _jsx(CSwitch, { label: "\u672C\u673A/\u524D\u53F0\u63D0\u9192\u6E20\u9053", disabled: busy || !prefs || !data.connected, checked: prefs?.channels.native ?? false, onChange: value => void server({ channel: 'native', enabled: value }) }) }), data.channelStatus?.feishuConfigured
                                ? _jsx(CRow, { icon: "plane", label: "\u98DE\u4E66\u63D0\u9192\u6E20\u9053", control: _jsx(CSwitch, { label: "\u98DE\u4E66\u63D0\u9192\u6E20\u9053", disabled: busy || !prefs || !data.connected, checked: prefs?.channels.feishu ?? false, onChange: value => void server({ channel: 'feishu', enabled: value }) }) })
                                : _jsx(CRow, { icon: "plane", label: "\u98DE\u4E66\u63D0\u9192\u6E20\u9053", desc: `飞书尚未配置：${data.channelStatus?.reason ?? '未取得接入状态'}` })] })] }) },
        { key: 'work', title: '对话与工作展示', en: 'CONVERSATION & WORK', desc: '工作卡打开方式、展开与动效', icon: 'conversation', body: _jsxs(_Fragment, { children: [_jsxs(CSection, { caption: "\u5DE5\u4F5C\u5361", children: [toggle('autoWorkCard', '查询进度时自动打开工作卡', 'card'), toggle('expandedWorkCard', '工作卡默认展开详情', 'expand'), toggle('cardMotion', '工作卡动态效果', 'motion')] }), _jsx("p", { className: css.cHint, children: "\u53EA\u6539\u672C\u673A\u5C55\u793A\uFF0C\u4E0D\u53D6\u6D88\u540E\u53F0\u5DE5\u4F5C\uFF0C\u4E5F\u4E0D\u6539\u804A\u5929\u6B63\u6587\u3002" })] }) },
        { key: 'device', title: '当前设备与连接', en: 'DEVICE & SYNC', desc: '服务地址、连接状态与重新读取', icon: 'device', body: _jsxs(_Fragment, { children: [_jsxs(CSection, { caption: "\u5F53\u524D\u8FDE\u63A5", children: [_jsx(CRow, { icon: "server", label: "\u5F53\u524D\u670D\u52A1", desc: _jsx("code", { className: css.cCode, children: location.origin }) }), _jsx(CRow, { icon: "signal", label: "\u8FDE\u63A5", desc: data.connected ? undefined : '旧快照不代表实时状态', value: _jsx("span", { className: css.cState, "data-on": data.connected, children: data.connected ? '已连接' : '已断开' }) })] }), _jsxs(CSection, { caption: "\u64CD\u4F5C", children: [_jsxs("button", { type: "button", className: `${css.cRow} ${css.cNav}`, onClick: () => void props.refresh(), children: [_jsx(RowIcon, { name: "refresh" }), _jsx("span", { className: css.cLabel, children: "\u91CD\u65B0\u8BFB\u53D6\u72B6\u6001" }), _jsx(Chevron, {})] }), _jsxs("button", { type: "button", className: `${css.cRow} ${css.cNav}`, onClick: () => location.reload(), children: [_jsx(RowIcon, { name: "reload" }), _jsx("span", { className: css.cLabel, children: "\u5237\u65B0\u672C\u9875" }), _jsx(Chevron, {})] }), _jsxs("button", { type: "button", className: `${css.cRow} ${css.cNav}`, onClick: () => void props.command('connection.configure').catch(cause => setError(String(cause))), children: [_jsx(RowIcon, { name: "link" }), _jsx("span", { className: css.cLabel, children: "\u66F4\u6362\u670D\u52A1\u5730\u5740" }), _jsx(Chevron, {})] })] }), _jsx("p", { className: css.cHint, children: "\u66F4\u6362\u5730\u5740\u53EA\u5F71\u54CD\u6B64\u8BBE\u5907\uFF0C\u53EF\u80FD\u65AD\u5F00\u5F53\u524D\u8FDE\u63A5\uFF1B\u4E0D\u4F1A\u66F4\u6539 Tailscale \u6216\u65B0\u5EFA\u8D26\u53F7\u3002" })] }) },
        { key: 'about', title: '关于与诊断', en: 'ABOUT & DIAGNOSTICS', desc: '版本、XTMEM、模型/API 与插件配置', icon: 'about', body: _jsxs(_Fragment, { children: [_jsxs(CSection, { caption: "\u7248\u672C", children: [_jsx(CRow, { icon: "info", label: "XTCausal DOT", value: "\u4E2A\u4EBA\u7248 0.1.0" }), _jsx(CRow, { icon: "memory", label: "XTMEM", desc: data.memoryStatus ? data.memoryStatus.available ? `可用${data.memoryStatus.engineVersion ? ` · ${data.memoryStatus.engineVersion}` : ''}` : data.memoryStatus.reason ?? '不可用' : '状态尚未取得' })] }), _jsxs(CSection, { caption: "\u914D\u7F6E", children: [_jsxs("button", { type: "button", className: `${css.cRow} ${css.cNav}`, onClick: () => void props.command('settings.models').catch(cause => setError(String(cause))), children: [_jsx(RowIcon, { name: "chip" }), _jsx("span", { className: css.cLabel, children: "\u6A21\u578B/API \u914D\u7F6E" }), _jsx(Chevron, {})] }), _jsxs("button", { type: "button", className: `${css.cRow} ${css.cNav}`, onClick: () => void props.command('plugins.open').catch(cause => setError(String(cause))), children: [_jsx(RowIcon, { name: "plugin" }), _jsx("span", { className: css.cLabel, children: "\u63D2\u4EF6\u4E0E\u5DE5\u5177\u914D\u7F6E" }), _jsx(Chevron, {})] })] }), _jsxs(CSection, { caption: "\u8BCA\u65AD", children: [_jsxs("button", { type: "button", className: `${css.cRow} ${css.cNav}`, "aria-expanded": diagOpen, onClick: () => setDiagOpen(value => !value), children: [_jsx(RowIcon, { name: "pulse" }), _jsx("span", { className: css.cLabel, children: "\u8BCA\u65AD\u8BE6\u60C5" }), _jsx(Chevron, { open: diagOpen })] }), diagOpen && _jsxs("div", { className: css.cDetail, children: [_jsxs("p", { children: ["\u771F\u5B9E\u76EE\u5F55\uFF1A", data.providers?.length ?? 0, " \u4E2A API/\u4F9B\u5E94\u5546\uFF0C", data.providers?.reduce((n, row) => n + row.models.length, 0) ?? 0, " \u4E2A\u6A21\u578B\uFF1B", data.capabilities.filter(row => row.id.startsWith('tool:')).length, " \u4E2A\u5DE5\u5177\u3002"] }), _jsxs("p", { children: ["\u6700\u8FD1\u9519\u8BEF\uFF1A", data.error ?? data.providerError ?? '当前没有已捕获的错误'] }), _jsx("div", { className: css.cActions, children: _jsxs("button", { type: "button", className: css.cBtn, onClick: () => { const report = { app: 'XTCausal DOT 0.1.0', connected: data.connected, memoryAvailable: data.memoryStatus?.available ?? null, providers: data.providers?.length ?? 0, models: data.providers?.reduce((n, row) => n + row.models.length, 0) ?? 0, tools: data.capabilities.filter(row => row.id.startsWith('tool:')).length, errorPresent: Boolean(data.error || data.providerError), time: new Date().toISOString() }; const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'dot-diagnostics.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }, children: [_jsx(RowIcon, { name: "download" }), "\u5BFC\u51FA\u8131\u654F\u8BCA\u65AD"] }) }), _jsx("p", { className: css.cHint, children: "\u5BFC\u51FA\u4E0D\u542B\u670D\u52A1\u5730\u5740\u3001\u8FDE\u63A5\u540D\u79F0\u3001\u6B63\u6587\u3001\u5BC6\u94A5\u6216\u539F\u59CB\u9519\u8BEF\u6587\u672C\u3002" })] })] })] }) }
    ];
    const open = page === 'full' ? groups.find(row => row.key === group) : undefined;
    const native = page === 'plugins' || page === 'native';
    const apiPage = page === 'models';
    /* 快捷免打扰开关走星邮匣同一个 postbox.preferences 接口（与星邮匣页的免打扰勾选同一份），
       1小时/今晚/自定义结束仍在设置中心「提醒习惯」；保存成功才回执，撤销沿用带 rev 的原接头。 */
    const toggleQuiet = async (next) => {
        setBusy(true);
        setError('');
        try {
            const before = data.reminderSettings?.preferences;
            await props.command('postbox.preferences', { dnd: next });
            const expected = props.readData?.().reminderSettings?.preferences;
            settings.notify(next ? '已开启免打扰（按每日时间窗），当前 DOT 的电脑和手机共用；信照常进星邮匣。' : '已关闭当前 DOT 的免打扰。');
            if (before && expected && data.reminderSettings?.personalReminders)
                settings.offerServerUndo(() => props.command('settings.reminders', { restore: before, expected }));
        }
        catch (cause) {
            setError(String(cause));
        }
        finally {
            setBusy(false);
        }
    };
    const quickPanel = page === 'quick' && _jsx(QuickPanel, { spriteScale: local.value.spriteScale, motion: !local.value.reducedMotion, quiet: data.dnd, quietDisabled: busy || !data.connected, onScale: value => change({ spriteScale: value }), onMotion: value => change({ reducedMotion: !value }), onQuiet: value => void toggleQuiet(value), onOpenCenter: () => props.actions.settings('full'), onClose: () => props.actions.back(), footer: _jsxs(_Fragment, { children: [busy && _jsx("p", { role: "status", className: css.qReceipt, children: "\u6B63\u5728\u4FDD\u5B58\u5230 DOT\u2026" }), error && _jsx("p", { role: "alert", className: css.qError, children: error }), local.notice && _jsxs("p", { className: css.qReceipt, role: "status", children: [local.notice, (local.canUndo || local.serverUndo) && _jsx("button", { onClick: () => void settings.undoLast().catch(cause => setError(String(cause))), children: "\u64A4\u9500" })] })] }) });
    const center = page !== 'quick';
    const headIcon = open ? open.icon : 'about';
    const headTitle = apiPage ? 'API与模型连接' : native ? '插件与工具' : open?.title;
    const headEn = native ? 'NATIVE CONFIG' : open?.en;
    const footer = _jsxs(_Fragment, { children: [busy && _jsx("p", { role: "status", className: css.cToast, children: "\u6B63\u5728\u4FDD\u5B58\u5230 DOT\u2026" }), error && _jsx("p", { role: "alert", className: `${css.cToast} ${css.error}`, children: error }), local.notice && _jsxs("p", { className: css.cToast, role: "status", children: [local.notice, (local.canUndo || local.serverUndo) && _jsxs("button", { type: "button", onClick: () => void settings.undoLast().catch(cause => setError(String(cause))), children: ["\u64A4\u9500", local.serverUndo ? '提醒' : '本机', "\u8C03\u6574"] })] })] });
    /* ⚠️ 精灵是唯一全局入口：设置盖住场景时，在浮层内保留同一入口，点它收起设置并打开六空间菜单。
       快捷设置：底角、同停靠侧；设置中心：底部是背景横幅（必须完整显示），入口移到标题栏右侧。 */
    const keep = _jsxs("button", { className: css.spriteKeep, "data-edge": edge, "aria-label": "ASTRA \u83DC\u5355\u5165\u53E3", title: "\u6253\u5F00\u516D\u7A7A\u95F4\u83DC\u5355", onClick: () => { props.actions.settings(null); props.actions.orbitMenu(true); }, children: [_jsx(ArtSlot, { kind: "docked", className: css.spriteKeepArt }), _jsx("small", { children: "ASTRA" })] });
    return _jsxs("section", { ref: panel, className: css.overlay, "data-quick": page === 'quick', "data-center": center, "data-page": open ? 'group' : page ?? undefined, "data-edge": edge, "data-settings-overlay": "", role: "dialog", "aria-modal": "true", "aria-label": native ? '能力原生配置' : page === 'quick' ? 'ASTRA 快捷设置' : '个人设置', onPointerDown: event => { pressed.current = event.target === event.currentTarget; }, onClick: event => { if (pressed.current && event.target === event.currentTarget)
            props.actions.back(); pressed.current = false; }, children: [quickPanel || _jsxs("div", { className: css.panel, "data-view": open ? 'group' : native ? 'native' : 'home', style: { '--center-bg': `url(${settingsCenterBackground})`, '--center-banner': `url(${settingsCenterBanner})` }, children: [_jsxs("header", { className: css.cHeader, children: [_jsx("button", { type: "button", className: css.cBack, "aria-label": open ? '返回设置中心' : '返回', onClick: () => open ? setGroup(null) : props.actions.back(), children: _jsx("svg", { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.7", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: _jsx("path", { d: "M10 3.2 5.2 8l4.8 4.8" }) }) }), headTitle
                                ? _jsxs("div", { className: css.cHeadGroup, children: [_jsx("img", { className: css.cHeadIcon, src: settingsCenterIcons[headIcon], alt: "", draggable: false }), _jsxs("h1", { className: css.cHeadTitle, children: [headTitle, _jsx("small", { children: headEn })] })] })
                                : _jsxs("h1", { className: css.cTitle, children: ["\u8BBE\u7F6E\u4E2D\u5FC3", _jsx("small", { "aria-hidden": "true", children: "SETTINGS CENTER" })] }), keep] }), !headTitle
                        ? _jsx("nav", { className: css.cList, "aria-label": "\u8BBE\u7F6E\u5206\u7EC4", children: groups.map(row => _jsxs("button", { type: "button", className: css.cCard, "data-group": row.key, onClick: () => setGroup(row.key), children: [_jsx("img", { className: css.cCardIcon, src: settingsCenterIcons[row.icon], alt: "", draggable: false }), _jsxs("span", { className: css.cCardText, children: [_jsx("b", { children: row.title }), _jsx("small", { children: row.desc })] }), _jsx("svg", { className: css.cCardChev, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: _jsx("path", { d: "M6 3.2 10.8 8 6 12.8" }) })] }, row.key)) })
                        : _jsxs("div", { className: css.cBody, children: [_jsx("div", { className: css.cScroll, "data-group": open?.key ?? page, children: apiPage ? _jsx(ApiSettingsPanel, { port: props.apiSettings }) : native ? _jsxs(CSection, { caption: "\u63D2\u4EF6\u4E0E\u5DE5\u5177", children: [_jsx("p", { className: css.cText, children: "\u63D2\u4EF6\u4FDD\u7559\u5404\u81EA\u7684\u914D\u7F6E\u5165\u53E3\uFF1BAPI\u4E0E\u6A21\u578B\u4F7F\u7528DOT\u81EA\u5DF1\u7684\u8BBE\u7F6E\u754C\u9762\u3002" }), _jsx("div", { className: css.native, children: _jsxs("button", { type: "button", className: `${css.cRow} ${css.cNav}`, onClick: () => void props.command('plugins.open').catch(cause => setError(String(cause))), children: [_jsx(RowIcon, { name: "gear" }), _jsx("span", { className: css.cLabel, children: "\u6253\u5F00\u63D2\u4EF6\u914D\u7F6E" }), _jsx(Chevron, {})] }) })] }) : open?.body }), (busy || error || local.notice) && _jsx("div", { className: css.cFoot, children: footer })] })] }), !center && keep] });
}
/* ── 设置中心二级页的同风格控件 ────────────────────────────────────
   金色开关/滑条与快捷设置同一套配色；行小图标一律代码画的金色线条，不引图片素材。
   ⚠️ 只渲染：值与回调都由 SettingsOverlay 传入，接线仍是同一份 PersonalSettings / DOT 提醒接口。 */
const ROW_ICONS = {
    font: ['M3.5 18.5 8.5 5.5h1l5 13', 'M5.6 13.6h6.8', 'M20.5 18.5v-5a2.6 2.6 0 0 0-4.6-1.6', 'M20.5 15.6c-2.8-.4-5 .3-5 1.6 0 1 .9 1.5 2 1.5 1.6 0 3-1.1 3-3.1'],
    glass: ['M12 3.8 20.5 8 12 12.2 3.5 8 12 3.8z', 'M3.5 12 12 16.2 20.5 12', 'M3.5 16 12 20.2 20.5 16'],
    motion: ['M10 3.5l1.6 4.4 4.4 1.6-4.4 1.6L10 15.5l-1.6-4.4L4 9.5l4.4-1.6z', 'M17.5 13.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z'],
    reset: ['M4.5 12a7.5 7.5 0 1 0 2.2-5.3', 'M4.5 4v4.2h4.2'],
    size: ['M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6', 'M13.3 12a1.3 1.3 0 1 1-2.6 0 1.3 1.3 0 0 1 2.6 0z'],
    edge: ['M19.5 3.5v17', 'M7 8h5a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z', 'M14 12h3M15.6 10.4L17.2 12l-1.6 1.6'],
    idle: ['M13 4h6l-6 7h6', 'M5 12.5h4.5l-4.5 6h4.5'],
    feedback: ['M4 5.5h16v10.5H10l-4.5 3.5V16H4z', 'M8 9.5h8M8 12.5h5'],
    quiet: ['M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z', 'M16.5 4.5l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z'],
    bell: ['M6 16v-5a6 6 0 1 1 12 0v5l2 2H4l2-2z', 'M10 20.5a2 2 0 0 0 4 0'],
    spark: ['M12 3v4M12 17v4M3 12h4M17 12h4', 'M12 9.2l.9 1.9 1.9.9-1.9.9-.9 1.9-.9-1.9-1.9-.9 1.9-.9z'],
    done: ['M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17z', 'M8.2 12.3l2.6 2.6 5-5.2'],
    attention: ['M12 3.8 21 19.5H3z', 'M12 10v4.5', 'M12 17.2v.1'],
    failed: ['M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17z', 'M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6'],
    phone: ['M8.5 3h7a1.5 1.5 0 0 1 1.5 1.5v15a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 19.5v-15A1.5 1.5 0 0 1 8.5 3z', 'M11 18h2'],
    plane: ['M20.5 3.5 3.5 10.8l6.8 2.4 2.4 6.8z', 'M10.3 13.2l4.4-4.4'],
    link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
    card: ['M4 6h16v13H4z', 'M4 10h16', 'M7.5 14h5'],
    expand: ['M4 5h16v14H4z', 'M9 11l3 3 3-3'],
    server: ['M4.5 4.5h15v6h-15zM4.5 13.5h15v6h-15z', 'M8 7.5h.1M8 16.5h.1'],
    signal: ['M4.5 10.5a10.6 10.6 0 0 1 15 0', 'M7.6 13.8a6.2 6.2 0 0 1 8.8 0', 'M12 17.6v.1'],
    refresh: ['M19.5 11A7.5 7.5 0 0 0 6 7.3L4.5 9', 'M4.5 4.5V9H9', 'M4.5 13A7.5 7.5 0 0 0 18 16.7l1.5-1.7', 'M19.5 19.5V15H15'],
    reload: ['M4 6h16v13H4z', 'M4 9.5h16', 'M14.8 14.6a3 3 0 1 1-.9-2.2', 'M14.4 11.3v1.6h-1.6'],
    info: ['M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17z', 'M12 11v5.2', 'M12 7.8v.1'],
    memory: ['M12 3.5c4.1 0 7.5 1.2 7.5 2.8S16.1 9 12 9 4.5 7.9 4.5 6.3 7.9 3.5 12 3.5z', 'M4.5 6.3v11.4c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8V6.3', 'M4.5 12c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8'],
    chip: ['M7.5 7.5h9v9h-9z', 'M10 3.5v4M14 3.5v4M10 16.5v4M14 16.5v4M3.5 10h4M3.5 14h4M16.5 10h4M16.5 14h4'],
    plugin: ['M9.5 4.5h5v2.2a1.6 1.6 0 0 0 3.2 0V4.5H20v6h-2.3a1.6 1.6 0 0 0 0 3.2H20v5.8H4v-5.8h2.3a1.6 1.6 0 0 0 0-3.2H4v-6h5.5z'],
    pulse: ['M3 12h4l2.2-5.5 4.2 11 2.3-5.5H21'],
    download: ['M12 4v11', 'M7.5 10.5 12 15l4.5-4.5', 'M5 19.5h14'],
    calendar: ['M4.5 6h15v14h-15z', 'M4.5 10h15', 'M8.5 3.5v4M15.5 3.5v4'],
    gear: ['M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z', 'M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7'],
};
function RowIcon({ name }) {
    return _jsx("svg", { className: css.cIcon, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false", children: ROW_ICONS[name].map(d => _jsx("path", { d: d }, d)) });
}
function Chevron({ open }) {
    return _jsx("svg", { className: css.cChev, "data-open": open, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false", children: _jsx("path", { d: "M6 3.5 10.5 8 6 12.5" }) });
}
function CSection({ caption, children }) {
    return _jsxs("section", { className: css.cSection, children: [_jsx("h2", { className: css.cCaption, children: caption }), _jsx("div", { className: css.cGlass, children: children })] });
}
function CRow({ icon, label, desc, value, control }) {
    return _jsxs("div", { className: css.cRow, children: [_jsx(RowIcon, { name: icon }), _jsxs("span", { className: css.cLabel, children: [label, desc !== undefined && _jsx("small", { children: desc })] }), value !== undefined && _jsx("span", { className: css.cValue, children: value }), control] });
}
function CSwitch({ label, checked, onChange, disabled }) {
    return _jsx("button", { type: "button", role: "switch", className: css.cSwitch, "aria-label": label, "aria-checked": checked, disabled: disabled, onClick: () => onChange(!checked) });
}
function CSlider({ icon, label, min, max, value, onChange }) {
    return _jsxs("label", { className: `${css.cRow} ${css.cSlider}`, children: [_jsx(RowIcon, { name: icon }), _jsx("span", { className: css.cLabel, children: label }), _jsxs("output", { className: css.cValue, children: [value, "%"] }), _jsx("input", { className: css.cRange, style: { '--c-fill': `${(value - min) / (max - min) * 100}%` }, "aria-label": label, type: "range", min: min, max: max, step: 1, value: value, onChange: event => onChange(Number(event.target.value)) })] });
}
function CSegment({ label, options, value, onPick, disabled, wide }) {
    return _jsx("div", { className: css.cSegment, "data-wide": wide, role: "group", "aria-label": label, children: options.map(option => _jsx("button", { type: "button", "aria-pressed": value === option.key, disabled: disabled, onClick: () => onPick(option.key), children: option.label }, option.key)) });
}
const WEEK = '日一二三四五六';
const pad = (n) => String(n).padStart(2, '0');
function dayWord(time) {
    const day = new Date(time);
    day.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.round((day.getTime() - today.getTime()) / 86400000);
    return diff === 0 ? '今天' : diff === 1 ? '明天' : diff === 2 ? '后天' : '';
}
function formatEnd(time) {
    const at = new Date(time), word = dayWord(time);
    return `${word || `${at.getMonth() + 1}月${at.getDate()}日`} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}
/* 自定义结束时间：日期步进 + 时步进 + 分钟四档，代替浏览器原生 datetime-local。日期不早于今天，最多 30 天后。 */
function EndPicker({ value, onChange, disabled }) {
    const at = new Date(value);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const day = new Date(value);
    day.setHours(0, 0, 0, 0);
    const offset = Math.round((day.getTime() - today.getTime()) / 86400000);
    const shift = (patch) => { const next = new Date(value); patch(next); onChange(next.getTime()); };
    const minute = Math.floor(at.getMinutes() / 15) * 15;
    return _jsxs("div", { className: css.cPicker, role: "group", "aria-label": "\u514D\u6253\u6270\u7ED3\u675F\u65F6\u95F4", children: [_jsxs("div", { className: css.cStepper, "data-wide": "true", children: [_jsx("button", { type: "button", "aria-label": "\u524D\u4E00\u5929", disabled: disabled || offset <= 0, onClick: () => shift(next => next.setDate(next.getDate() - 1)), children: _jsx(Chevron, {}) }), _jsxs("output", { "aria-live": "polite", children: [_jsx(RowIcon, { name: "calendar" }), dayWord(value) && _jsx("em", { children: dayWord(value) }), at.getMonth() + 1, "\u6708", at.getDate(), "\u65E5 \u5468", WEEK[at.getDay()]] }), _jsx("button", { type: "button", "aria-label": "\u540E\u4E00\u5929", disabled: disabled || offset >= 30, onClick: () => shift(next => next.setDate(next.getDate() + 1)), children: _jsx(Chevron, {}) })] }), _jsxs("div", { className: css.cPickerRow, children: [_jsxs("div", { className: css.cStepper, children: [_jsx("button", { type: "button", "aria-label": "\u65E9\u4E00\u5C0F\u65F6", disabled: disabled, onClick: () => shift(next => next.setHours((next.getHours() + 23) % 24)), children: _jsx(Chevron, {}) }), _jsxs("output", { "aria-live": "polite", children: [pad(at.getHours()), _jsx("small", { children: "\u65F6" })] }), _jsx("button", { type: "button", "aria-label": "\u665A\u4E00\u5C0F\u65F6", disabled: disabled, onClick: () => shift(next => next.setHours((next.getHours() + 1) % 24)), children: _jsx(Chevron, {}) })] }), _jsx(CSegment, { label: "\u5206\u949F", value: String(minute), disabled: disabled, options: [0, 15, 30, 45].map(m => ({ key: String(m), label: pad(m) })), onPick: key => shift(next => next.setMinutes(Number(key), 0, 0)) })] })] });
}
const QUICK_ICONS = {
    show: ['M2.8 12s3.4-6 9.2-6 9.2 6 9.2 6-3.4 6-9.2 6-9.2-6-9.2-6z', 'M12 9.3l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z'],
    edge: ['M19.5 3.5v17', 'M7 8h5a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z', 'M14 12h3M15.6 10.4L17.2 12l-1.6 1.6'],
    size: ['M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6', 'M13.3 12a1.3 1.3 0 1 1-2.6 0 1.3 1.3 0 0 1 2.6 0z'],
    motion: ['M10 3.5l1.6 4.4 4.4 1.6-4.4 1.6L10 15.5l-1.6-4.4L4 9.5l4.4-1.6z', 'M17.5 13.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z'],
    quiet: ['M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z', 'M16.5 4.5l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z'],
    center: ['M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z', 'M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7', 'M18.6 12a6.6 6.6 0 1 1-13.2 0 6.6 6.6 0 0 1 13.2 0z'],
};
function QuickIcon({ name }) {
    return _jsx("svg", { className: css.qIcon, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false", children: QUICK_ICONS[name].map(d => _jsx("path", { d: d }, d)) });
}
function QuickSwitch({ id, checked, onChange, disabled }) {
    return _jsx("button", { type: "button", role: "switch", className: css.qSwitch, "aria-checked": checked, "aria-labelledby": id, disabled: disabled, onClick: () => onChange?.(!checked) });
}
function QuickPanel(props) {
    const fill = `${(props.spriteScale - 40) / 60 * 100}%`;
    return _jsxs(_Fragment, { children: [_jsxs("div", { className: css.qStage, children: [_jsx("div", { className: css.qFrost, "aria-hidden": "true" }), _jsx("img", { className: css.qArt, src: quickPanelArt, alt: "", draggable: false }), _jsx("h2", { className: css.qTitle, children: "ASTRA \u00B7 \u5FEB\u6377\u8BBE\u7F6E" }), _jsx("button", { type: "button", className: css.qClose, "aria-label": "\u5173\u95ED\u5FEB\u6377\u8BBE\u7F6E", onClick: props.onClose, children: _jsx("svg", { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round", "aria-hidden": "true", children: _jsx("path", { d: "M3.5 3.5l9 9M12.5 3.5l-9 9" }) }) }), _jsxs("div", { className: css.qContent, children: [_jsxs("div", { className: css.qRow, "data-pending": "true", children: [_jsx(QuickIcon, { name: "show" }), _jsx("span", { className: css.qLabel, id: "dot-quick-show", children: "\u663E\u793A ASTRA" }), _jsx(QuickSwitch, { id: "dot-quick-show", checked: false, disabled: true })] }), _jsxs("div", { className: css.qRow, "data-pending": "true", children: [_jsx(QuickIcon, { name: "edge" }), _jsx("span", { className: css.qLabel, id: "dot-quick-edge", children: "\u81EA\u52A8\u8D34\u8FB9" }), _jsx(QuickSwitch, { id: "dot-quick-edge", checked: false, disabled: true })] }), _jsxs("label", { className: `${css.qRow} ${css.qSize}`, children: [_jsx(QuickIcon, { name: "size" }), _jsx("span", { className: css.qLabel, children: "\u7CBE\u7075\u5927\u5C0F" }), _jsxs("output", { className: css.qValue, children: [props.spriteScale, "%"] }), _jsx("input", { className: css.qRange, style: { '--q-fill': fill }, "aria-label": "\u7CBE\u7075\u5927\u5C0F", type: "range", min: 40, max: 100, step: 1, value: props.spriteScale, onChange: event => props.onScale(Number(event.target.value)) })] }), _jsxs("div", { className: css.qRow, children: [_jsx(QuickIcon, { name: "motion" }), _jsx("span", { className: css.qLabel, id: "dot-quick-motion", children: "\u52A8\u6001\u6548\u679C" }), _jsx(QuickSwitch, { id: "dot-quick-motion", checked: props.motion, onChange: props.onMotion })] }), _jsxs("div", { className: css.qRow, children: [_jsx(QuickIcon, { name: "quiet" }), _jsx("span", { className: css.qLabel, id: "dot-quick-quiet", children: "\u514D\u6253\u6270" }), _jsx(QuickSwitch, { id: "dot-quick-quiet", checked: props.quiet, disabled: props.quietDisabled, onChange: props.onQuiet })] }), _jsxs("button", { type: "button", className: `${css.qRow} ${css.qGo}`, onClick: props.onOpenCenter, children: [_jsx(QuickIcon, { name: "center" }), _jsx("span", { className: css.qLabel, children: "\u6253\u5F00\u8BBE\u7F6E\u4E2D\u5FC3" }), _jsx("svg", { className: css.qChev, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: _jsx("path", { d: "M6 3.5L10.5 8 6 12.5" }) })] })] })] }), _jsx("div", { className: css.qFooter, children: props.footer })] });
}
