import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/* ================================================================
   DOT 人设表单 · 总导游图
   ▍这是什么
   React 共用字段，引导及设置用同一份表单。名字、称呼、外貌和语气由用户自由写。
   依赖 persona-api 及 brief-fields；不在此保存或请求扩写。
   ▍结构
   基础字段 → 人设分栏 → 完整人格编辑 → 装饰。
   ▍修改铁律
   1. 【不】把灰色例子当真实值；用户没填就是没填。
   2. 分栏只组装 brief，不改预览及保存顺序；少写提示不阻止继续。
   ▍更新记录
   *更新：2026-10-27 · 引导与设置共用自由填写分栏，保留旧正文。*
================================================================ */
import { useId } from 'react';
import { GENDER_OPTIONS, thinHint } from "./persona-api.js";
import { BRIEF_FIELDS, parseBrief, serializeBrief } from "./brief-fields.js";
export function Field({ label, note, children }) {
    return _jsxs("div", { className: "dotp-field", children: [_jsxs("div", { className: "dotp-label", children: [_jsx("span", { children: label }), note !== undefined && _jsx("small", { children: note })] }), children] });
}
export function TextField({ label, note, value, onChange, placeholder, max, autoFocus }) {
    const id = useId();
    return _jsxs("div", { className: "dotp-field", children: [_jsxs("label", { className: "dotp-label", htmlFor: id, children: [_jsx("span", { children: label }), note !== undefined && _jsx("small", { children: note })] }), _jsx("input", { id: id, className: "dotp-input", value: value, maxLength: max, placeholder: placeholder, autoFocus: autoFocus, autoComplete: "off", enterKeyHint: "next", onChange: event => onChange(event.target.value) })] });
}
export function GenderField({ value, onChange }) {
    return _jsx(Field, { label: "DOT \u7684\u6027\u522B", note: "\u5F71\u54CD\u5B83\u8BF4\u8BDD\u7684\u8BED\u6C14", children: _jsx("div", { className: "dotp-seg", role: "group", "aria-label": "DOT \u7684\u6027\u522B", children: GENDER_OPTIONS.map(option => _jsx("button", { type: "button", "aria-pressed": value === option.key, onClick: () => onChange(option.key), children: option.label }, option.key)) }) });
}
/* 分栏仍写回原 brief；只有灰色提示，没有可点选的人设，少写不拦。 */
/* 人格不限长（dot-persona-unlimited-2026-11-01）：人设和完整人格都不设 maxLength、不显示字数上限。 */
export function BriefField({ value, onChange, label = 'DOT 的人设', note = '都可选，按你的想法填写' }) {
    const id = useId();
    const hint = thinHint(value);
    const fields = parseBrief(value);
    return _jsxs("fieldset", { className: "dotp-field", style: { border: 0, padding: 0, margin: 0, minWidth: 0 }, children: [_jsxs("legend", { className: "dotp-label", children: [_jsx("span", { children: label }), _jsx("small", { children: note })] }), BRIEF_FIELDS.map(field => _jsxs("div", { className: "dotp-field", children: [_jsx("label", { className: "dotp-label", htmlFor: `${id}-${field.key}`, children: _jsx("span", { children: field.label }) }), _jsx("textarea", { id: `${id}-${field.key}`, className: "dotp-input", rows: 2, style: { resize: 'vertical', minHeight: 64 }, value: fields[field.key], placeholder: field.placeholder, autoComplete: "off", onChange: event => onChange(serializeBrief({ ...fields, [field.key]: event.target.value })) })] }, field.key)), hint && _jsx("p", { className: "dotp-thin", role: "status", children: hint })] });
}
export function ExpandedField({ value, onChange, name, note = '可以直接改' }) {
    const id = useId();
    return _jsxs("div", { className: "dotp-field", children: [_jsxs("label", { className: "dotp-label", htmlFor: id, children: [_jsxs("span", { children: [name, " \u7684\u5B8C\u6574\u4EBA\u683C"] }), _jsx("small", { children: note })] }), _jsx("textarea", { id: id, className: "dotp-area", value: value, onChange: event => onChange(event.target.value) })] });
}
export function Spinner() {
    return _jsx("span", { className: "dotp-spin", "aria-hidden": "true" });
}
/* 金色星芒徽记（代码画，不引图片） */
export function Emblem() {
    return _jsxs("svg", { className: "dotp-emblem", viewBox: "0 0 64 64", fill: "none", stroke: "currentColor", strokeWidth: "1.3", strokeLinejoin: "round", "aria-hidden": "true", children: [_jsx("circle", { cx: "32", cy: "32", r: "25", strokeOpacity: ".45" }), _jsx("circle", { cx: "32", cy: "32", r: "19", strokeOpacity: ".25", strokeDasharray: "2 4" }), _jsx("path", { d: "M32 9l4.2 18.8L55 32l-18.8 4.2L32 55l-4.2-18.8L9 32l18.8-4.2z", fill: "currentColor", fillOpacity: ".16" }), _jsx("path", { d: "M32 21l1.8 9.2L43 32l-9.2 1.8L32 43l-1.8-9.2L21 32l9.2-1.8z", fill: "currentColor", fillOpacity: ".55" }), _jsx("path", { d: "M50 14l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z", fill: "currentColor" })] });
}
