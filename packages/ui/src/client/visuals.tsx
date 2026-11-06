/* ================================================================
   DOT 星夜视觉零件 · 总导游图
   ▍这是什么
   本人DOT界面的空间页眉与空态；图标与人物图占位已拆到 icons.tsx / art-slot.tsx，
   本文件保留旧导出名，原有引用不用一起改。
   ▍结构
   兼容再导出（Icon / ArtSlot）→ SpaceHeading / EmptyState。
   ▍修改铁律
   1. 纯装饰SVG不抢读屏焦点，按钮名称仍由调用处提供。
   2. ⚠️ 图片失败回退只影响外观，不改工作/记忆等业务事实。
   3. 【不】在这里 import 图片表：人物图由 client.art.js 按需登记。
   ▍更新记录
   *更新：2026-10-23 · 无图片星轨视觉与统一空间标题/空态*
   *更新：2026-10-25 · 图标与人物图占位拆出，本文件继续导出同名符号兼容旧引用*
================================================================ */
import type { Space } from './view-store.ts'
import { Icon } from './icons.tsx'
import css from './dot.module.css'

export { Icon, type IconName } from './icons.tsx'
export { ArtSlot, artworkSource, type ArtworkKind, type ArtworkSource } from './art-slot.tsx'

/* 标题只解释空间用途，不生成工作计数或虚构服务已接通。 */
export function SpaceHeading({ space, title, description }: { space: Space; title: string; description: string }) {
  return <header className={css.spaceHeading}><span className={css.spaceEmblem}><Icon name={space} /></span><div><span className={css.eyebrow}>ASTRA / {space.toUpperCase()}</span><h1>{title}</h1><p>{description}</p></div></header>
}

/* 空态是阅读引导而非示例数据，不能往业务列表里塞假工作。 */
export function EmptyState({ space, title, description }: { space: Space; title: string; description: string }) {
  return <div className={css.emptyState}><span><Icon name={space} /></span><strong>{title}</strong><p>{description}</p></div>
}
