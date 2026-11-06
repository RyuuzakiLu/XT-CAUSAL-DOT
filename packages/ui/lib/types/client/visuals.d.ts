import type { Space } from './view-store.ts';
export { Icon, type IconName } from './icons.tsx';
export { ArtSlot, artworkSource, type ArtworkKind, type ArtworkSource } from './art-slot.tsx';
export declare function SpaceHeading({ space, title, description }: {
    space: Space;
    title: string;
    description: string;
}): import("react").JSX.Element;
export declare function EmptyState({ space, title, description }: {
    space: Space;
    title: string;
    description: string;
}): import("react").JSX.Element;
