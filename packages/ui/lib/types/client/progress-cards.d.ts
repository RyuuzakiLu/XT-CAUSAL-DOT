import type { Context } from '@deepseek-ai/cordis';
import type { WorkId } from '@xtcausal/dot-contracts';
export declare function watchProgressCards(ctx: Context, open: (id: WorkId) => void): () => void;
