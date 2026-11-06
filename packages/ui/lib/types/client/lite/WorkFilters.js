import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useTabMarker } from "./use-tab-marker.js";
import css from './work-page.module.css';
/** 展示真实工作分组数，切换仅影响列表显示。 */
export function WorkFilters({ value, counts, onChange }) {
    const filters = [
        ['all', '全部', undefined], ['attention', '要你处理', counts.attention], ['active', '进行中', counts.active], ['finished', '已结束', counts.finished],
    ];
    const bar = useTabMarker(value);
    return _jsxs("div", { ref: bar, className: css.filters, role: "tablist", "aria-label": "\u540E\u53F0\u5DE5\u4F5C\u7B5B\u9009", children: [_jsx("span", { className: css.tabMarker, "aria-hidden": "true" }), filters.map(([key, label, count]) => _jsxs("button", { type: "button", role: "tab", "aria-selected": value === key, onClick: () => onChange(key), children: [label, count ? ` ${count}` : ''] }, key))] });
}
