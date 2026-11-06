import type { ILayout, MainPanelId, PanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client';
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots';
import type { Space } from './view-store.ts';
export declare class DotLayout implements ILayout {
    private readonly move;
    private readonly menu;
    private readonly nativePanel;
    private readonly rightbar;
    private selection;
    private listeners;
    private navigation;
    readonly panelInfo: HostObservable<PanelInfo>;
    constructor(move: (space: Space) => void, menu: () => void, nativePanel: (id: string) => void, rightbar: (shown: boolean) => void);
    selectPanel(panelId: MainPanelId | null): void;
    beginNavigation(): AbortSignal;
    toggleSidebar(): void;
    openRightbar(_track: boolean, _fullscreen: boolean): void;
    closeRightbar(): void;
    dispose(): void;
}
