import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/* 新账号第一次登录的引导页：给 DOT 起名、定称呼、定性别、（可选）一段自由写的人设。
   只在后端说 needsOnboarding 时出现：上线前就有的账号、本地 DOT、接口读不到时都不出现。
   写了人设就先让模型按模板扩写（不保存），第二步给用户预览，可以重写或手改，满意了再一起保存。 */
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { loadPersona, previewPersona, savePersona } from "./persona-api.js";
import { BriefField, Emblem, ExpandedField, GenderField, Spinner, TextField } from "./PersonaFields.js";
import { usePersonaStyle } from "./persona-style.js";
function Onboarding({ initial, onDone }) {
    const [step, setStep] = useState('basic');
    const [name, setName] = useState(initial.profile.name || initial.defaults.name);
    const [userName, setUserName] = useState(initial.profile.userName);
    const [gender, setGender] = useState('');
    const [brief, setBrief] = useState(initial.profile.brief);
    const [expanded, setExpanded] = useState('');
    const [previewed, setPreviewed] = useState('');
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const root = useRef(null);
    const limits = initial.limits;
    const shownName = name.trim() || initial.defaults.name;
    useEffect(() => {
        const previous = document.activeElement;
        const trap = (event) => {
            if (event.key !== 'Tab' || !root.current)
                return;
            const items = Array.from(root.current.querySelectorAll('button,input,textarea')).filter(node => node.offsetParent !== null);
            const first = items[0], last = items.at(-1);
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
            }
            else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
            }
        };
        document.addEventListener('keydown', trap, true);
        return () => { document.removeEventListener('keydown', trap, true); if (previous?.isConnected)
            previous.focus(); };
    }, []);
    useEffect(() => { root.current?.scrollTo({ top: 0 }); }, [step]);
    const missing = userName.trim() === '' ? '写一下它该怎么称呼你' : gender === '' ? '选一下 DOT 的性别' : '';
    const draft = () => ({ name: shownName, userName: userName.trim(), gender: gender, brief: brief.trim() });
    /* dot-persona-brief-2026-10-27：写了人设就先只扩写不保存，下一步给用户看；满意了才一起存。没写人设直接保存。 */
    const submit = async () => {
        if (busy)
            return;
        if (missing) {
            setError(missing);
            return;
        }
        setError('');
        if (brief.trim() === '') {
            setBusy('save');
            try {
                await savePersona({ ...draft(), onboarding: true });
                onDone();
            }
            catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause));
            }
            finally {
                setBusy('');
            }
            return;
        }
        setBusy('expand');
        try {
            const text = await previewPersona(draft());
            setExpanded(text);
            setPreviewed(text);
            setStep('review');
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        }
        finally {
            setBusy('');
        }
    };
    const regenerate = async () => {
        if (busy)
            return;
        if (expanded.trim() !== previewed.trim() && !window.confirm('重新扩写会盖掉你刚才的修改，确定吗？'))
            return;
        setError('');
        setBusy('expand');
        try {
            const text = await previewPersona(draft());
            setExpanded(text);
            setPreviewed(text);
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        }
        finally {
            setBusy('');
        }
    };
    const finish = async () => {
        if (busy)
            return;
        if (expanded.trim() === '') {
            setError('完整人格是空的，可以点“重新扩写”，或者返回改人设');
            return;
        }
        setError('');
        setBusy('finish');
        try {
            await savePersona({ ...draft(), expanded: expanded.trim(), expandedFromPreview: expanded.trim() === previewed.trim(), expand: false, onboarding: true });
            onDone();
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
            setBusy('');
        }
    };
    return _jsx("div", { className: "dotp-onboard", "data-dotp": "onboard", ref: root, role: "dialog", "aria-modal": "true", "aria-labelledby": "dotp-title", children: _jsxs("form", { className: "dotp-card", onSubmit: event => { event.preventDefault(); void (step === 'basic' ? submit() : finish()); }, children: [_jsx(Emblem, {}), _jsx("p", { className: "dotp-kicker", children: "XTCAUSAL DOT" }), _jsxs("div", { className: "dotp-steps", "aria-hidden": "true", children: [_jsx("i", { "data-on": "true" }), _jsx("i", { "data-on": step === 'review' })] }), step === 'basic' ? _jsxs(_Fragment, { children: [_jsx("h1", { className: "dotp-title", id: "dotp-title", children: "\u521D\u6B21\u89C1\u9762" }), _jsx("p", { className: "dotp-sub", children: "\u5148\u7ED9\u4F60\u7684 DOT \u5B9A\u51E0\u4EF6\u4E8B\u3002\u53EA\u5BF9\u4F60\u8FD9\u4E2A\u8D26\u53F7\u751F\u6548\uFF0C\u4EE5\u540E\u5728\u8BBE\u7F6E\u91CC\u968F\u65F6\u80FD\u6539\u3002" }), _jsx(TextField, { label: "DOT \u7684\u540D\u5B57", note: "\u9ED8\u8BA4\u53EB ASTRA", value: name, max: limits.name, placeholder: initial.defaults.name, onChange: setName }), _jsx(TextField, { label: "\u5B83\u8BE5\u600E\u4E48\u79F0\u547C\u4F60", value: userName, max: limits.userName, placeholder: "\u6BD4\u5982\uFF1A\u963F\u9F99\u3001\u8001\u677F\u3001\u4F60\u7684\u540D\u5B57", onChange: setUserName, autoFocus: true }), _jsx(GenderField, { value: gender, onChange: setGender }), _jsx(BriefField, { value: brief, onChange: setBrief }), _jsx("p", { className: "dotp-hint", children: brief.trim() ? '下一步先让模型按你写的扩写成完整人格给你看，满意了再保存，也可以重写或者手改。' : '人设不写也行，它会用默认的性格和你聊。' }), error && _jsx("p", { className: "dotp-error", role: "alert", children: error }), _jsx("div", { className: "dotp-actions", children: _jsx("button", { type: "submit", className: "dotp-btn", "data-primary": "true", "aria-disabled": busy !== '', children: busy ? _jsxs(_Fragment, { children: [_jsx(Spinner, {}), busy === 'expand' ? '正在扩写…' : '正在保存…'] }) : brief.trim() ? '预览扩写' : '保存，开始' }) })] }) : _jsxs(_Fragment, { children: [_jsxs("h1", { className: "dotp-title", id: "dotp-title", children: ["\u8FD9\u662F ", shownName] }), _jsx("span", { className: "dotp-preview-tag", children: "\u9884\u89C8 \u00B7 \u8FD8\u6CA1\u4FDD\u5B58" }), _jsx("p", { className: "dotp-sub", children: "\u6309\u4F60\u5199\u7684\u4EBA\u8BBE\u6269\u5199\u51FA\u6765\u7684\u5B8C\u6574\u4EBA\u683C\u3002\u54EA\u91CC\u4E0D\u50CF\u5C31\u76F4\u63A5\u6539\uFF0C\u6216\u8005\u8BA9\u5B83\u91CD\u5199\u4E00\u7248\uFF1B\u70B9\u201C\u5C31\u8FD9\u6837\uFF0C\u4FDD\u5B58\u201D\u624D\u4F1A\u751F\u6548\u3002" }), _jsx(ExpandedField, { name: shownName, value: expanded, onChange: setExpanded }), error && _jsx("p", { className: "dotp-error", role: "alert", children: error }), _jsxs("div", { className: "dotp-actions", children: [_jsx("button", { type: "button", className: "dotp-btn", "aria-disabled": busy !== '', onClick: () => { if (!busy) {
                                        setError('');
                                        setStep('basic');
                                    } }, children: "\u8FD4\u56DE\u6539\u4EBA\u8BBE" }), _jsx("button", { type: "button", className: "dotp-btn", "aria-disabled": busy !== '', onClick: () => void regenerate(), children: busy === 'expand' ? _jsxs(_Fragment, { children: [_jsx(Spinner, {}), "\u6B63\u5728\u91CD\u5199\u2026"] }) : '重新扩写' }), _jsx("button", { type: "submit", className: "dotp-btn", "data-primary": "true", "aria-disabled": busy !== '', children: busy === 'finish' ? _jsxs(_Fragment, { children: [_jsx(Spinner, {}), "\u6B63\u5728\u4FDD\u5B58\u2026"] }) : '就这样，保存' })] })] })] }) });
}
/** 由 client/index.ts 的 ctx.effect 调用；返回卸载函数。 */
export function installPersonaOnboarding() {
    let disposed = false;
    let cleanup = () => { };
    void loadPersona().then(view => {
        if (disposed || !view?.needsOnboarding)
            return;
        const releaseStyle = usePersonaStyle();
        const host = document.createElement('div');
        host.setAttribute('data-dot-persona-onboarding', '');
        document.body.appendChild(host);
        const reactRoot = createRoot(host);
        let closed = false;
        const close = () => {
            if (closed)
                return;
            closed = true;
            reactRoot.unmount();
            host.remove();
            releaseStyle();
        };
        cleanup = close;
        reactRoot.render(_jsx(Onboarding, { initial: view, onDone: close }));
    }).catch(() => { });
    return () => { disposed = true; cleanup(); };
}
