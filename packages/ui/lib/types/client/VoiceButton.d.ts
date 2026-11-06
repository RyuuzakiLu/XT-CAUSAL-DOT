import type { PropsLocale, InjectFace } from '@deepseek-ai/dsh-client-ui-slots';
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client';
export type VoiceFace = {
    recognize(): Promise<string>;
};
export type VoiceProps = InjectFace<VoiceFace> & PropsLocale<'dot'> & {
    inputActions: InputActions;
};
export declare const LITE_ATTACH_ACCEPT = "";
export declare const LITE_IMAGE_ACCEPT = "image/*";
export declare function VoiceButton(_props: VoiceProps): import("react").JSX.Element;
