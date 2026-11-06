export type Space = 'study' | 'conversation' | 'work' | 'memory' | 'capabilities' | 'postbox';
export type CardGeometry = {
    x: number;
    y: number;
    width: number;
    height: number;
    z: number;
};
export type ViewState = {
    space: Space;
    nativePanel: string | null;
    rightbar: boolean;
    history: Space[];
    menu: boolean;
    orbitMenu: boolean;
    settings?: import('./personal-settings.ts').SettingsPage;
    settingsStack?: Exclude<import('./personal-settings.ts').SettingsPage, null>[];
    card: string | null;
    pinned: string[];
    draft: string;
    reducedMotion: boolean;
    sprite: {
        edge: 'left' | 'right';
        y: number;
        small: boolean;
    };
    homeSprite?: {
        edge: 'left' | 'right';
        y: number;
    };
    canvas: Record<string, CardGeometry>;
    undo: Record<string, CardGeometry>[];
    focus: string | null;
    /** 从对话小卡跳到工作空间大卡时加一；工作空间看到它变了就清掉分类筛选、转到这张卡。 */
    workReveal?: number;
};
export declare function clamp(value: number, min: number, max: number): number;
export declare function arrangeCards(ids: readonly string[], width: number): Record<string, CardGeometry>;
export declare const isRetiredSpace: (space: Space) => boolean;
export declare function createDotViewStore(): import("@deepseek-ai/dsh-client-store").EngineStoreHandle<ViewState, {
    navigate(d: ViewState, space: Space): void;
    rightbar(d: ViewState, shown: boolean): void;
    nativePanel(d: ViewState, panel: string | null): void;
    settings(d: ViewState, page: import("./personal-settings.ts").SettingsPage): void;
    back(d: ViewState): void;
    menu(d: ViewState, open: boolean): void;
    orbitMenu(d: ViewState, open: boolean): void;
    draft(d: ViewState, text: string): void;
    clearSentDraft(d: ViewState, submitted: string): void;
    applyVoice(d: ViewState, original: string, transcript: string): void;
    openCard(d: ViewState, id: string | null): void;
    pin(d: ViewState, id: string): void;
    unpin(d: ViewState, id: string): void;
    dock(d: ViewState, edge: "left" | "right", y: number): void;
    dockHome(d: ViewState, edge: "left" | "right", y: number): void;
    shrink(d: ViewState, small: boolean): void;
    motion(d: ViewState, reduce: boolean): void;
    focus(d: ViewState, id: string | null): void;
    revealWork(d: ViewState, id: string): void;
    moveCard(d: ViewState, id: string, value: CardGeometry): void;
    arrange(d: ViewState, ids: string[], width: number): void;
    undo(d: ViewState): void;
}>;
