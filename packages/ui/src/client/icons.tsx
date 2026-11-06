/* ================================================================
   DOT 矢量图标零件 · 总导游图
   ▍这是什么
   纯 SVG 图标的独立小模块：不引用任何 CSS Module、不引用任何图片，
   所以每个按需房间块引用它时只多几百字节，不会把整份公共皮肤一起背走。
   ▍为什么从 visuals.tsx 拆出来
   visuals.tsx 还带着 SpaceHeading/EmptyState，它们要用 dot.module.css（~90KB）。
   房间块只需要 Icon 的时候不该连带那份样式文本。
   ▍修改铁律
   1. 纯装饰SVG不抢读屏焦点，按钮名称仍由调用处提供。
   2. 【不】在这里 import 样式或图片。
   ▍更新记录
   2026-10-25 · 从 visuals.tsx 拆出，供按需房间块轻量引用。
   ================================================================ */
import type { Space } from './view-store.ts'

export type IconName = Space | 'spark' | 'arrow' | 'attachment' | 'voice' | 'send' | 'orbit'
const paths: Record<IconName, string> = {
  study: 'M3 18V6l9-3 9 3v12l-9 3-9-3Zm9-15v18M3 6l9 3 9-3M7 13h1m8 0h1',
  conversation: 'M20 11a8 8 0 0 1-8 8H6l-4 3 1.5-6A8 8 0 1 1 20 11ZM7 10h9M7 14h5',
  work: 'M4 7h16v13H4V7Zm4 0V4h8v3M4 12h16m-10 0v3h4v-3',
  memory: 'M3 5c4-2 6-2 9 0 3-2 5-2 9 0v15c-4-2-6-2-9 0-3-2-5-2-9 0V5Zm9 0v15M6 9h3m-3 4h3m6-4h3m-3 4h3',
  capabilities: 'm12 2 2.5 6.5L21 11l-6.5 2.5L12 20l-2.5-6.5L3 11l6.5-2.5L12 2Zm7 14 1 2.5 2.5 1L20 21l-1 2.5-1-2.5-2.5-1.5 2.5-1L19 16Z',
  postbox: 'M3 6h18v14H3V6Zm0 0 9 7 9-7M8 3h8',
  spark: 'm12 2 2.7 7.3L22 12l-7.3 2.7L12 22l-2.7-7.3L2 12l7.3-2.7L12 2Z',
  arrow: 'M19 12H5m6-6-6 6 6 6',
  attachment: 'm8 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9',
  voice: 'M9 4a3 3 0 0 1 6 0v8a3 3 0 0 1-6 0V4Zm-4 7v1a7 7 0 0 0 14 0v-1m-7 8v4m-4 0h8',
  send: 'm3 3 18 9-18 9 4-9-4-9Zm4 9h14',
  orbit: 'M19 12a7 7 0 1 1-7-7m0-3v6m-3-3h6M3 19 21 5',
}

/* 线性图标共享笔触，缩小后仍保持可辨轮廓，不依赖生图内的小字。 */
export function Icon({ name, className }: { name: IconName; className?: string | undefined }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>
}
