export declare const UI_MODE_KEY = "xtcausal.dot.ui.v1";
export type UiMode = 'lite' | 'classic';
/** 交付版固定使用 Lite。 */
export declare const DEFAULT_UI_MODE: UiMode;
export declare function pickUiMode(_asked: string | null, _stored: string | null): UiMode;
export declare function readUiMode(): UiMode;
export declare function switchUiMode(_mode: UiMode): void;
/** 简洁版自己的外观偏好（只存本机）：浅色 / 深色 / 跟随系统。 */
export declare const LITE_PREFS_KEY = "xtcausal.dot.lite.v1";
export type LiteTheme = 'auto' | 'light' | 'dark';
export type LitePrefs = {
    theme: LiteTheme;
};
export declare const DEFAULT_LITE_PREFS: LitePrefs;
export declare function readLitePrefs(): LitePrefs;
export declare function writeLitePrefs(prefs: LitePrefs): void;
