/* ================================================================
   DOT 图片接入口 · 总导游图
   ▍这是什么
   旧版"kind → 图源"静态表。图源已改由 client.art.js 按需登记到 art-store，
   本文件只保留类型与一个从当前图源推导的只读视图，供旧引用读取。
   ▍为什么留着
   图源登记改到 art-store；直接删本文件会让旧的 `artwork` 引用编译失败。
   新代码请用 art-slot.tsx 的 ArtSlot 或 art-store 的 useArtSources。
   ▍修改铁律
   1. 【不】把图片 base64 写回这里：那等于把三张人物图重新塞回首开。
   ▍更新记录
   *更新：2026-10-23 · 主立绘、精灵与横竖书房四个可选位置*
   *更新：2026-10-25 · 图源改为按需块登记；本文件仅保留类型与推导视图*
================================================================ */
import { getArtSources } from "./chunks/art-store.js";
/** 当前图源推导出的静态表；art 块未到时对应项是 null（调用方回退占位）。 */
export function currentArtwork() {
    const sources = getArtSources();
    return {
        portrait: null,
        docked: sources.docked === undefined ? null : { src: sources.docked, alt: '' },
        seated: sources.seated === undefined ? null : { src: sources.seated, alt: '' },
        sprite: sources.sprite === undefined ? null : { src: sources.sprite, alt: 'ASTRA 待机精灵' },
        studyMobile: null,
        studyDesktop: null,
    };
}
