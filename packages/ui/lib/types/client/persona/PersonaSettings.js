import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
/* 设置中心「人格与称呼」分组：随时改 DOT 的名字、对用户的称呼、性别和人格。
   人设是一个自由写的输入框（dot-persona-brief-2026-10-27）：先预览扩写，满意了（可重写、可手改）再保存；扩写结果在下面直接可改。
   css 由 SettingsOverlay 传入，沿用设置中心的 cSection/cGlass/cHint 等玻璃卡样式。 */
import { useEffect, useState } from 'react';
import { loadPersona, previewPersona, savePersona } from "./persona-api.js";
import { BriefField, ExpandedField, GenderField, Spinner, TextField } from "./PersonaFields.js";
import { usePersonaStyle } from "./persona-style.js";
export function PersonaSettings({ css }) {
    useEffect(() => usePersonaStyle(), []);
    const [view, setView] = useState(null);
    const [loadError, setLoadError] = useState('');
    const [name, setName] = useState('');
    const [userName, setUserName] = useState('');
    const [gender, setGender] = useState('unset');
    const [brief, setBrief] = useState('');
    const [expanded, setExpanded] = useState('');
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [ok, setOk] = useState('');
    const [preview, setPreview] = useState(null);
    const [previewBase, setPreviewBase] = useState('');
    const [previewFor, setPreviewFor] = useState('');
    const adopt = (next) => {
        setView(next);
        setName(next.profile.name);
        setUserName(next.profile.userName);
        setGender(next.profile.gender);
        setBrief(next.profile.brief);
        setExpanded(next.profile.expanded);
        setPreview(null);
    };
    useEffect(() => { loadPersona().then(adopt).catch(cause => setLoadError(cause instanceof Error ? cause.message : String(cause))); }, []);
    if (loadError)
        return _jsxs("p", { className: css.cHint, children: ["\u4EBA\u683C\u8BBE\u5B9A\u53EA\u5728\u4E91\u7AEF DOT \u91CC\u53EF\u7528\uFF0C\u8FD9\u91CC\u6682\u65F6\u8BFB\u4E0D\u5230\uFF1A", loadError] });
    if (!view)
        return _jsxs("p", { className: css.cHint, children: [_jsx(Spinner, {}), " \u6B63\u5728\u8BFB\u53D6\u2026"] });
    const p = view.profile;
    const basicDirty = name.trim() !== p.name || userName.trim() !== p.userName || gender !== p.gender;
    const briefDirty = brief.trim() !== p.brief;
    const textDirty = expanded.trim() !== p.expanded;
    const run = async (kind, patch, done) => {
        if (busy)
            return;
        setBusy(kind);
        setError('');
        setOk('');
        try {
            const next = await savePersona(patch);
            adopt(next);
            if (next.expandError)
                setError(next.expandError);
            else
                setOk(done);
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        }
        finally {
            setBusy('');
        }
    };
    const shownName = name.trim() || view.defaults.name;
    const askPreview = async () => {
        if (busy)
            return;
        if (preview !== null && preview.trim() !== previewBase.trim() && !window.confirm('重新扩写会盖掉你对预览的修改，确定吗？'))
            return;
        const text = brief.trim();
        setBusy('expand');
        setError('');
        setOk('');
        try {
            const out = await previewPersona({ name: shownName, userName: userName.trim(), gender, brief: text });
            setPreview(out);
            setPreviewBase(out);
            setPreviewFor(text);
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        }
        finally {
            setBusy('');
        }
    };
    const savePreview = () => preview !== null && preview.trim() !== '' && void run('text', { name: shownName, userName: userName.trim(), gender, brief: previewFor, expanded: preview.trim(), expandedFromPreview: preview.trim() === previewBase.trim(), expand: false }, '已保存这一版人格，下一句回复起生效。');
    return _jsxs("div", { "data-dotp": "settings", children: [_jsxs("section", { className: css.cSection, children: [_jsx("h2", { className: css.cCaption, children: "\u540D\u5B57\u4E0E\u79F0\u547C" }), _jsxs("div", { className: css.cGlass, children: [_jsx(TextField, { label: "DOT \u7684\u540D\u5B57", note: "\u9ED8\u8BA4\u53EB ASTRA", value: name, max: view.limits.name, placeholder: view.defaults.name, onChange: setName }), _jsx(TextField, { label: "\u5B83\u600E\u4E48\u79F0\u547C\u4F60", note: userName.trim() ? undefined : '不填就叫“你”', value: userName, max: view.limits.userName, placeholder: "\u6BD4\u5982\uFF1A\u963F\u9F99\u3001\u8001\u677F", onChange: setUserName }), _jsx(GenderField, { value: gender, onChange: setGender })] })] }), _jsx("div", { className: "dotp-actions", children: _jsx("button", { type: "button", className: "dotp-btn", "data-primary": basicDirty, "aria-disabled": busy !== '' || !basicDirty, onClick: () => basicDirty && void run('basic', { name: shownName, userName: userName.trim(), gender }, '已保存，下一句回复起生效。'), children: busy === 'basic' ? _jsxs(_Fragment, { children: [_jsx(Spinner, {}), "\u4FDD\u5B58\u4E2D\u2026"] }) : '保存' }) }), _jsxs("section", { className: css.cSection, children: [_jsx("h2", { className: css.cCaption, children: "\u4EBA\u8BBE" }), _jsx("div", { className: css.cGlass, children: _jsx(BriefField, { label: "\u4EBA\u8BBE", note: "\u60F3\u5199\u4EC0\u4E48\u5199\u4EC0\u4E48", value: brief, onChange: setBrief }) })] }), preview === null && _jsxs("div", { className: "dotp-actions", children: [brief.trim() !== '' && _jsx("button", { type: "button", className: "dotp-btn", "data-primary": briefDirty, "aria-disabled": busy !== '', onClick: () => void askPreview(), children: busy === 'expand' ? _jsxs(_Fragment, { children: [_jsx(Spinner, {}), "\u6269\u5199\u4E2D\u2026"] }) : briefDirty ? '预览扩写' : '重新扩写' }), brief.trim() === '' && _jsx("button", { type: "button", className: "dotp-btn", "data-primary": briefDirty, "aria-disabled": busy !== '' || !briefDirty, onClick: () => briefDirty && void run('expand', { brief: '' }, '已清空人设，恢复默认性格。'), children: busy === 'expand' ? _jsxs(_Fragment, { children: [_jsx(Spinner, {}), "\u4FDD\u5B58\u4E2D\u2026"] }) : '保存' })] }), preview === null && briefDirty && brief.trim() !== '' && _jsx("p", { className: css.cHint, children: "\u6539\u4E86\u4EBA\u8BBE\u8981\u5148\u70B9\u201C\u9884\u89C8\u6269\u5199\u201D\u770B\u4E00\u773C\uFF0C\u6EE1\u610F\u4E86\u518D\u4FDD\u5B58\u3002" }), preview !== null && _jsxs(_Fragment, { children: [_jsxs("section", { className: css.cSection, children: [_jsx("h2", { className: css.cCaption, children: "\u6269\u5199\u9884\u89C8 \u00B7 \u8FD8\u6CA1\u4FDD\u5B58" }), _jsxs("div", { className: css.cGlass, children: [_jsx(ExpandedField, { name: shownName, note: "\u6EE1\u610F\u4E86\u518D\u4FDD\u5B58\uFF0C\u4E5F\u53EF\u4EE5\u76F4\u63A5\u6539", value: preview, onChange: setPreview }), brief.trim() !== previewFor && _jsx("p", { className: "dotp-thin", children: "\u4E0A\u9762\u7684\u4EBA\u8BBE\u5728\u9884\u89C8\u4E4B\u540E\u53C8\u6539\u8FC7\u4E86\uFF0C\u70B9\u201C\u91CD\u65B0\u6269\u5199\u201D\u6309\u65B0\u7684\u6765\uFF1B\u76F4\u63A5\u4FDD\u5B58\u7684\u8BDD\uFF0C\u5B58\u7684\u662F\u9884\u89C8\u65F6\u7684\u4EBA\u8BBE\u3002" })] })] }), _jsxs("div", { className: "dotp-actions", children: [_jsx("button", { type: "button", className: "dotp-btn", "aria-disabled": busy !== '', onClick: () => { if (!busy) {
                                    setPreview(null);
                                    setError('');
                                } }, children: "\u4E0D\u8981\u8FD9\u7248" }), _jsx("button", { type: "button", className: "dotp-btn", "aria-disabled": busy !== '', onClick: () => void askPreview(), children: busy === 'expand' ? _jsxs(_Fragment, { children: [_jsx(Spinner, {}), "\u6269\u5199\u4E2D\u2026"] }) : '重新扩写' }), _jsx("button", { type: "button", className: "dotp-btn", "data-primary": "true", "aria-disabled": busy !== '' || preview.trim() === '', onClick: savePreview, children: busy === 'text' ? _jsxs(_Fragment, { children: [_jsx(Spinner, {}), "\u4FDD\u5B58\u4E2D\u2026"] }) : '保存这一版' })] })] }), preview === null && p.expanded !== '' && _jsxs(_Fragment, { children: [_jsxs("section", { className: css.cSection, children: [_jsx("h2", { className: css.cCaption, children: "\u73B0\u5728\u7528\u7684\u5B8C\u6574\u4EBA\u683C" }), _jsx("div", { className: css.cGlass, children: _jsx(ExpandedField, { name: shownName, value: expanded, onChange: setExpanded }) })] }), _jsxs("div", { className: "dotp-actions", children: [textDirty && _jsx("button", { type: "button", className: "dotp-btn", "aria-disabled": busy !== '', onClick: () => setExpanded(p.expanded), children: "\u64A4\u9500\u4FEE\u6539" }), _jsx("button", { type: "button", className: "dotp-btn", "data-primary": textDirty, "aria-disabled": busy !== '' || !textDirty, onClick: () => textDirty && void run('text', { expanded: expanded.trim() }, '修改已保存，下一句回复起生效。'), children: busy === 'text' ? _jsxs(_Fragment, { children: [_jsx(Spinner, {}), "\u4FDD\u5B58\u4E2D\u2026"] }) : '保存修改' })] })] }), error && _jsx("p", { className: "dotp-error", role: "alert", children: error }), ok && _jsx("p", { className: css.cHint, role: "status", children: _jsx("span", { className: "dotp-ok", children: ok }) }), _jsxs("p", { className: css.cHint, children: ["\u8FD9\u4E9B\u53EA\u5BF9\u4F60\u8FD9\u4E2A\u8D26\u53F7\u751F\u6548\u3002\u4EBA\u8BBE\u5199\u597D\u540E\u5148\u9884\u89C8\u6269\u5199\uFF0C\u6EE1\u610F\u4E86\u518D\u4FDD\u5B58\uFF1B\u5B8C\u6574\u4EBA\u683C\u53EF\u4EE5\u76F4\u63A5\u6539\uFF0C", p.expandedEdited ? '现在用的是你改过的版本。' : '改完点“保存修改”就会用新的。'] })] });
}
