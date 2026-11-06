import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Icon } from "./icons.js";
import css from './dot.module.css';
export { Icon } from "./icons.js";
export { ArtSlot, artworkSource } from "./art-slot.js";
/* 标题只解释空间用途，不生成工作计数或虚构服务已接通。 */
export function SpaceHeading({ space, title, description }) {
    return _jsxs("header", { className: css.spaceHeading, children: [_jsx("span", { className: css.spaceEmblem, children: _jsx(Icon, { name: space }) }), _jsxs("div", { children: [_jsxs("span", { className: css.eyebrow, children: ["ASTRA / ", space.toUpperCase()] }), _jsx("h1", { children: title }), _jsx("p", { children: description })] })] });
}
/* 空态是阅读引导而非示例数据，不能往业务列表里塞假工作。 */
export function EmptyState({ space, title, description }) {
    return _jsxs("div", { className: css.emptyState, children: [_jsx("span", { children: _jsx(Icon, { name: space }) }), _jsx("strong", { children: title }), _jsx("p", { children: description })] });
}
