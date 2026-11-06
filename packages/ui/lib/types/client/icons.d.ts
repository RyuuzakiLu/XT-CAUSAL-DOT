import type { Space } from './view-store.ts';
export type IconName = Space | 'spark' | 'arrow' | 'attachment' | 'voice' | 'send' | 'orbit';
export declare function Icon({ name, className }: {
    name: IconName;
    className?: string | undefined;
}): import("react").JSX.Element;
