import { type ReactElement } from 'react';
import type { LetterRow } from '../model.ts';
import type { LoggedNotice } from './notice-log.ts';
type Category = 'attention' | 'proactive' | 'work' | 'system';
export type MessageEntry = {
    key: string;
    title: string;
    text: string;
    at: number;
    read: boolean;
    category: Category;
    tone: 'attention' | 'failed' | 'done' | 'proactive' | 'system';
    workId?: string;
    letter?: LetterRow;
    notice?: LoggedNotice;
};
/** 仅按事件真实字段分类；旧本机记录不属于可验证账号，不参与消息流。 */
export declare function messageEntries(letters: readonly LetterRow[], notices: readonly LoggedNotice[], archived?: boolean): MessageEntry[];
/** 实际工作已向前推进，且状态更新时间晚于这条等待消息时，才能自动标读。 */
export declare function handledAttentionIds(letters: readonly LetterRow[], works: readonly {
    id: string;
    status: string;
    updatedAt: string;
}[]): string[];
export declare function MessagesView({ letters, notices, loading, selectedNoticeId, now, onOpen, onRead, onReadAll, onArchive, onRetry, hideReadAll }: {
    letters: readonly LetterRow[];
    notices: readonly LoggedNotice[];
    loading: boolean;
    selectedNoticeId?: string | null;
    now?: number;
    onOpen(entry: MessageEntry): void;
    onRead(entry: MessageEntry): void;
    onReadAll(entries: readonly MessageEntry[]): Promise<string | void>;
    onArchive(letter: LetterRow): Promise<void>;
    onRetry(letter: LetterRow): Promise<void>;
    hideReadAll?: boolean;
}): ReactElement;
export {};
