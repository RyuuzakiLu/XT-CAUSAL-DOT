import { type ReactElement, type ReactNode } from 'react';
import type { DotProps } from '../DotShell.tsx';
import type { WorkRow, DataSnapshot } from '../model.ts';
import type { WorkCard } from '../work-cards/work-card.ts';
import { type LitePrefs } from './ui-mode.ts';
export type LiteProps = DotProps & {
    renderSettings(): ReactNode;
};
type Tab = 'chat' | 'work' | 'postbox' | 'calendar' | 'notices' | 'memory' | 'me';
/** 工作列表的一行：实时卡片优先（推送最新），没有时用快照里的 WorkRow。 */
type Item = {
    id: string;
    title: string;
    status: string;
    doing: string;
    updatedAt: string;
    createdAt?: string | undefined;
    progress?: number | undefined;
    card?: WorkCard | undefined;
    row?: WorkRow | undefined;
};
export declare function mergeWorks(cards: Readonly<Record<string, WorkCard>>, order: readonly string[], rows: readonly WorkRow[]): Item[];
export declare const needsYou: (item: Item) => boolean;
export declare function LiteShell(props: LiteProps): ReactElement;
type WorkGroup = 'attention' | 'active' | 'finished';
type Ctx = {
    props: LiteProps;
    data: DataSnapshot;
    live: LiteProps['live'];
    items: Item[];
    waiting: Item[];
    running: Item[];
    finished: Item[];
    unseen: number;
    unreadNotices: number;
    prefs: LitePrefs;
    setPrefs(patch: Partial<LitePrefs>): void;
    theme: 'light' | 'dark';
    tab: Tab;
    go(tab: Tab): void;
    goWork(group: WorkGroup): void;
    workFocus: WorkGroup | null;
    clearWorkFocus(): void;
    setSheet(sheet: null | 'create'): void;
    openDrawer(): void;
};
/** 左侧抽屉：所有去处都在这里（原来底栏 + 精灵菜单里的事）。 */
export declare function Drawer({ ctx, open, close }: {
    ctx: Ctx;
    open?: boolean;
    close(): void;
}): ReactElement;
export declare function WorkPage({ ctx }: {
    ctx: Ctx;
}): ReactElement;
export declare function WorkDetail({ ctx, id }: {
    ctx: Ctx;
    id: string;
}): ReactElement;
export interface SheetMenuItem {
    label: string;
    onSelect(): void;
    disabled?: boolean;
}
export {};
