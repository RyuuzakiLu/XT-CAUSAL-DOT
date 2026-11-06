import { type ReactElement } from 'react';
import { type SpriteStateName } from '../sprite-states-art.ts';
export interface SpriteStateArtProps {
    readonly state: SpriteStateName;
    readonly className?: string | undefined;
    readonly reducedMotion?: boolean | undefined;
}
/** 第 index 帧在图集里的 background-position（百分比）。 */
export declare function sheetPosition(index: number, columns: number, rows: number): string;
export declare function SpriteStateArt({ state, className, reducedMotion }: SpriteStateArtProps): ReactElement;
