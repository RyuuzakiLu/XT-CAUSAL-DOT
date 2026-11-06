/** DOT owns the inline surface; upstream client/Dock/template/toast entry is never loaded. */
import type { Context } from '@deepseek-ai/cordis';
import { type SendAction } from './GenuiView.tsx';
export declare function installGenuiFences(sendTo: (id: string) => SendAction, doc?: Document): () => void;
export declare function installGenui(ctx: Context): void;
