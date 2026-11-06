import { type ReactElement } from 'react';
import { type CalEvent, type MonthRef } from './calendar.ts';
import { type CalTasks } from './calendar.ts';
type Loader = (ref: MonthRef) => Promise<{
    items: CalEvent[];
    truncated: boolean;
}>;
type MonthState = {
    status: 'loading';
} | {
    status: 'ready';
    items: CalEvent[];
    truncated: boolean;
} | {
    status: 'error';
    message: string;
};
export type MonthCache = Record<string, Extract<MonthState, {
    status: 'ready';
}>>;
export declare function LiteCalendar({ monthCache, now, load, loadTasks }: {
    monthCache?: MonthCache;
    now?: number;
    load?: Loader;
    loadTasks?: () => Promise<CalTasks>;
}): ReactElement;
export {};
