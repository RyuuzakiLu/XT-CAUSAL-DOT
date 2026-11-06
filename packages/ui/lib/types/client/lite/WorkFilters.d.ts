import type { ReactElement } from 'react';
export type WorkFilter = 'all' | 'attention' | 'active' | 'finished';
/** 展示真实工作分组数，切换仅影响列表显示。 */
export declare function WorkFilters({ value, counts, onChange }: {
    value: WorkFilter;
    counts: {
        attention: number;
        active: number;
        finished: number;
    };
    onChange(value: WorkFilter): void;
}): ReactElement;
