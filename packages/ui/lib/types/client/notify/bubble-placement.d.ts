export interface PlacementRect {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
}
export interface PlacementSize {
    readonly width: number;
    readonly height: number;
}
export type BubbleSide = 'left' | 'right' | 'above' | 'below';
export interface BubblePlacement {
    readonly left: number;
    readonly top: number;
    readonly side: BubbleSide;
    /** 气泡组可用的最大高度（内容更高时内部滚动）。 */
    readonly maxHeight: number;
    /** 尖角位置：左右两侧时是距气泡组顶边的 px，上下两侧时是距左边的 px。 */
    readonly tail: number;
}
export interface PlacementOptions {
    /** 气泡和精灵之间的空隙。 */
    readonly gap?: number;
    /** 气泡和屏幕边的最小距离。 */
    readonly margin?: number;
}
export declare function placeBubbles(sprite: PlacementRect, stack: PlacementSize, viewport: PlacementSize, options?: PlacementOptions): BubblePlacement;
/** 判断两个矩形是否重叠（测试和截图核对用）。 */
export declare function rectsOverlap(a: PlacementRect, b: PlacementRect): boolean;
