import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/* ================================================================
   人物图占位槽 · 总导游图
   ▍这是什么
   `ArtSlot`：按 kind 取人物图；图还没取到或加载失败时留一个同尺寸的星形占位，
   不会把页面顶塌，也不会因为缺图删掉可点入口。
   ▍为什么单独成文件
   它只依赖 art-store（图源）与图标，不依赖 dot.module.css；设置覆盖层、环形菜单、
   精灵都用它，不该为了一个 <img> 把整份公共皮肤拖进各自的分块。
   ▍修改铁律
   1. 【不】在这里内嵌图片：图源一律由 client.art.js 登记进 art-store。
   2. ⚠️ 图片失败回退只影响外观，不改工作/记忆等业务事实。
   ▍更新记录
   2026-10-25 · 从 visuals.tsx 拆出；图源改为按需块登记，不再静态 import 全表。
   ================================================================ */
import { useState } from 'react';
import { Icon } from "./icons.js";
import { useArtSources } from "./chunks/art-store.js";
/** kind → 图源。没有登记（art 块未到）或该 kind 本来没有图时返回 null。 */
export function artworkSource(kind, sources) {
    if (kind === 'docked')
        return sources.docked === undefined ? null : { src: sources.docked, alt: '' };
    if (kind === 'seated')
        return sources.seated === undefined ? null : { src: sources.seated, alt: '' };
    if (kind === 'sprite')
        return sources.sprite === undefined ? null : { src: sources.sprite, alt: 'ASTRA 待机精灵' };
    return null;
}
/* 空地址不发请求；资源替换后以src为key重新挂载，旧失败状态不会污染新图。 */
export function ArtSlot({ kind, className }) {
    const sources = useArtSources();
    const source = artworkSource(kind, sources);
    return source ? _jsx(ArtworkImage, { src: source.src, alt: source.alt, className: className }, source.src) : _jsxs("span", { className: className, "data-art-placeholder": kind, "aria-hidden": "true", children: [_jsx(Icon, { name: "spark" }), _jsx("i", {}), _jsx("i", {})] });
}
/* 加载坏图时保留构图位置，不让一张素材故障把整个页面顶塌。 */
function ArtworkImage({ src, alt, className }) {
    const [failed, setFailed] = useState(false);
    return failed ? _jsx("span", { className: className, "data-art-placeholder": "unavailable", "aria-hidden": "true", children: _jsx(Icon, { name: "spark" }) }) : _jsx("img", { className: className, src: src, alt: alt, draggable: false, onError: () => setFailed(true), decoding: "async" });
}
