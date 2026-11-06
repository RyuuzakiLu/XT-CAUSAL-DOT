import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/* ================================================================
   DOT API设置面板 · 总导游图
   ▍这是什么
   普通CSS自有表单：当前API、地址、Key更新、模型获取；插件配置另走原生入口。
   ▍修改铁律
   Key永不回显，退出即清草稿；获取列表不会自动覆盖配置，必须明确采纳并保存。
   ▍更新记录
   *更新：2026-10-26 · 首版自有API表单，不依赖新增美术*
   ================================================================ */
import { useEffect, useState } from 'react';
const css = `
[data-dot-api]{color:#efe7d6;display:grid;gap:14px;font-size:15px;line-height:1.5}
[data-dot-api] label{display:grid;gap:6px}[data-dot-api] input,[data-dot-api] select,[data-dot-api] textarea{box-sizing:border-box;width:100%;padding:10px;border:1px solid #d9bc7c66;border-radius:10px;background:#101b2b;color:#efe7d6;font:inherit}
[data-dot-api] button{padding:10px 14px;background:#d9bc7c20;color:#ecd3a0;border:1px solid #d9bc7c70;border-radius:10px;cursor:pointer}[data-dot-api] button:disabled{opacity:.5;cursor:default}
[data-dot-api] small{color:#b7b0a4}[data-dot-api] [role=alert]{color:#ffb9a9}[data-dot-api] .apiActions{display:flex;gap:10px;flex-wrap:wrap}
`;
/* 显式用户动作才读目录、保存或请求模型列表，不偷偷探测远端API。 */
export function ApiSettingsPanel({ port }) {
    const [rows, setRows] = useState([]), [selected, setSelected] = useState(''), [url, setUrl] = useState(''), [api, setApi] = useState(''), [key, setKey] = useState(''), [modelText, setModelText] = useState(''), [dirtyModels, setDirtyModels] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
    const [discovered, setDiscovered] = useState([]);
    const draft = rows.find(x => x.provider === selected);
    const choose = (row) => { setSelected(row.provider); setUrl(row.baseURL); setApi(row.api); setKey(''); setModelText(row.models.map(x => x.id).join('\n')); setDirtyModels(false); setDiscovered([]); setNotice(''); setError(''); };
    const load = async (prefer = selected) => {
        if (!port)
            throw new Error('API配置服务还没就绪');
        const next = await port.load();
        setRows(next);
        const row = next.find(x => x.provider === prefer) ?? next[0];
        if (row)
            choose(row);
    };
    useEffect(() => { let live = true; if (port)
        void port.load().then(next => { if (!live)
            return; setRows(next); if (next[0])
            choose(next[0]); }).catch(cause => { if (live)
            setError(String(cause)); }); return () => { live = false; }; }, [port]);
    const run = async (task) => { setBusy(true); setError(''); setNotice(''); try {
        await task();
    }
    catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
    }
    finally {
        setBusy(false);
    } };
    return _jsxs("section", { "data-dot-api": "", "aria-label": "API\u8FDE\u63A5\u8BBE\u7F6E", children: [_jsx("style", { children: css }), _jsx("p", { children: "API\u5730\u5740\u4E0E\u5BC6\u94A5\u4ECD\u7531\u5F53\u524DDOT\u670D\u52A1\u4FDD\u5B58\uFF0C\u8FD9\u91CC\u4E0D\u53E6\u5EFA\u4E00\u4EFD\u3002\u7559\u7A7A\u5BC6\u94A5\u8868\u793A\u4E0D\u4FEE\u6539\u3002" }), _jsxs("label", { children: ["API\u8FDE\u63A5", _jsx("select", { "aria-label": "API\u8FDE\u63A5", disabled: busy, value: selected, onChange: event => { const row = rows.find(x => x.provider === event.target.value); if (row)
                            choose(row); }, children: rows.map(x => _jsxs("option", { value: x.provider, children: [x.name, " \u00B7 ", x.provider] }, x.provider)) })] }), _jsx("button", { disabled: busy || !port, onClick: () => void run(async () => { const id = prompt('自定义API连接标识（例如 my-provider）'); if (!id)
                    return; const row = await port.create(id.trim()); setRows(old => [...old, row]); choose(row); }), children: "\u6DFB\u52A0API\u8FDE\u63A5" }), !rows.length && _jsx("p", { children: "\u8FD8\u6CA1\u6709\u8BFB\u5230API\u8FDE\u63A5\u3002\u53EF\u4EE5\u91CD\u65B0\u8BFB\u53D6\u5DF2\u5B89\u88C5\u9002\u914D\u5668\u3002" }), draft && _jsxs(_Fragment, { children: [_jsxs("label", { children: ["\u670D\u52A1\u5730\u5740", _jsx("input", { "aria-label": "API\u670D\u52A1\u5730\u5740", value: url, disabled: busy, onChange: e => setUrl(e.target.value), autoComplete: "off" })] }), _jsxs("label", { children: ["\u8C03\u7528\u534F\u8BAE", _jsxs("select", { "aria-label": "API\u8C03\u7528\u534F\u8BAE", value: api, disabled: busy || draft.settingsNs !== 'llm-pi-ai', onChange: e => setApi(e.target.value), children: [_jsx("option", { value: "", children: "\u6CBF\u7528\u5F53\u524D\u9002\u914D\u5668" }), _jsx("option", { value: "openai-completions", children: "OpenAI Chat\u517C\u5BB9" }), _jsx("option", { value: "openai-responses", children: "OpenAI Responses" }), _jsx("option", { value: "anthropic-messages", children: "Anthropic Messages" })] })] }), _jsx("small", { children: "\u534F\u8BAE\u7531\u670D\u52A1\u5546\u63A5\u53E3\u51B3\u5B9A\uFF1B\u6A21\u578B\u540D\u79F0\u53EA\u7528\u4E8E\u663E\u793A\u8BC6\u522B\uFF0C\u4E0D\u66FF\u4F60\u6539\u534F\u8BAE\u3002" }), _jsxs("label", { children: ["\u66F4\u65B0API\u5BC6\u94A5", _jsx("input", { "aria-label": "\u66F4\u65B0API\u5BC6\u94A5", type: "password", value: key, autoComplete: "new-password", disabled: busy, placeholder: "\u7559\u7A7A\u4FDD\u6301\u5DF2\u6709\u5BC6\u94A5", onChange: e => setKey(e.target.value) })] }), _jsxs("label", { children: ["\u6A21\u578B\u8BF7\u6C42\u540D\u79F0\uFF08\u6BCF\u884C\u4E00\u4E2A\uFF09", _jsx("textarea", { "aria-label": "\u6A21\u578B\u8BF7\u6C42\u540D\u79F0", rows: 5, value: modelText, disabled: busy, onChange: e => { setModelText(e.target.value); setDirtyModels(true); } })] }), _jsxs("div", { className: "apiActions", children: [_jsx("button", { disabled: busy || !port, onClick: () => void run(async () => { const found = await port.discover({ draft, baseURL: url, api, key }); setDiscovered(found); setModelText(found.map(x => x.id).join('\n')); setDirtyModels(true); setNotice(`获取到${found.length}个模型，核对后点击保存才会采纳。`); }), children: "\u83B7\u53D6\u6A21\u578B\u5217\u8868" }), _jsx("button", { disabled: busy || !port || !draft.writable, onClick: () => void run(async () => { const models = modelText.split(/\r?\n/).map(x => x.trim()).filter(Boolean); if (dirtyModels && (!models.length || new Set(models).size !== models.length))
                                    throw new Error('模型列表不能为空，也不能重复'); await port.save({ draft, baseURL: url, api, key, ...dirtyModels ? { models: models.map(id => discovered.find(row => row.id === id) ?? { id }) } : {} }); setKey(''); await load(draft.provider); setNotice('API配置已保存；尚未发起模型对话测试。'); }), children: "\u4FDD\u5B58API\u914D\u7F6E" })] })] }), _jsx("button", { disabled: busy || !port, onClick: () => void run(() => load()), children: "\u91CD\u65B0\u8BFB\u53D6API\u914D\u7F6E" }), busy && _jsx("p", { role: "status", children: "\u6B63\u5728\u5904\u7406API\u8BBE\u7F6E\u2026" }), notice && _jsx("p", { role: "status", children: notice }), error && _jsx("p", { role: "alert", children: error })] });
}
