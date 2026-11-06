/** UX hint only, never an authentication signal. Keep key in sync with scripts/dot-login-page.mjs. */
export const LOGIN_BOOT_KEY = 'dot.login.boot.pending'
export const LOGIN_BOOT_MAX_AGE_MS = 120_000

type BootStorage = Pick<Storage, 'getItem' | 'removeItem'>

export function clearLoginBoot(storage?: BootStorage): void {
  try { (storage ?? window.sessionStorage).removeItem(LOGIN_BOOT_KEY) } catch { /* Storage is optional. */ }
}

/** Consume before showing: refresh, remounts, Back/Forward and old/invalid hints never replay. */
export function consumeLoginBoot(storage?: BootStorage, now = Date.now(), navigationType?: string): boolean {
  try {
    const target = storage ?? window.sessionStorage
    const raw = target.getItem(LOGIN_BOOT_KEY)
    target.removeItem(LOGIN_BOOT_KEY)
    const navigation = navigationType ?? (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type
    if (navigation === 'reload' || navigation === 'back_forward' || !raw) return false
    const at = Number(raw)
    return Number.isFinite(at) && at > 0 && now >= at && now - at <= LOGIN_BOOT_MAX_AGE_MS
  } catch { return false }
}

/** Optional pre-shell owner injected by dot-web-brand; keeps the same video across plugin loading. */
declare global {
  interface Window {
    __dotLoginBoot?: { claim(): boolean; update(ready: boolean, reducedMotion: boolean): void }
  }
}
