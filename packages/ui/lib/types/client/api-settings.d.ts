import type { Context } from '@deepseek-ai/cordis';
export type ApiModelRow = {
    id: string;
    name?: string;
    contextWindow?: number;
    maxTokens?: number;
    input?: ('text' | 'image')[];
    inputModalities?: ('text' | 'image')[];
};
export type ApiDraft = {
    provider: string;
    name: string;
    settingsNs: string;
    path: string[];
    revision: number;
    baseURL: string;
    api: string;
    keyRef: string;
    models: {
        id: string;
        name?: string;
    }[];
    writable: boolean;
};
export type ApiSave = {
    draft: ApiDraft;
    baseURL: string;
    api: string;
    key: string;
    models?: ApiModelRow[];
};
export type ApiSettingsPort = {
    load(): Promise<ApiDraft[]>;
    create(provider: string): Promise<ApiDraft>;
    save(input: ApiSave): Promise<void>;
    discover(input: {
        draft: ApiDraft;
        baseURL: string;
        api: string;
        key: string;
    }): Promise<ApiModelRow[]>;
};
export declare function mergeModelRows(existing: unknown, selected: ApiModelRow[]): Record<string, unknown>[];
export declare function createApiSettingsPort(ctx: Context): ApiSettingsPort;
