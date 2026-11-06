/* ================================================================
   简洁版图集（2026-11-01 S3）：消息里的图片怎么摆。纯函数，组件和测试共用。
   一张：放进缩略图框（thumbFrame），大图缩进框里，小图整数倍放大且像素清晰。
   两张：第一张在左上、第二张在右下，错开叠放，各带一点倾角。
   三张及以上：第一张居中在最前，后面最多四张左右交替错开、露出边，越往后越斜越小。
   交互只借鉴 Hark（扇形堆叠 → 网格总览 → 全屏左右滑），外观走 DOT 自己的暖白卡片、圆角和阴影。
================================================================ */

export interface Dim { width: number; height: number }

/* 2026-11-01 S3 修：单张图不再按原尺寸光秃秃贴着，改成缩略图框——
   框有最小尺寸、浅色底和细边框，图在框里按比例居中；大图缩进框里，小图按整数倍放大并保持像素清晰，不糊。 */
/** 缩略图框最长边。 */
export const THUMB_CAP = 168
/** 缩略图框最短边，小图也不会缩成一个按钮大小。 */
export const THUMB_MIN = 104
/** 小图按整数倍放大时，放大后的最长边不超过它。 */
export const THUMB_SMALL = 96
/** 小图四周留的底色宽度。 */
export const THUMB_PAD = 8

/** 单张图最长边上限（CSS 像素）。和原生图集一致，小于它的图按原尺寸。 */
export const SINGLE_CAP = 240
/** 堆叠时每张卡片的最长边上限。 */
export const STACK_CAP = 156
/** 扇形里最多露出几张背后的卡片。 */
export const FAN_BACK_MAX = 4

/** 等比缩进 cap×cap 的框，只缩不放；尺寸未知时给一个 4:3 的占位。 */
export function fitWithin(d: Partial<Dim> | undefined, cap: number): Dim {
  const w = Number(d?.width), h = Number(d?.height)
  if (!(w > 0) || !(h > 0)) return { width: cap, height: Math.round(cap * 3 / 4) }
  const k = Math.min(1, cap / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) }
}

export interface ThumbFrame { frame: Dim; inner: Dim; pixelated: boolean }

/** 单张缩略图：框多大、图在框里画多大、要不要像素清晰。框的长宽比夹在 1:2 到 2:1 之间，超出的部分露底色。 */
export function thumbFrame(d: Partial<Dim> | undefined): ThumbFrame {
  const w = Number(d?.width), h = Number(d?.height)
  if (!(w > 0) || !(h > 0)) {
    const f = { width: THUMB_CAP, height: Math.round(THUMB_CAP * 3 / 4) }
    return { frame: f, inner: f, pixelated: false }
  }
  const m = Math.max(w, h)
  if (m >= THUMB_CAP - THUMB_PAD * 2) {
    const a = clamp(w / h, 0.5, 2)
    const frame = a >= 1
      ? { width: THUMB_CAP, height: Math.max(THUMB_MIN, Math.round(THUMB_CAP / a)) }
      : { width: Math.max(THUMB_MIN, Math.round(THUMB_CAP * a)), height: THUMB_CAP }
    const k = Math.min(frame.width / w, frame.height / h)
    return { frame, inner: { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) }, pixelated: false }
  }
  const k = Math.max(1, Math.min(3, Math.floor(THUMB_SMALL / m)))
  const inner = { width: w * k, height: h * k }
  const frame = {
    width: clamp(inner.width + THUMB_PAD * 2, THUMB_MIN, THUMB_CAP),
    height: clamp(inner.height + THUMB_PAD * 2, THUMB_MIN, THUMB_CAP),
  }
  return { frame, inner, pixelated: k > 1 }
}

export type StackKind = 'single' | 'pair' | 'fan'
export function stackKind(count: number): StackKind {
  return count <= 1 ? 'single' : count === 2 ? 'pair' : 'fan'
}

export interface CardPlace {
  /** 对应 images 的下标 */
  index: number
  /** 卡片左上角（未旋转时）相对容器的位置 */
  left: number
  top: number
  width: number
  height: number
  rotate: number
  scale: number
  z: number
  /** 背后的卡片用 cover 填满统一大小的卡片 */
  cover: boolean
  /** 单张缩略图：图在框里实际画的尺寸（居中） */
  inner?: Dim
  /** 小图整数倍放大，按像素清晰的方式画 */
  pixelated?: boolean
}

export interface StackLayout { kind: StackKind; width: number; height: number; cards: CardPlace[] }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

interface Raw { index: number; cx: number; cy: number; width: number; height: number; rotate: number; scale: number; z: number; cover: boolean }

