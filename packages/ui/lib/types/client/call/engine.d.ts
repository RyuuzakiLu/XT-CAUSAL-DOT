export type CallPhase = 'idle' | 'connecting' | 'listening' | 'hearing' | 'thinking' | 'speaking' | 'reconnecting' | 'error' | 'ended';
export interface CallSnapshot {
    readonly phase: CallPhase;
    readonly muted: boolean;
    readonly startedAt: number;
    readonly you: string;
    readonly dot: string;
    readonly voice: string;
    readonly voices: readonly string[];
    readonly error?: string | undefined;
    readonly notice?: string | undefined;
    readonly lastLatencyMs?: number | undefined;
    readonly route?: string | undefined;
    /** call：打电话（一直听，自动判断说完）；ptt：按键说话（按住/点一下录音，回复照常出字并念出来） */
    readonly mode: CallMode;
}
export type CallMode = 'call' | 'ptt';
export declare const currentCallEngine: () => CallEngine | undefined;
export interface CallTurnHooks {
    onDelta(text: string): void;
    onFinal(text: string): void;
    signal: AbortSignal;
}
/** 把一句话发给 DOT 的原生会话；回复文字逐段回调，本轮结束时 resolve。 */
export type CallTurnPort = (text: string, hooks: CallTurnHooks) => Promise<void>;
export interface CallTiming {
    at: number;
    speechEnd: number;
    asrMs?: number | undefined;
    submit?: number | undefined;
    firstText?: number | undefined;
    firstAudio?: number | undefined;
    text?: string | undefined;
}
/** 语义判断：这句话是不是还没说完。返回 'complete' | 'incomplete' | 'filler'。 */
export declare function judgeUtterance(raw: string): 'complete' | 'incomplete' | 'filler' | 'empty';
/** 给语音合成用的文字清理：去掉 Markdown、链接、表情和代码。 */
export declare function speakable(raw: string): string;
/** 流式分句：第一句尽早切（压低首句延迟），后面按整句切。 */
export declare class Segmenter {
    private readonly emit;
    private buffer;
    private inCode;
    private emitted;
    constructor(emit: (text: string) => void);
    push(delta: string): void;
    finish(): void;
    private cut;
}
type Listener = () => void;
export declare class CallEngine {
    private readonly turn;
    private readonly wsUrl;
    private snapshot;
    private readonly listeners;
    private ws?;
    private stream?;
    private micCtx?;
    private playCtx?;
    private worklet?;
    private noiseFloor;
    private echoFloor;
    private level;
    private speechRun;
    private silenceRun;
    private inUtterance;
    private utteranceId;
    private utteranceFrames;
    private lastSpeechFrame;
    private speculative?;
    private asrSeq;
    private readonly asrWaiters;
    private judgedIncomplete;
    private finalizing;
    private preroll;
    private bargePaused;
    private turnAbort?;
    private turnBusy;
    private segSeq;
    private readonly segText;
    private pendingSegs;
    private sources;
    private nextPlayAt;
    private recentSpoken;
    private pingTimer?;
    private reconnects;
    private timing?;
    readonly timings: CallTiming[];
    /** 调试用：插话、回声、噪音的判定记录（只在内存里，最多 60 条） */
    readonly events: {
        at: number;
        kind: string;
        text?: string;
    }[];
    private note;
    private wantOpen;
    private dotLine;
    constructor(turn: CallTurnPort, wsUrl?: () => string);
    subscribe: (listener: Listener) => () => void;
    getSnapshot: () => CallSnapshot;
    getLevel: () => number;
    get active(): boolean;
    start(mode?: CallMode): Promise<void>;
    hangup(reason?: string): void;
    toggleMute(): void;
    setVoice(voice: string): void;
    /** 换声音后用新声音说一句试听（不进对话记录）。 */
    previewVoice(): void;
    private holding;
    private holdWanted;
    private lastActive;
    private idleTimer?;
    /** 按下：没连上就先连（麦克风权限也在这一下里要）；DOT 正在念或正在想，直接打断，不弹确认。 */
    pttDown(): Promise<void>;
    /** 松开（或再点一下）：这段话录完了，直接识别，不再等停顿。 */
    pttUp(): void;
    /** 按键说话的回复不想听了：停止朗读（文字照常留在对话里）。 */
    stopReading(): void;
    get recording(): boolean;
    private checkIdle;
    /** 关掉报错后的通话层。 */
    dismiss(): void;
    /** 给管理/测试用：省掉麦克风，直接把一句文字当作用户说的话。 */
    injectText(text: string): void;
    private connect;
    private onSocketLost;
    private send;
    private onFrame;
    private beginUtterance;
    private sendFrame;
    private requestAsr;
    private finalize;
    private endUtterance;
    private dropUtterance;
    private looksLikeEcho;
    private submit;
    private speak;
    private interruptReply;
    private onServer;
    private onAudio;
    private isPlaying;
    private pausePlayback;
    private resumePlayback;
    private stopPlayback;
    private settlePhase;
    private onNativeEvent;
    private fail;
    private teardown;
    private set;
}
declare let announcer: (kind: 'listening' | 'speaking', on: boolean) => void;
export declare function setCallAnnouncer(fn: typeof announcer): void;
export {};
