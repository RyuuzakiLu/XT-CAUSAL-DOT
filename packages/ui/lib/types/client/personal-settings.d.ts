export type PersonalPreferences = {
    fontScale: number;
    glassOpacity: number;
    spriteScale: number;
    spriteEdge: 'left' | 'right';
    reducedMotion: boolean;
    idleShrink: boolean;
    stateFeedback: boolean;
    autoWorkCard: boolean;
    expandedWorkCard: boolean;
    cardMotion: boolean;
};
export declare const DEFAULT_PERSONAL: PersonalPreferences;
export type PersonalKey = keyof PersonalPreferences;
export type SettingsPage = 'quick' | 'full' | 'models' | 'plugins' | 'native' | null;
export type SettingIntent = {
    kind: 'local';
    patch: Partial<PersonalPreferences>;
} | {
    kind: 'dnd';
    until: number | null;
} | {
    kind: 'notification';
    category: 'completed' | 'attention' | 'failed';
    enabled: boolean;
} | {
    kind: 'undo';
} | {
    kind: 'unavailable';
    message: string;
};
export declare function normalizePersonal(value: unknown): PersonalPreferences;
export declare function parseSettingIntent(text: string, current: PersonalPreferences, now?: number): SettingIntent | null;
export type PersonalState = {
    value: PersonalPreferences;
    notice: string;
    canUndo: boolean;
    serverUndo: boolean;
};
export declare class PersonalSettings {
    private readonly storage;
    private snapshot;
    private listeners;
    private previous;
    private undoServer;
    constructor(storage: Pick<Storage, 'getItem' | 'setItem'>, fallback?: Partial<PersonalPreferences>);
    getSnapshot: () => PersonalState;
    subscribe: (listener: () => void) => (() => void);
    change(patch: Partial<PersonalPreferences>, notice?: string, options?: {
        readonly silent?: boolean;
    }): void;
    undo(): void;
    receive(key: string | null, value: string | null): void;
    offerServerUndo(run: () => Promise<void>): void;
    undoLast(): Promise<void>;
    notify(notice: string): void;
    private publish;
}
