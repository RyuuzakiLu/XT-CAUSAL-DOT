import { type ReactElement } from 'react';
import type { WorkCard } from '../work-cards/work-card.ts';
import type { ApprovalBridge } from '../notify/approvals.ts';
export interface WorkCardActionsProps {
    readonly card: WorkCard;
    readonly approvals: ApprovalBridge | undefined;
    readonly onOpen?: (id: string) => void;
    readonly command: (action: string, value: Record<string, unknown>) => Promise<void>;
}
export declare function WorkCardActions({ card, approvals, command, onOpen }: WorkCardActionsProps): ReactElement | null;
