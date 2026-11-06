import { type StackLoader } from './gallery/ImageStack.tsx';
import type { MountImages } from './session-chain.ts';
export type AttachmentResult = {
    ok: true;
    value: {
        attachment: {
            mediaType?: string;
        };
        data: string;
    };
} | {
    ok: false;
    error: {
        code?: string;
        message?: string;
    };
};
export type AttachmentFn = (request: {
    sessionId: string;
    attachmentId: string;
}) => Promise<AttachmentResult>;
/** 按来源会话取图的 loader（带同步 peek，图集首帧就能直接用缓存）。 */
export declare function createChainImageLoader(attachment: AttachmentFn, sessionId: string, cache?: Map<string, Promise<string>>, ready?: Map<string, string>): StackLoader;
/** 前文图片挂载器：每条消息一个 React 根，画 DOT 图集。 */
export declare function createChainImageMounter(attachment: AttachmentFn): MountImages;
