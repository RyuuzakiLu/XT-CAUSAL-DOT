/* ================================================================
   简洁版品牌 · 名字和图标只在这一个文件里
   ▍这是什么
   简洁版（?ui=lite）界面上给用户看的助手名字，和以后要换上的图标。经典版不读这个文件。
   ▍换图标
   把设计好的图标填进 LITE_ICON（SVG 文本，或 https:/data:/站内绝对路径 /...），重建前端即可：
   - 顶栏标题左边、抽屉顶部会显示它；
   - 浏览器标签页图标（favicon）在简洁版里也换成它。
   留空时只显示文字，标签页图标沿用服务端那枚。
   ▍修改铁律
   1. 只改显示：内部标识、模块名、接口名、后端人设名都不跟着改。
   ▍更新记录
   *更新：2026-10-31 · 首版：ASTRA → 新名字（当时拼写少了个 u），去掉鲸鱼，图标位留空*
   *更新：2026-11-01 · 改正拼写为 Xtcausal dot（用户确认）；图标换成品牌 logo（网关公开素材 /_dot/assets/xtcausal-dot-*.png）*
   ================================================================ */
/** 简洁版里助手的显示名，大小写照用户写的（2026-11-01 用户确认拼写 Xtcausal）。 */
export const LITE_NAME = 'Xtcausal dot';
/** 品牌 logo 的公开地址（网关在登录前就放行的 /_dot/assets/ 白名单素材，透明 PNG）。 */
export const LITE_LOGO = Object.freeze({
    favicon32: '/_dot/assets/xtcausal-dot-32.png',
    icon64: '/_dot/assets/xtcausal-dot-64.png',
    icon192: '/_dot/assets/xtcausal-dot-192.png',
    icon512: '/_dot/assets/xtcausal-dot-512.png',
});
/** 图标：SVG 文本，或图片地址（https: / data: / 站内绝对路径）。空字符串 = 只用文字。 */
export const LITE_ICON = LITE_LOGO.icon64;
/** 图标的可用地址：SVG 文本转成 data: 地址；空的返回 null。 */
export function liteIconUrl(icon = LITE_ICON) {
    const value = icon.trim();
    if (!value)
        return null;
    if (value.startsWith('<svg'))
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(value)}`;
    /* 站内绝对路径只认单个斜杠开头（//host 是协议相对地址，会跑到别的站）。 */
    if (/^\/(?!\/)/.test(value))
        return value;
    return /^(https?:|data:)/.test(value) ? value : null;
}
/** 把一段文案里的 ASTRA 换成简洁版名字。 */
export function liteRename(text) {
    return text.split('ASTRA').join(LITE_NAME);
}
/** 把一份文案表里的 ASTRA 都换掉；原表里的 getter（比如每几秒换一次的等待语）保持是 getter。 */
export function liteRenameCopy(copy) {
    const out = {};
    for (const key of Object.keys(copy)) {
        Object.defineProperty(out, key, {
            enumerable: true,
            get: () => { const value = copy[key]; return typeof value === 'string' ? liteRename(value) : value; },
        });
    }
    return out;
}
