/* ================================================================
   ASTRA 金色环形菜单 · 总导游图（改代码前必读）
   ▍这是什么
   本人DOT的精灵专属六空间入口；React/SVG/CSS Modules，消费原生视图动作和素材表。
   ▍结构
   固定节点坐标 → 打开时接管焦点/关闭时还原 → 金色轨道、坐姿精灵和六个入口。
   ▍修改铁律
   1. 【不】复制导航或业务状态；选择入口仍调用根布局注入的navigate。
   2. 星轨与人物不吃点击；入口在最上层，不能被头发盖住。
   3. 关闭只收视图，不改精灵保存的位置；背景点击不得穿透误发消息。
   ▍更新记录
   *更新：2026-10-23 · 按参考图接入六空间星环、坐姿精灵及键盘关闭*
   *更新：2026-10-23 · R1完整click后开菜单、防尾随误点，导航统一精灵*
   *更新：2026-10-24 · 接个人设置真实保存/显示消费与原生能力配置，保留精灵入口*
================================================================ */
import { useEffect, useRef } from 'react'
import type { DotProps } from './DotShell.tsx'
import type { Space } from './view-store.ts'
import { ArtSlot, Icon } from './visuals.tsx'
import { useChunk } from './chunks/use-chunk.ts'
import css from './dot.module.css'

/* ⚠️ 2026-10-27 用户拍板撤掉"记忆"入口：「秘书帮我记住就行了，我要自己看我还要秘书干啥」。
   库和 ASTRA 主动查记忆都保留（dot_memory_* 工具照旧），只是不再给人一个自己翻库的房间。
   【不】把 memory 加回这里：要恢复得先想清楚"人为什么需要自己翻"这个问题。
   五个入口沿用原参考图的环上点位，撤掉一个后不重排——重排会让另外五个人的记忆位置全变。
   ⚠️ 2026-10-27（晚些）能力空间整页删除（用户：「能力空间那一页可以直接删掉，没有必要」）：
   旧入口移除后不重排，剩下四个入口原位不动。 */
const nodes: { space: Space; x: number; y: number }[] = [
  { space: 'conversation', x: 38, y: 15 },
  { space: 'work', x: 17, y: 37 },
  { space: 'postbox', x: 74, y: 80 },
  { space: 'study', x: 84, y: 20 },
]

/* OrbitMenu()：契约
   入参：与根布局相同的注入props；返回：只负责显示与导航的环形浮层。
   副作用：打开期间限制键盘焦点、Escape关闭，卸载时还原原按钮焦点。
   谁调用：DotShell()按orbitMenu挂载；改动影响：六个入口共用navigate，不自建业务动作。 */
export function OrbitMenu(props: DotProps) {
  /* 菜单里的坐姿精灵在 client.art.js；打开菜单才取这一块，没到之前 ArtSlot 显示占位。 */
  useChunk('art')
  const panel = useRef<HTMLElement>(null)
  /* ⚠️ 空白关闭必须在这里按下，防旧目标遗留click误关新出现的菜单。 */
  const backgroundPress = useRef<EventTarget | null>(null)
  const close = useRef(() => props.actions.orbitMenu(false))
  close.current = () => props.actions.orbitMenu(false)
  const space = props.useStore(value => value.space)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const root = panel.current
    root?.querySelector<HTMLButtonElement>('button')?.focus()
    /* ⚠️ 只锁本菜单的兄弟节点，卸载还原旧值，不碰原生插件自己的inert约定。 */
    const siblings = Array.from(root?.parentElement?.children ?? []).filter(node => node !== root) as HTMLElement[]
    const old = siblings.map(node => node.inert)
    siblings.forEach(node => { node.inert = true })
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); return }
      if (event.key !== 'Tab') return
      const buttons = Array.from(root?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      const first = buttons[0], last = buttons[buttons.length - 1]
      if (event.shiftKey && (document.activeElement === first || !root?.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !root?.contains(document.activeElement))) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keyboard, true)
    return () => {
      document.removeEventListener('keydown', keyboard, true)
      siblings.forEach((node, index) => { node.inert = old[index] ?? false })
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  return <section ref={panel} className={css.orbitOverlay} role="dialog" aria-modal="true" aria-label={props.t('orbitMenu')} onPointerDown={event => { backgroundPress.current = event.target === event.currentTarget || event.target === event.currentTarget.firstElementChild ? event.target : null }} onClick={event => { if ((event.target === event.currentTarget || event.target === event.currentTarget.firstElementChild) && backgroundPress.current === event.target) props.actions.orbitMenu(false); backgroundPress.current = null }}>
    <div className={css.orbitStage}>
      <svg className={css.orbitTrack} viewBox="0 0 400 400" fill="none" aria-hidden="true">
        <circle cx="210" cy="190" r="145" stroke="currentColor" strokeWidth="1.3" strokeDasharray="330 12 120 20 240 18" />
        <ellipse cx="210" cy="190" rx="155" ry="136" stroke="currentColor" strokeWidth=".4" opacity=".35" transform="rotate(-24 210 190)" />
        {[[122, 67], [62, 175], [105, 293], [223, 332], [339, 255], [350, 122], [253, 50]].map(([x, y]) => <path key={`${x}-${y}`} d={`M${x} ${y! - 6}l1.5 4.5 4.5 1.5-4.5 1.5-1.5 4.5-1.5-4.5-4.5-1.5 4.5-1.5Z`} fill="currentColor" />)}
      </svg>
      <ArtSlot kind="seated" className={css.orbitCharacter} />
      {nodes.map(node => <button key={node.space} className={css.orbitNode} style={{ left: `${node.x}%`, top: `${node.y}%` }} aria-label={props.t(node.space)} aria-current={node.space === space ? 'page' : undefined} onClick={() => { props.actions.orbitMenu(false); props.navigate(node.space) }}><span><Icon name={node.space} /></span><strong>{props.t(node.space)}</strong></button>)}
      <button className={css.orbitSettings} aria-label="快捷设置" onClick={() => props.actions.settings('quick')}>⚙<span>设置</span></button>
      <button className={css.orbitClose} aria-label={props.t('orbitDismiss')} onClick={() => props.actions.orbitMenu(false)}>×</button>
    </div>
  </section>
}
