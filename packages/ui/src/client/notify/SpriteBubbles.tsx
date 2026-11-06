/* ================================================================
   DOT 精灵气泡 · 从精灵旁边弹出的通知
   ▍这是什么
   全局叠层（position: fixed），在任何空间都弹。每帧量精灵当前的位置，气泡跟着走：
   精灵被拖到哪就在哪旁边；靠屏幕边时换到不出界的一侧，不压住精灵。
   三种气泡：
   ① 要确认：一直留着，直到点「确认」或「拒绝」；有风险说明就显示。
      原生审批请求不在手边（例如刚刷新）时，改显示「去处理」，【不】假装确认成功。
   ② 要补充：「去填写」跳到工作空间对应的工作卡。
   ③ 只是告诉你：几秒后自动收起，点一下跳到对应工作卡（提醒则打开星邮匣）。
   ▍修改铁律
   1. 【不】碰精灵的拖动、停靠、位置保存；这里只读精灵的位置。
   2. 定位直接写 style，【不】每帧 setState。
   3. 按钮不小于 36px 高。
   *更新：2026-10-24 · 建立*
================================================================ */
import { useCallback, useLayoutEffect, useRef, useSyncExternalStore, type ReactElement } from 'react'
import css from './notify.module.css'
import { placeBubbles, type PlacementRect } from './bubble-placement.ts'
import { openNoticeEntry, type DotNotice } from './notices.ts'
import type { SpriteBubbleQueue } from './sprite-bubbles.ts'

export interface SpriteBubbleActions {
  /** 跳到工作空间对应的工作卡。 */
  openWork(workId: string): void
  /** 打开星邮匣里的这封提醒。 */
  openPostbox(postboxId?: string): void
  /** 这条要确认的通知现在能不能直接答。 */
  canDecide(notice: DotNotice): boolean
  /** 答复；返回 false 表示没答成（请求已不在）。 */
  decide(notice: DotNotice, decision: 'allow' | 'reject'): boolean
  /** canDecide 的结果会变时，用它通知重画。 */
  subscribeDecidable?(listener: () => void): () => void
  decidableVersion?(): number
  /** 用户点了这条气泡（打开、确认、拒绝、去填写、知道了）；点 × 自己收起的不算。星邮匣据此记投递回执。 */
  acknowledge?(notice: DotNotice): void
}

export interface SpriteBubblesProps {
  readonly queue: SpriteBubbleQueue
  readonly actions: SpriteBubbleActions
  /** 找到当前露在外面的精灵元素。 */
  readonly findSprite: () => Element | null
  readonly reducedMotion?: boolean
}

const noop = () => () => {}
const zero = () => 0

function fallbackSpriteRect(width: number, height: number): PlacementRect {
  // 精灵被隐藏时，假装它停在右下角外侧，气泡贴右下角出现。
  return { left: width, top: height - 220, width: 0, height: 120 }
}

export function SpriteBubbles({ queue, actions, findSprite, reducedMotion }: SpriteBubblesProps): ReactElement | null {
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot)
  useSyncExternalStore(actions.subscribeDecidable ?? noop, actions.decidableVersion ?? zero, actions.decidableVersion ?? zero)
  const stackRef = useRef<HTMLDivElement | null>(null)
  const visible = snapshot.visible

  useLayoutEffect(() => {
    const stack = stackRef.current
    if (!stack || !visible.length) return
    let frame = 0
    let last = ''
    let swept = 0
    const place = () => {
      // 每 300ms 看一眼：同一件事的工作卡已经出现在屏幕上，就把重复的气泡收掉。
      const now = performance.now()
      if (now - swept > 300) { swept = now; queue.sweepCovered() }
      const viewport = { width: window.innerWidth, height: window.innerHeight }
      const element = findSprite()
      const box = element?.getBoundingClientRect()
      const sprite: PlacementRect = box && box.width > 0 ? { left: box.left, top: box.top, width: box.width, height: box.height } : fallbackSpriteRect(viewport.width, viewport.height)
      const size = { width: stack.offsetWidth, height: stack.scrollHeight }
      const placement = placeBubbles(sprite, size, viewport)
      const signature = `${Math.round(placement.left)}|${Math.round(placement.top)}|${placement.side}|${Math.round(placement.maxHeight)}|${Math.round(placement.tail)}`
      if (signature !== last) {
        last = signature
        stack.style.left = `${placement.left}px`
        stack.style.top = `${placement.top}px`
        stack.style.maxHeight = `${placement.maxHeight}px`
        stack.style.setProperty('--bubble-tail', `${placement.tail}px`)
        stack.dataset['side'] = placement.side
      }
      frame = requestAnimationFrame(place)
    }
    place()
    return () => cancelAnimationFrame(frame)
  }, [visible, findSprite, queue])

  const hold = useCallback((key: string, holding: boolean) => queue.hold(key, holding), [queue])

  if (!visible.length) return null
  return <div ref={stackRef} className={css['bubbleStack']} data-side="left" data-reduced-motion={reducedMotion ? 'true' : undefined} role="region" aria-label="精灵通知" data-dot-sprite-bubbles="">
    {visible.map(notice => <Bubble key={notice.key} notice={notice} actions={actions} queue={queue} hold={hold} />)}
    {snapshot.queued > 0 && <div className={css['bubbleQueued']} data-dot-bubble-queued="">还有 {snapshot.queued} 条通知排着队</div>}
  </div>
}

