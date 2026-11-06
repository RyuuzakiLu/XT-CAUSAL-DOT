import { type ReactElement } from 'react';
import type { PreparingToolCall, StartedToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-ui-conversation/client';
export interface MemoryToolOwnerProps {
    readonly callId: string;
    readonly toolName: string;
    readonly phase: 'preparing' | 'start' | 'result';
    readonly block?: PreparingToolCall | StartedToolCall | ToolResultNode;
}
export declare const MEMORY_CARD_TOOL_NAMES: readonly ["dot_memory_search"];
export interface MemoryCardHit {
    readonly id: string;
    readonly text: string;
    readonly updatedAt?: number;
    readonly tier?: string;
}
export interface MemoryCardMeta {
    readonly query: string;
    readonly mode: string | null;
    readonly count: number;
    readonly hits: readonly MemoryCardHit[];
}
/** 认识就返回卡片数据，不认识返回 null（调用方退回纯文字）。 */
export declare function readMemoryToolMeta(meta: unknown): MemoryCardMeta | null;
export declare function MemoryToolView(props: MemoryToolOwnerProps): ReactElement;
