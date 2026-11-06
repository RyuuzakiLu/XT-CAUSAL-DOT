import type { RefObject } from 'react';
export type Size = {
    width: number;
    height: number;
};
export declare function isTypingTarget(active: Element | null): boolean;
export declare function isTypingWithin(node: Element | null, active: Element | null): boolean;
export declare function keyboardHold(stable: Size | null, next: Size, typing: boolean): boolean;
export declare function holdScale(fit: number, width: number, held: {
    width: number;
    scale: number;
} | null): {
    scale: number;
    holding: boolean;
};
export declare function keyboardLift(target: {
    top: number;
    bottom: number;
}, visible: number, margin?: number): number;
export type KeyboardHoldState = {
    size: Size | null;
    box: Size | null;
    holding: boolean;
    lift: number;
};
export type KeyboardHoldOptions = {
    measure?: (node: HTMLElement) => Size;
    margin?: number;
};
export declare function useKeyboardHold(ref: RefObject<HTMLElement | null>, options?: KeyboardHoldOptions): KeyboardHoldState;
