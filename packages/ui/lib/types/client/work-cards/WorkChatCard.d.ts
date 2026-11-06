import { type ReactElement } from 'react';
import { type WorkCard, type WorkCardStatus, type WorkCardStep } from './work-card.ts';
export interface WorkChatCardProps {
    readonly card: WorkCard;
    readonly now: number;
    readonly onOpen?: (id: string) => void;
    /** 这张卡是怎么来的：问进度拉出来的 / 刚交代的新工作 / 取消的。 */
    readonly origin?: 'progress' | 'created' | 'cancelled';
}
/** 阶段线最多画 5 个点：步骤更多时取当前步附近的一段，和工作空间主卡一致。 */
export declare function visibleSteps(steps: readonly WorkCardStep[], max?: number): readonly WorkCardStep[];
export declare function WorkChatCard({ card, now, onOpen, origin }: WorkChatCardProps): ReactElement;
export interface WorkCandidatesProps {
    readonly candidates: readonly {
        readonly id: string;
        readonly title: string;
        readonly status: WorkCardStatus;
        readonly stage: string;
        readonly ticket?: string;
    }[];
    readonly onOpen?: (id: string) => void;
    readonly onChoose?: ((ticket: string, readOnly?: boolean) => Promise<{
        selectedId: string;
        targetId: string;
    }>) | undefined;
}
export declare function WorkCandidates({ candidates, onOpen, onChoose }: WorkCandidatesProps): ReactElement;
/** 工具还在跑时的占位行：按结果卡的高度预留一半，结果到了不会大跳。 */
export declare function WorkChatPending({ label }: {
    readonly label: string;
}): ReactElement;
