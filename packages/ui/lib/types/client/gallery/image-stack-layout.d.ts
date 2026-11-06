export interface Dim {
    width: number;
    height: number;
}
/** 缩略图框最长边。 */
export declare const THUMB_CAP = 168;
/** 缩略图框最短边，小图也不会缩成一个按钮大小。 */
export declare const THUMB_MIN = 104;
/** 小图按整数倍放大时，放大后的最长边不超过它。 */
export declare const THUMB_SMALL = 96;
/** 小图四周留的底色宽度。 */
export declare const THUMB_PAD = 8;
/** 单张图最长边上限（CSS 像素）。和原生图集一致，小于它的图按原尺寸。 */
export declare const SINGLE_CAP = 240;
/** 堆叠时每张卡片的最长边上限。 */
export declare const STACK_CAP = 156;
/** 扇形里最多露出几张背后的卡片。 */
export declare const FAN_BACK_MAX = 4;
/** 等比缩进 cap×cap 的框，只缩不放；尺寸未知时给一个 4:3 的占位。 */
export declare function fitWithin(d: Partial<Dim> | undefined, cap: number): Dim;
export interface ThumbFrame {
    frame: Dim;
    inner: Dim;
    pixelated: boolean;
}
/** 单张缩略图：框多大、图在框里画多大、要不要像素清晰。框的长宽比夹在 1:2 到 2:1 之间，超出的部分露底色。 */
export declare function thumbFrame(d: Partial<Dim> | undefined): ThumbFrame;
export type StackKind = 'single' | 'pair' | 'fan';
export declare function stackKind(count: number): StackKind;
export interface CardPlace {
    /** 对应 images 的下标 */
    index: number;
    /** 卡片左上角（未旋转时）相对容器的位置 */
    left: number;
    top: number;
    width: number;
    height: number;
    rotate: number;
    scale: number;
    z: number;
    /** 背后的卡片用 cover 填满统一大小的卡片 */
    cover: boolean;
    /** 单张缩略图：图在框里实际画的尺寸（居中） */
    inner?: Dim;
    /** 小图整数倍放大，按像素清晰的方式画 */
    pixelated?: boolean;
}
export interface StackLayout {
    kind: StackKind;
    width: number;
    height: number;
    cards: CardPlace[];
}
/**
 * 算一组图的摆法。dims 和图片一一对应（未知的给 undefined）。
 * 返回的 cards 按绘制顺序（先画的在下面）。
 */
export declare function stackLayout(dims: ReadonlyArray<Partial<Dim> | undefined>): StackLayout;
export type SwipeIntent = 'next' | 'prev' | 'close' | 'none';
/** 手指松开时判断意图：横向切换，往下滑关闭，往上滑翻到下一张。 */
export declare function swipeIntent(dx: number, dy: number, ms: number, width: number, height: number): SwipeIntent;
/** 边界上继续拖时给一点阻尼，提示到头了。 */
export declare function rubber(delta: number, atEdge: boolean): number;
