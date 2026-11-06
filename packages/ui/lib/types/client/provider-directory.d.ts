import type { Context } from '@deepseek-ai/cordis';
import type { DotDataModel } from './model.ts';
export declare function safeEndpoint(value: unknown): string | undefined;
export declare function installProviderDirectory(ctx: Context, model: DotDataModel): () => void;
