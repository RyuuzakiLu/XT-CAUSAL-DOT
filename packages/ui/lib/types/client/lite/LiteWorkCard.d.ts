import { type ReactElement, type ReactNode } from 'react';
import type { WorkCard } from '../work-cards/work-card.ts';
import type { WorkRow } from '../model.ts';
export type LiteCardKind = 'attention' | 'active' | 'done' | 'failed' | 'idle';
export interface LiteCardView {
    readonly id: string;
    readonly title: string;
    readonly status: string;
    readonly doing: string;
    readonly updatedAt: string;
    /** 0–100；只在后端给了时有。 */
    readonly progress?: number;
    readonly position?: {
        readonly current: number;
        readonly total: number;
    };
    readonly steps: readonly {
        readonly index: number;
        readonly label: string;
        readonly status: string;
    }[];
    readonly attention?: {
        readonly kind: 'input' | 'approval';
        readonly message: string;
    };
    readonly error?: string;
    readonly artifactCount: number;
}
export declare function liteCardKind(status: string): LiteCardKind;
export declare const liteCardLabel: (status: string) => string;
/** 进度统一成 0–100：后端行里是 0–1，工作卡里已经是 0–100。 */
export declare function percent(value: number | undefined): number | undefined;
export declare function viewOfCard(card: WorkCard): LiteCardView;
export declare function viewOfRow(row: WorkRow): LiteCardView;
/** 顶栏实时状态（竞品报告第 6 条）：「正在做 2 件 · 1 件等你」；没有工作时为空（顶栏只留名字）。 */
export declare function liveWorkLine(running: number, waiting: number): string;
export declare function ago(value: string | undefined, now: number): string;
export interface LiteWorkCardProps {
    readonly view: LiteCardView;
    readonly now: number;
    readonly onOpen?: (id: string) => void;
    /** 工作列表统一收成一行，点开进入完整详情。 */
    readonly inline?: boolean;
    readonly compact?: boolean;
    /** 要你处理时的按钮（批准 / 拒绝 / 去填写 / 补一句），由调用方给。 */
    readonly actions?: ReactNode;
}
export declare function LiteWorkCard({ view, now, onOpen, actions, inline, compact }: LiteWorkCardProps): ReactElement;
