/* ================================================================
   简洁版 / 经典版切换（2026-10-31）
   ◍ 为什么单独一个文件：简洁版是并行入口，旧界面一行不动。选哪套只在页面加载时定一次，
     DotShell 顶层按它分流，经典版走原来的代码路径。
   ◍ 入口：地址带 ?ui=lite 进简洁版、?ui=classic 回经典版，选择记在本机；
     简洁版「我的」里也能切回经典版。
   ◍ 默认是简洁版（2026-11-01 用户批准）：地址没带 ?ui=、本机也没记过选择 → 简洁版；
     ?ui=classic 或本机记着 classic → 经典版。回滚：把 readUiMode 的默认值改回 'classic'。
   ================================================================ */
export const UI_MODE_KEY = 'xtcausal.dot.ui.v1'
export type UiMode = 'lite' | 'classic'

/** 交付版固定使用 Lite。 */
export const DEFAULT_UI_MODE: UiMode = 'lite'
export function pickUiMode(_asked: string | null, _stored: string | null): UiMode { return 'lite' }
export function readUiMode(): UiMode { return 'lite' }
export function switchUiMode(_mode: UiMode): void {}

/** 简洁版自己的外观偏好（只存本机）：浅色 / 深色 / 跟随系统。 */
export const LITE_PREFS_KEY = 'xtcausal.dot.lite.v1'
export type LiteTheme = 'auto' | 'light' | 'dark'
export type LitePrefs = { theme: LiteTheme }
/* 默认浅色：白底黑字最干净；深色和跟随系统在「设置 › 外观」里换。 */
export const DEFAULT_LITE_PREFS: LitePrefs = { theme: 'light' }

export function readLitePrefs(): LitePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(LITE_PREFS_KEY) ?? '{}') as Partial<LitePrefs>
    return {
      theme: raw.theme === 'light' || raw.theme === 'dark' || raw.theme === 'auto' ? raw.theme : DEFAULT_LITE_PREFS.theme,
    }
  } catch { return { ...DEFAULT_LITE_PREFS } }
}

export function writeLitePrefs(prefs: LitePrefs): void {
  try { localStorage.setItem(LITE_PREFS_KEY, JSON.stringify(prefs)) } catch { /* 本机存不下时只在本次页面生效 */ }
}
