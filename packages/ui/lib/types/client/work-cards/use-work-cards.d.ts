import type { WorkCardStore, WorkCardsSnapshot } from './work-card-store.ts';
export declare function useWorkCards(store: WorkCardStore | undefined): WorkCardsSnapshot;
/** “3 分钟前”会自己走：每 30 秒刷新一次当前时间。 */
export declare function useNow(intervalMs?: number): number;
