import type { WorkRecord } from './types.ts';
type Fact = Pick<WorkRecord, 'id' | 'owner' | 'status' | 'revision' | 'goal' | 'stage' | 'blocked'> & {
    title?: string;
};
export type Evidence = {
    text: string;
    sourceSessionRef: string;
    sourceMessageId: string;
    explicitWorkId?: string;
    interactionRef?: string;
};
export declare function resolveShadow(actor: string, input: Evidence, facts: readonly Fact[], canReceive: (id: string) => boolean): {
    action: "retry" | "supplement" | "followup" | "new" | "clarify" | "existing-interaction";
    workId: import("@xtcausal/dot-contracts").WorkId | undefined;
    expectedWorkRevision: number | undefined;
    expectedState: import("@xtcausal/dot-contracts").WorkStatus | undefined;
    interactionRef: string | undefined;
    resolutionId: string;
    requiresConfirmation: boolean;
    candidates: {
        workId: import("@xtcausal/dot-contracts").WorkId;
        state: import("@xtcausal/dot-contracts").WorkStatus;
        title: string;
    }[];
};
export {};
