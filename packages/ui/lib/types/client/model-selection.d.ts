import type { ProviderRow } from './model.ts';
export type ModelSelectionPort = {
    rows(): ProviderRow[];
    busy(): boolean;
    session(): Promise<string>;
    select(input: {
        sessionId: string;
        provider: string;
        model: string;
    }): Promise<{
        ok: true;
        value: {
            selected: {
                provider: string;
                model: string;
            };
        };
    } | {
        ok: false;
        error: {
            message: string;
        };
    }>;
    selected(provider: string, model: string): void;
};
export declare function selectDotModel(port: ModelSelectionPort, provider: string, model: string): Promise<string>;
