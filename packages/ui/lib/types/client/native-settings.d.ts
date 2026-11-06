import type { Context } from '@deepseek-ai/cordis';
export declare function nativeSettings(ctx: Context): {
    open(section?: string): void;
    close(): boolean;
    isOpen(): boolean;
};
