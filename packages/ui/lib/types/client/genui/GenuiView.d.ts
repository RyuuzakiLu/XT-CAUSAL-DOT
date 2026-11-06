import type { GenuiSpec } from '@changfenhuang/dsh-genui/embed';
export type SendAction = (action: string, payload: Record<string, unknown>) => Promise<void>;
export declare function parseSpec(value: unknown): GenuiSpec | undefined;
export declare function GenuiView({ spec, stateKey, send, readOnly }: {
    spec: GenuiSpec;
    stateKey: string;
    send?: SendAction | undefined;
    readOnly?: boolean;
}): import("react").JSX.Element;
