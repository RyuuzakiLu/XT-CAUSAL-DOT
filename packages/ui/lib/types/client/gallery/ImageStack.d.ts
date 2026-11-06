import { type ReactNode } from 'react';
export interface StackAttachment {
    attachmentId: string;
    name?: string;
    width?: number;
    height?: number;
    [k: string]: unknown;
}
export interface StackImage {
    attachment?: StackAttachment;
    preview?: {
        url: string;
        name?: string;
        width?: number;
        height?: number;
    };
    label?: string;
}
export type StackLoader = ((attachment: StackAttachment) => Promise<string | undefined>) & {
    peek?: (attachment: StackAttachment) => string | undefined;
};
export interface ImageSlotProps {
    images: readonly StackImage[];
    loadImage: StackLoader;
    align?: string;
    compact?: boolean;
    thumbnail?: boolean;
    renderFactorySlot?: (name: string, props: Record<string, unknown>) => ReactNode;
}
/** 槽组件：缩略图模式交还原生，其余画 DOT 图集。 */
export declare function DotImageStack(props: ImageSlotProps): ReactNode;
