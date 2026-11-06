import type { Context } from '@deepseek-ai/cordis';
import { zh } from './locales.ts';
export declare const inject: string[];
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        dot: keyof typeof zh;
    }
}
declare global {
    interface Window {
        dotBack?: () => boolean;
    }
}
export declare function apply(ctx: Context): void;