/** 把以中心描述的卡片挪进从 (0,0) 开始、刚好装下旋转后外框的容器里。 */
function normalize(kind: StackKind, raws: Raw[], pad: number): StackLayout {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const r of raws) {
    const t = r.rotate * Math.PI / 180
    const c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t))
    const hw = (r.width * c + r.height * s) * r.scale / 2
    const hh = (r.width * s + r.height * c) * r.scale / 2
    minX = Math.min(minX, r.cx - hw); maxX = Math.max(maxX, r.cx + hw)
    minY = Math.min(minY, r.cy - hh); maxY = Math.max(maxY, r.cy + hh)
  }
  const ox = pad - minX, oy = pad - minY
  const cards = raws.map(r => ({
    index: r.index,
    left: Math.round(r.cx + ox - r.width / 2),
    top: Math.round(r.cy + oy - r.height / 2),
    width: r.width, height: r.height, rotate: r.rotate, scale: r.scale, z: r.z, cover: r.cover,
  }))
  return { kind, width: Math.ceil(maxX - minX + pad * 2), height: Math.ceil(maxY - minY + pad * 2), cards }
}

/**
 * 算一组图的摆法。dims 和图片一一对应（未知的给 undefined）。
 * 返回的 cards 按绘制顺序（先画的在下面）。
 */
export function stackLayout(dims: ReadonlyArray<Partial<Dim> | undefined>): StackLayout {
  const n = dims.length
  const kind = stackKind(n)
  if (n === 0) return { kind, width: 0, height: 0, cards: [] }
  if (kind === 'single') {
    const t = thumbFrame(dims[0])
    const d = t.frame
    return { kind, width: d.width, height: d.height, cards: [{ index: 0, left: 0, top: 0, width: d.width, height: d.height, rotate: 0, scale: 1, z: 1, cover: false, inner: t.inner, pixelated: t.pixelated }] }
  }
  if (kind === 'pair') {
    const a = fitWithin(dims[0], STACK_CAP), b = fitWithin(dims[1], STACK_CAP)
    const dx = clamp(Math.round(Math.min(a.width, b.width) * 0.46), 26, 72)
    const dy = clamp(Math.round(Math.min(a.height, b.height) * 0.4), 20, 60)
    return normalize(kind, [
      { index: 0, cx: a.width / 2, cy: a.height / 2, width: a.width, height: a.height, rotate: -4, scale: 1, z: 1, cover: false },
      { index: 1, cx: dx + b.width / 2, cy: dy + b.height / 2, width: b.width, height: b.height, rotate: 3, scale: 1, z: 2, cover: false },
    ], 4)
  }
  const f = fitWithin(dims[0], STACK_CAP)
  const spread = clamp(Math.round(f.width * 0.17), 12, 28)
  const backs = Math.min(n - 1, FAN_BACK_MAX)
  const raws: Raw[] = []
  // 背后的先画、越远越先画；第 1、3 张往左，第 2、4 张往右。
  for (let k = backs; k >= 1; k--) {
    const side = k % 2 === 1 ? -1 : 1
    const level = Math.ceil(k / 2)
    raws.push({ index: k, cx: side * level * spread, cy: level * 3, width: f.width, height: f.height, rotate: side * level * 6, scale: 1 - level * 0.05, z: 10 - k, cover: true })
  }
  raws.push({ index: 0, cx: 0, cy: 0, width: f.width, height: f.height, rotate: 0, scale: 1, z: 20, cover: false })
  return normalize(kind, raws, 4)
}

/* ---------------- 全屏里的手势 ---------------- */

export type SwipeIntent = 'next' | 'prev' | 'close' | 'none'

/** 手指松开时判断意图：横向切换，往下滑关闭，往上滑翻到下一张。 */
export function swipeIntent(dx: number, dy: number, ms: number, width: number, height: number): SwipeIntent {
  const t = Math.max(1, ms)
  const ax = Math.abs(dx), ay = Math.abs(dy)
  if (ax < 8 && ay < 8) return 'none'
  if (ax >= ay) {
    const passed = ax > Math.max(48, width * 0.18) || (ax / t > 0.45 && ax > 24)
    return passed ? (dx < 0 ? 'next' : 'prev') : 'none'
  }
  const passed = ay > Math.max(64, height * 0.14) || (ay / t > 0.5 && ay > 32)
  if (!passed) return 'none'
  return dy > 0 ? 'close' : 'next'
}

/** 边界上继续拖时给一点阻尼，提示到头了。 */
export function rubber(delta: number, atEdge: boolean): number {
  return atEdge ? delta * 0.3 : delta
}
