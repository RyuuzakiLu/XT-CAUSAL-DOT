/** 简洁版里助手的显示名，大小写照用户写的（2026-11-01 用户确认拼写 Xtcausal）。 */
export declare const LITE_NAME = "Xtcausal dot";
/** 品牌 logo 的公开地址（网关在登录前就放行的 /_dot/assets/ 白名单素材，透明 PNG）。 */
export declare const LITE_LOGO: Readonly<{
    favicon32: "/_dot/assets/xtcausal-dot-32.png";
    icon64: "/_dot/assets/xtcausal-dot-64.png";
    icon192: "/_dot/assets/xtcausal-dot-192.png";
    icon512: "/_dot/assets/xtcausal-dot-512.png";
}>;
/** 图标：SVG 文本，或图片地址（https: / data: / 站内绝对路径）。空字符串 = 只用文字。 */
export declare const LITE_ICON: "/_dot/assets/xtcausal-dot-64.png";
/** 图标的可用地址：SVG 文本转成 data: 地址；空的返回 null。 */
export declare function liteIconUrl(icon?: string): string | null;
/** 把一段文案里的 ASTRA 换成简洁版名字。 */
export declare function liteRename(text: string): string;
/** 把一份文案表里的 ASTRA 都换掉；原表里的 getter（比如每几秒换一次的等待语）保持是 getter。 */
export declare function liteRenameCopy<T extends object>(copy: T): T;
