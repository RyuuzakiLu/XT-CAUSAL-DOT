import { type ReactElement, type ReactNode } from 'react';
import type { PreparingToolCall, StartedToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { type WorkToolMeta, type WorkCard } from './work-card.ts';
import type { WorkCardStore } from './work-card-store.ts';
/** 工具插槽传进来的属性里我们用到的那部分（与 ui-tool 的 ToolCallOwnerProps 结构兼容）。 */
export interface WorkToolOwnerProps {
    readonly callId: string;
    readonly toolName: string;
    readonly phase: 'preparing' | 'start' | 'result';
    readonly block?: PreparingToolCall | StartedToolCall | ToolResultNode;
}
export declare const WORK_TOOL_NAMES: readonly ["work_query", "work_create", "work_cancel", "work_route_adjustment", "work_supplement"];
/** 一次最多在对话里插几张卡；更多的去工作空间看。 */
export declare const MAX_CHAT_CARDS = 3;
export interface WorkToolViewDeps {
    readonly choose?: (ticket: string, readOnly?: boolean) => Promise<{
        selectedId: string;
        targetId: string;
    }>;
    readonly store: WorkCardStore;
    /** 跳到工作空间对应大卡。 */
    readonly open: (id: string) => void;
    /** 简洁版专用：卡下面就地处理（确认 / 拒绝 / 去填写）。经典版不传，小卡和原来一样。 */
    readonly renderActions?: (card: WorkCard) => ReactNode;
    /** 简洁版专用（2026-11-01）：整张卡换成简洁版自己的工作卡。给了就不再画经典小卡和 renderActions。 */
    readonly renderCard?: (card: WorkCard, now: number) => ReactNode;
}
export declare function createWorkToolView(deps: WorkToolViewDeps): (props: WorkToolOwnerProps | {
    history: WorkToolMeta;
}) => ReactElement;
