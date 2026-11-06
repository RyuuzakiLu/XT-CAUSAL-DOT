import type { LetterRow } from './model.ts';
export declare const TODO_ID_PREFIX = "zhixu-task:";
/** dotPostbox.list 里一条信的最小形状（只列这里用到的字段）。 */
export interface PostboxListItem {
    readonly id: string;
    readonly kind?: string | undefined;
    readonly dedupeKey?: string | undefined;
    readonly title: string;
    readonly body?: string | undefined;
    readonly read: boolean;
    readonly archived: boolean;
    readonly createdAt: number;
    readonly updatedAt?: number | undefined;
    readonly severity?: string | undefined;
    readonly workId?: string | undefined;
    readonly deliveries: readonly {
        readonly channel: string;
        readonly status: string;
    }[];
    readonly todo?: unknown;
}
/** 投递摘要中只把真实 failed 状态视作失败；suppressed 不算失败。 */
export declare function deliveryFailed(delivery: string | undefined): boolean;
/** 一条信 → 界面行。 */
export declare function letterRowOf(event: PostboxListItem): LetterRow;
