import type { ArtworkKind, ArtworkSource } from './art-slot.tsx';
export type { ArtworkKind, ArtworkSource };
/** 当前图源推导出的静态表；art 块未到时对应项是 null（调用方回退占位）。 */
export declare function currentArtwork(): Record<ArtworkKind, ArtworkSource | null>;