interface BubbleProps {
  readonly notice: DotNotice
  readonly actions: SpriteBubbleActions
  readonly queue: SpriteBubbleQueue
  readonly hold: (key: string, holding: boolean) => void
}

function Bubble({ notice, actions, queue, hold }: BubbleProps): ReactElement {
  const dismiss = () => queue.dismiss(notice.key)
  const acknowledge = () => actions.acknowledge?.(notice)
  const open = () => {
    acknowledge()
    if (notice.kind === 'input' && openNoticeEntry(notice.entryUrl)) return
    if (notice.workId && notice.tone !== 'reminder') actions.openWork(notice.workId)
    else actions.openPostbox(notice.postboxId)
  }
  const holdProps = {
    onPointerEnter: () => hold(notice.key, true),
    onPointerLeave: () => hold(notice.key, false),
    onFocus: () => hold(notice.key, true),
    onBlur: () => hold(notice.key, false),
  }
  const head = <>
    <span className={css['bubbleEyebrow']}>{notice.eyebrow}</span>
    <strong className={css['bubbleTitle']}>{notice.title}</strong>
    {notice.text && <span className={css['bubbleText']}>{notice.text}</span>}
  </>

  if (notice.kind === 'confirm') {
    const decidable = actions.canDecide(notice)
    const decide = (decision: 'allow' | 'reject') => { if (actions.decide(notice, decision)) { acknowledge(); dismiss() } }
    return <section className={css['bubble']} data-kind="confirm" data-tone={notice.tone} role="alertdialog" aria-label={`${notice.eyebrow}：${notice.title}`} data-dot-bubble="confirm" {...holdProps}>
      {head}
      {notice.risk && <span className={css['bubbleRisk']} data-dot-bubble-risk=""><b>风险</b>{notice.risk}</span>}
      <span className={css['bubbleActions']}>
        {decidable
          ? <>
            <button type="button" className={css['bubbleButton']} data-variant="ghost" onClick={() => decide('reject')}>拒绝</button>
            <button type="button" className={css['bubbleButton']} data-variant="primary" onClick={() => decide('allow')}>确认</button>
          </>
          : <button type="button" className={css['bubbleButton']} data-variant="primary" onClick={open} data-dot-bubble-handle="">去处理</button>}
      </span>
    </section>
  }

  if (notice.kind === 'input') {
    return <section className={css['bubble']} data-kind="input" data-tone={notice.tone} role="alertdialog" aria-label={`${notice.eyebrow}：${notice.title}`} data-dot-bubble="input" {...holdProps}>
      <button type="button" className={css['bubbleClose']} onClick={dismiss} aria-label="稍后再说">×</button>
      {head}
      <span className={css['bubbleActions']}>
        <button type="button" className={css['bubbleButton']} data-variant="primary" onClick={() => { open(); dismiss() }}>{notice.entryLabel ?? '去填写'}</button>
      </span>
    </section>
  }

  return <section className={css['bubble']} data-kind="info" data-tone={notice.tone} data-sticky={notice.sticky ? 'true' : undefined} role="status" data-dot-bubble="info" {...holdProps}>
    <button type="button" className={css['bubbleBody']} onClick={() => { open(); dismiss() }} aria-label={`${notice.eyebrow}：${notice.title}。${notice.tone === 'reminder' ? '打开星邮匣' : '打开对应工作卡'}`}>{head}</button>
    {notice.sticky
      ? <span className={css['bubbleActions']}><button type="button" className={css['bubbleButton']} data-variant="primary" onClick={() => { acknowledge(); dismiss() }}>知道了</button></span>
      : <button type="button" className={css['bubbleClose']} onClick={dismiss} aria-label="收起">×</button>}
  </section>
}
