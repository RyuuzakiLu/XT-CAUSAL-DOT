import { type ReactElement } from 'react';
/** Login-only decoration. The real shell keeps loading behind it; failures never block access. */
export declare function LiteBoot({ ready, reducedMotion, onStart }: {
    ready: boolean;
    reducedMotion: boolean;
    onStart?(): void;
}): ReactElement | null;
