export interface SpriteStateSheet {
    readonly src: string;
    readonly columns: number;
    readonly rows: number;
    readonly durationsMs: readonly number[];
    readonly loop: boolean;
}
export declare const spriteStateSheets: {
    /** 待机（manifest：Idle） */
    idle: {
        src: string;
        columns: number;
        rows: number;
        durationsMs: number[];
        loop: true;
    };
    /** 倾听（manifest：User typing） */
    'user-typing': {
        src: string;
        columns: number;
        rows: number;
        durationsMs: number[];
        loop: true;
    };
    /** 思考（manifest：Thinking） */
    thinking: {
        src: string;
        columns: number;
        rows: number;
        durationsMs: number[];
        loop: true;
    };
    /** 回答（manifest：AI responding） */
    responding: {
        src: string;
        columns: number;
        rows: number;
        durationsMs: number[];
        loop: true;
    };
    /** 工作中（manifest：Working） */
    working: {
        src: string;
        columns: number;
        rows: number;
        durationsMs: number[];
        loop: true;
    };
    /** 提醒（manifest：Reminder） */
    reminder: {
        src: string;
        columns: number;
        rows: number;
        durationsMs: number[];
        loop: true;
    };
    /** 完成（manifest：Done） */
    done: {
        src: string;
        columns: number;
        rows: number;
        durationsMs: number[];
        loop: false;
    };
};
export type SpriteStateName = keyof typeof spriteStateSheets;
