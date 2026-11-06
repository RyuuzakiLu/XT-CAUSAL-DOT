import type { Context } from '@deepseek-ai/cordis';
import type { DotDataModel, DataPort } from './model.ts';
import type { DotLive } from './notify/live-runtime.ts';
export declare function installBusiness(ctx: Context, model: DotDataModel, setPort: (port: DataPort) => void, openCard: (id: string) => void, live?: DotLive): () => Promise<void>;
