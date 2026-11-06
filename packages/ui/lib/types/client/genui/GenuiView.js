import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { ErrorBoundary, GenuiActionContext, GenuiBlock, isRenderableProcess, processGenuiSpec } from '@changfenhuang/dsh-genui/embed';
export function parseSpec(value) {
    try {
        const result = processGenuiSpec(value);
        return isRenderableProcess(result) && result.spec ? result.spec : undefined;
    }
    catch {
        return undefined;
    }
}
export function GenuiView({ spec, stateKey, send, readOnly = false }) {
    const [error, setError] = useState('');
    return _jsxs("div", { "data-dot-genui-card": true, style: { minWidth: 0, maxWidth: '100%' }, children: [readOnly && _jsx("small", { children: "\u5386\u53F2\u5361\u7247\u4EC5\u4F9B\u67E5\u770B\uFF1B\u5982\u9700\u7EE7\u7EED\uFF0C\u8BF7\u5728\u4E0B\u65B9\u5BF9\u8BDD\u4E2D\u63D0\u51FA\u3002" }), !readOnly && !send && _jsx("small", { children: "\u672A\u80FD\u786E\u8BA4\u8FD9\u5F20\u5361\u7247\u6240\u5C5E\u7684\u4F1A\u8BDD\uFF0C\u53D1\u9001\u64CD\u4F5C\u5DF2\u505C\u7528\u3002" }), _jsx(ErrorBoundary, { label: "\u4E92\u52A8\u5361\u7247", children: _jsx(GenuiActionContext.Provider, { value: send && !readOnly ? (action, payload) => {
                        setError('');
                        void send(action, payload).catch(() => setError('未能发送，请确认连接后重试。'));
                    } : undefined, children: _jsx(GenuiBlock, { spec: spec, stateKey: stateKey, animateEntrance: false }) }) }), error && _jsx("div", { role: "alert", children: error })] });
}
