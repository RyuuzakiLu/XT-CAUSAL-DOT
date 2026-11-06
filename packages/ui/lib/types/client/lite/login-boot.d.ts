/** UX hint only, never an authentication signal. Keep key in sync with scripts/dot-login-page.mjs. */
export declare const LOGIN_BOOT_KEY = "dot.login.boot.pending";
export declare const LOGIN_BOOT_MAX_AGE_MS = 120000;
type BootStorage = Pick<Storage, 'getItem' | 'removeItem'>;
export declare function clearLoginBoot(storage?: BootStorage): void;
/** Consume before showing: refresh, remounts, Back/Forward and old/invalid hints never replay. */
export declare function consumeLoginBoot(storage?: BootStorage, now?: number, navigationType?: string): boolean;
/** Optional pre-shell owner injected by dot-web-brand; keeps the same video across plugin loading. */
declare global {
    interface Window {
        __dotLoginBoot?: {
            claim(): boolean;
            update(ready: boolean, reducedMotion: boolean): void;
        };
    }
}
export {};
