import { type ArtSources } from './chunks/art-store.ts';
export type ArtworkKind = 'portrait' | 'sprite' | 'docked' | 'seated' | 'studyMobile' | 'studyDesktop';
export type ArtworkSource = {
    src: string;
    alt: string;
};
/** kind → 图源。没有登记（art 块未到）或该 kind 本来没有图时返回 null。 */
export declare function artworkSource(kind: ArtworkKind, sources: ArtSources): ArtworkSource | null;
export declare function ArtSlot({ kind, className }: {
    kind: ArtworkKind;
    className?: string | undefined;
}): import("react").JSX.Element;
