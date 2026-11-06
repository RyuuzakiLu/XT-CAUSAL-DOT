export type SpritePose = 'idle' | 'user-typing' | 'thinking' | 'responding' | 'working' | 'reminder' | 'done';
export declare const SPRITE_POSES: readonly SpritePose[];
export declare const SPRITE_POSE_LABEL: Record<SpritePose, string>;
export interface SpritePoseInputs {
    /** 有「请你确认」气泡挂着。 */
    readonly confirm: boolean;
    /** 刚看到一项工作做完，正在播完成动画。 */
    readonly celebrating: boolean;
    /** 你在对话输入框里打字。 */
    readonly typing: boolean;
    /** 正在录语音。 */
    readonly listening: boolean;
    /** ASTRA 会话在跑。 */
    readonly busy: boolean;
    /** 对话里的字正在往外冒。 */
    readonly streaming: boolean;
    /** 后台在跑的工作数。 */
    readonly running: number;
}
export declare function resolveSpritePose(input: SpritePoseInputs): SpritePose;
/** 右上角小气泡：工作中写在跑的工作数，待机写未读数；其他样子、或数字为 0 时不显示。 */
export declare function spriteBadge(pose: SpritePose, running: number, unread: number): {
    readonly kind: 'working' | 'unread';
    readonly count: number;
    readonly text: string;
} | null;
export interface SpritePoseTimers {
    set(callback: () => void, ms: number): unknown;
    clear(handle: unknown): void;
}
/** done 图集 22 帧、90ms 一帧，约 1980ms；多留一点让最后一帧停住。 */
export declare const DONE_PLAY_MS = 2100;
/** 最后一次按键后这么久没再打字，就不算在打字了。 */
export declare const TYPING_IDLE_MS = 1600;
/** 对话区最后一次冒字后这么久没动静，就从「回答」回到「思考」。 */
export declare const STREAM_IDLE_MS = 1500;
export interface SpriteSignalsSnapshot {
    readonly typing: boolean;
    readonly listening: boolean;
    readonly streaming: boolean;
    readonly celebrating: boolean;
    /** 有工作做完了、但前台在忙，「完成」还在等着播。 */
    readonly donePending: boolean;
}
/** 精灵样子用到的、不在业务数据里的瞬时信号。DotLive 持有一份。 */
export declare class SpriteSignals {
    private readonly timers;
    private snapshot;
    /** 外面传进来的前台占用：ASTRA 会话在跑，或「请你确认」气泡挂着。 */
    private held;
    private readonly listeners;
    private readonly handles;
    constructor(timers?: SpritePoseTimers);
    getSnapshot: () => SpriteSignalsSnapshot;
    subscribe: (listener: () => void) => (() => void);
    private set;
    /** 前台在忙：打字、录语音、出字，或者外面说会话在跑 / 有确认气泡。 */
    private foregroundBusy;
    /** 「完成」排队规则：前台空着就播等着的那一次；正在播时前台忙起来，就让出去、空下来重播。 */
    private settleDone;
    /** DotShell 每次渲染后告诉这里：ASTRA 会话在不在跑、有没有「请你确认」气泡。 */
    setHeld(held: boolean): void;
    /** 置为 true，ms 后自动回到 false；再次调用会重新计时。 */
    private pulse;
    private stop;
    typed(): void;
    stopTyping(): void;
    setListening(on: boolean): void;
    streamed(): void;
    stopStreaming(): void;
    /** 看到一项工作做完。正在播或已经在等，就不再加一次（多项完成只播一次）。 */
    celebrate(): void;
    /** 截图和测试用：直接摆成某个样子需要的信号。 */
    force(next: Partial<SpriteSignalsSnapshot>): void;
    dispose(): void;
}
/** 录语音的组件开始 / 结束时广播；DotShell 里的监听器据此切「倾听」。 */
export declare const SPRITE_LISTENING_EVENT = "dot:sprite-listening";
export declare function announceListening(on: boolean): void;
/** 算「在跟 ASTRA 说话」的输入框：DSH 对话输入框和 DOT 自己的快捷输入框。搜索框、设置里的输入框不算。
    DSH 自己的编辑器是 contenteditable + data-composer-input（lib/client.js 实查），前两条就够；
    后两条是给旧版/改版 DSH 的兜底，只在「输入栏卡片里面」认，避免把搜索框、设置输入框算成在说话。 */
export declare const TALK_INPUT_SELECTOR = "[data-composer-input], [data-dot-talk-input], [data-composer-card] [contenteditable=\"true\"], [data-composer-card] [role=\"textbox\"]";
/** 对话区：这里面的字在变，就算 ASTRA 在往外出字（输入框里的变化除外）。 */
export declare const CONVERSATION_SELECTOR = "section[aria-label=\"\u5BF9\u8BDD\u7A7A\u95F4\"]";
/**
 * 在页面上挂三个监听：打字、录语音、对话区冒字。只读 DOM，不改 DSH。
 * busy() 读 ASTRA 会话是否在跑；不在跑时不算冒字。
 */
export declare function watchSpriteSignals(signals: SpriteSignals, busy: () => boolean, root?: Document): () => void;
