/* ================================================================
   简洁版图集（2026-11-01 S3）：替换原生 conversation.chat.user.images / conversation.chat.message.images。
   在对话中拨动图叠换图，点当前图片直接放大，侧边按钮打开总览。
   全屏里左右滑切换，往下滑关闭（回到网格），往上滑翻到下一张；电脑上还有左右箭头和方向键，Esc 逐层退出。
   缩略图模式（thumbnail）仍交还原生图集。图片地址只经槽主给的 loadImage 取，不另拼链接。
================================================================ */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { rubber, stackLayout, swipeIntent, type CardPlace, type Dim } from './image-stack-layout.ts'
import css from './gallery.module.css'
import { groupOf, groupRoot, joinGroup, orderedMembers, type ImageGroup } from './group.ts'

export interface StackAttachment { attachmentId: string; name?: string; width?: number; height?: number; [k: string]: unknown }
export interface StackImage { attachment?: StackAttachment; preview?: { url: string; name?: string; width?: number; height?: number }; label?: string }
export type StackLoader = ((attachment: StackAttachment) => Promise<string | undefined>) & { peek?: (attachment: StackAttachment) => string | undefined }
export interface ImageSlotProps {
  images: readonly StackImage[]
  loadImage: StackLoader
  align?: string
  compact?: boolean
  thumbnail?: boolean
  renderFactorySlot?: (name: string, props: Record<string, unknown>) => ReactNode
}

const nameOf = (item: StackImage, i: number) => item.label || item.attachment?.name || item.preview?.name || `图片 ${i + 1}`
const keyOf = (item: StackImage, i: number) => item.attachment?.attachmentId ?? item.preview?.url ?? `i${i}`
function metaDim(item: StackImage): Dim | undefined {
  const w = Number(item.attachment?.width ?? item.preview?.width), h = Number(item.attachment?.height ?? item.preview?.height)
  return w > 0 && h > 0 ? { width: w, height: h } : undefined
}

/** 经槽主的 loader 取图；失败时返回 failed，retry 重新取一次。 */
function useImageUrl(item: StackImage, load: StackLoader) {
  const att = item.attachment
  const direct = item.preview?.url
  const [url, setUrl] = useState<string | undefined>(() => direct ?? (att ? load.peek?.(att) : undefined))
  const [failed, setFailed] = useState(false)
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    if (direct) { setUrl(direct); return }
    if (!att) { setFailed(true); return }
    const cached = nonce === 0 ? load.peek?.(att) : undefined
    if (cached) { setUrl(cached); return }
    let alive = true
    setFailed(false)
    Promise.resolve().then(() => load(att)).then(
      u => { if (!alive) return; if (u) setUrl(u); else setFailed(true) },
      () => { if (alive) setFailed(true) },
    )
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [att?.attachmentId, direct, nonce])
  return { url, failed, markFailed: () => setFailed(true), retry: () => { setUrl(undefined); setFailed(false); setNonce(n => n + 1) } }
}

function Picture({ item, index, load, className, onDims, showRetry }: { item: StackImage; index: number; load: StackLoader; className?: string | undefined; onDims?: ((d: Dim) => void) | undefined; showRetry?: boolean | undefined }) {
  const { url, failed, markFailed, retry } = useImageUrl(item, load)
  if (failed) return (
    <span className={css.broken} role="img" aria-label={`${nameOf(item, index)}：加载失败`}>
      <IconBroken />
      {showRetry ? <button type="button" className={css.retry} onClick={e => { e.stopPropagation(); retry() }}>重试</button> : null}
    </span>
  )
  if (!url) return <span className={css.loading} aria-hidden="true" />
  return <img className={className} src={url} alt={nameOf(item, index)} draggable={false} onError={markFailed}
    onLoad={e => { const im = e.currentTarget; if (onDims && im.naturalWidth > 0) onDims({ width: im.naturalWidth, height: im.naturalHeight }) }} />
}

type View = null | { mode: 'grid' } | { mode: 'full'; index: number; fromGrid: boolean }

/** 槽组件：缩略图模式交还原生，其余画 DOT 图集。 */
export function DotImageStack(props: ImageSlotProps): ReactNode {
  if (props.thumbnail) {
    const { renderFactorySlot, ...rest } = props
    return renderFactorySlot ? renderFactorySlot('conversation.images.content', rest as unknown as Record<string, unknown>) : null
  }
  if (!props.images || props.images.length === 0) return null
  // 原生用户消息把多张图拆成多次槽渲染（每次一张、compact: true），这里按消息合回一组。
  if (props.compact && props.images.length === 1) return <GroupedImage image={props.images[0]!} loadImage={props.loadImage} align={props.align} />
  return <Stack images={props.images} loadImage={props.loadImage} {...(props.align === undefined ? {} : { align: props.align })} />
}

/** 同一条消息里的一张图：登记进这一行的组，排在最前的那个画整组堆叠，其余只留一个不占位的锚点。 */
function GroupedImage({ image, loadImage, align }: { image: StackImage; loadImage: StackLoader; align?: string | undefined }) {
  const anchor = useRef<HTMLSpanElement>(null)
  const id = useMemo(() => Symbol('dot-image'), [])
  const [group, setGroup] = useState<ImageGroup | null>(null)
  const [, setTick] = useState(0)
  useLayoutEffect(() => {
    const el = anchor.current
    const root = el ? groupRoot(el) : null
    if (!el || !root) return
    const g = groupOf(root)
    setGroup(g)
    const onChange = () => setTick(v => v + 1)
    g.listeners.add(onChange)
    const leave = joinGroup(g, id, { anchor: el, image, loadImage })
    return () => { g.listeners.delete(onChange); leave() }
  }, [id, image, loadImage])
  const list = group ? orderedMembers(group) : []
  const lead = list.length > 0 && list[0]![0] === id
  return (
    <>
      <span ref={anchor} className={css.groupAnchor} aria-hidden="true" data-dot-image-group={lead ? 'lead' : 'member'} />
      {lead ? <Stack images={list.map(([, m]) => m.image)} loadImage={list[0]![1].loadImage} {...(align === undefined ? {} : { align })} /> : null}
    </>
  )
}

function Stack({ images, loadImage, align }: { images: readonly StackImage[]; loadImage: StackLoader; align?: string }) {
  const n = images.length
  const anchor = useRef<HTMLDivElement>(null)
  const [measured, setMeasured] = useState<Record<string, Dim>>({})
  const keys = images.map(keyOf)
  const [cursor, setCursor] = useState(0)
  const front = cursor % n
  const slotIndex = (slot: number) => (front + (n === 2 ? 1 - slot : slot)) % n
  const dims = images.map((item, i) => metaDim(item) ?? measured[keys[i]!])
  const dimsKey = JSON.stringify(dims)
  const layout = useMemo(() => stackLayout(dims), [dimsKey])
  const gesture = useRef<{ id: number; x: number; y: number; card: HTMLElement; moved: boolean } | null>(null)
  const ignoreClick = useRef(false)
  const getFront = () => anchor.current?.querySelector<HTMLElement>('[data-front]')
  const reduceMotion = () => Boolean(anchor.current?.closest('[data-reduced-motion="true"]') ||
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (n < 2 || !e.isPrimary || e.button !== 0) return
    const card = getFront()
    if (!card) return
    ignoreClick.current = false
    gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, card, moved: false }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    if (!g || g.id !== e.pointerId) return
    const x = e.clientX - g.x, y = e.clientY - g.y
    if (!g.moved && Math.hypot(x, y) < 6) return
    g.moved = true
    ignoreClick.current = true
    g.card.style.transition = 'none'
    g.card.style.transform = `translate3d(var(--px),var(--py),0) perspective(480px) translate3d(${x}px,${y}px,0) rotate(${Math.max(-18, Math.min(18, x * .12))}deg) rotateY(${Math.max(-58, Math.min(58, x * .48))}deg)`
  }
  const release = (e: ReactPointerEvent<HTMLDivElement>, cancel = false) => {
    const g = gesture.current
    if (!g || g.id !== e.pointerId) return
    gesture.current = null
    if (!g.moved) return
    const x = e.clientX - g.x, y = e.clientY - g.y
    g.card.style.removeProperty('transition')
    g.card.style.removeProperty('transform')
    if (cancel || Math.hypot(x, y) < 34) return
    const step = (Math.abs(x) > Math.abs(y) ? x : y) < 0 ? 1 : -1
    setCursor(previous => (previous + step + n) % n)

  }
  const [view, setView] = useState<View>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [reduced, setReduced] = useState(false)

  const open = (overview = false) => {
    const root = anchor.current?.closest('[data-theme]')
    setTheme((root?.getAttribute('data-theme') ?? document.documentElement.dataset['liteTheme']) === 'dark' ? 'dark' : 'light')
    setReduced(anchor.current?.closest('[data-reduced-motion="true"]') != null)
    setView(overview ? { mode: 'grid' } : { mode: 'full', index: front, fromGrid: false })
  }
  const onKey = (e: ReactKeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } }
  const onDims = (i: number) => (d: Dim) => {
    if (metaDim(images[i]!)) return
    const k = keys[i]!
    setMeasured(m => (m[k]?.width === d.width && m[k]?.height === d.height ? m : { ...m, [k]: d }))
  }

  const alignEnd = align === 'end' || align === 'right'
  return (
    <div className={css.row} data-align={alignEnd ? 'end' : 'start'} data-kind={layout.kind} ref={anchor}>
      <div className={css.stack} data-kind={layout.kind} role="button" tabIndex={0}
        aria-label={n === 1 ? `查看图片：${nameOf(images[0]!, 0)}` : `查看 ${n} 张图片`}
        style={{ width: layout.width, height: layout.height }} onPointerDown={down} onPointerMove={move} onPointerUp={e => release(e)} onPointerCancel={e => release(e, true)}
        onClick={e => { if (e.detail && ignoreClick.current) return; open() }} onKeyDown={onKey}>
        {layout.cards.map(place => {
          const i = slotIndex(place.index)
          return <Card key={keys[i]} place={place} front={i === front}>
            <Picture item={images[i]!} index={i} load={loadImage} onDims={onDims(i)} />
            {i === front && n >= 3 ? <span className={css.count}>{n} 张</span> : null}
          </Card>
        })}
      </div>
      {n >= 2 ? (
        <button type="button" className={css.expand} aria-label="查看全部图片" title="查看全部图片" onClick={e => { e.stopPropagation(); open(true) }}><IconExpand /></button>
      ) : null}
      {view ? createPortal(
        <div className={css.layer} data-theme={theme} data-rm={reduced ? '' : undefined}>
          {view.mode === 'grid' || (view.mode === 'full' && view.fromGrid) ? (
            <Grid images={images} load={loadImage} onClose={() => setView(null)} onPick={index => setView({ mode: 'full', index, fromGrid: true })} hidden={view.mode === 'full'} />
          ) : null}
          {view.mode === 'full' ? (
            <Viewer images={images} load={loadImage} index={Math.min(view.index, n - 1)} source={view.fromGrid ? null : getFront} reduced={reduceMotion()}
              onIndex={index => { if (!view.fromGrid) setCursor(index); setView({ ...view, index }) }}
              onClose={() => setView(view.fromGrid ? { mode: 'grid' } : null)} />
          ) : null}
        </div>, document.body) : null}
    </div>
  )
}

function Card({ place, front, children }: { place: CardPlace; front: boolean; children: ReactNode }) {
  const style = {
    '--px': `${place.left}px`, '--py': `${place.top}px`, width: place.width, height: place.height, zIndex: place.z,
    '--r': `${place.rotate}deg`, '--s': String(place.scale), '--side': String(Math.sign(place.rotate)),
  } as CSSProperties
  const inner = place.inner
  return (
    <div className={css.card} style={style} data-cover={place.cover ? '' : undefined} data-front={front ? '' : undefined}
      data-frame={inner ? '' : undefined} data-pixel={place.pixelated ? '' : undefined}>
      {inner ? <span className={css.thumbInner} style={{ width: inner.width, height: inner.height }}>{children}</span> : children}
    </div>
  )
}

function Grid({ images, load, onClose, onPick, hidden }: { images: readonly StackImage[]; load: StackLoader; onClose: () => void; onPick: (i: number) => void; hidden: boolean }) {
  useEffect(() => {
    if (hidden) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hidden, onClose])
  return (
    <div className={css.grid} role="dialog" aria-modal="true" aria-label="图片总览" aria-hidden={hidden || undefined}>
      <div className={css.gridHead}>
        <div className={css.gridTitle}>图片<span>{images.length} 张</span></div>
        <button type="button" className={css.close} aria-label="关闭" onClick={onClose}><IconClose /></button>
      </div>
      <div className={css.gridBody}>
        <div className={css.tiles}>
          {images.map((item, i) => (
            <button type="button" key={keyOf(item, i)} className={css.tile} style={{ '--i': String(i) } as CSSProperties} aria-label={`放大查看：${nameOf(item, i)}`} onClick={() => onPick(i)}>
              <Picture item={item} index={i} load={load} />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function Viewer({ images, load, index, onIndex, onClose, source, reduced }: { source: (() => HTMLElement | null | undefined) | null; reduced: boolean; images: readonly StackImage[]; load: StackLoader; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const n = images.length
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const [dir, setDir] = useState<0 | 1 | -1>(0)
  const start = useRef<{ x: number; y: number; t: number; axis: '' | 'x' | 'y'; id: number } | null>(null)
  const stage = useRef<HTMLDivElement>(null)
  const entered = useRef(false)
  const closing = useRef(false)
  const motion = useRef<Animation | null>(null)
  useEffect(() => () => motion.current?.cancel(), [])
  const zoom = (reverse: boolean) => {
    const slide = stage.current?.querySelector<HTMLElement>('[data-gallery-slide]')
    const image = slide?.querySelector('img')
    const thumb = source?.()
    if (!thumb || !slide || !image || reduced || !slide.animate) return null
    const a = thumb.getBoundingClientRect(), b = image.getBoundingClientRect()
    if (!a.width || !b.width || !b.height) return null
    const dx = a.left + a.width / 2 - b.left - b.width / 2
    const dy = a.top + a.height / 2 - b.top - b.height / 2
    const small = { transform: `translate(${dx}px,${dy}px) scale(${Math.min(a.width / b.width, a.height / b.height)})` }
    const full = { transform: 'none' }
    motion.current?.cancel()
    motion.current = slide.animate(reverse ? [full, small] : [small, full], {
      duration: reverse ? 205 : 270, easing: 'cubic-bezier(.2,.7,.2,1)', fill: reverse ? 'forwards' : 'none'
    })
    return motion.current
  }
  const close = () => {
    if (closing.current) return
    const anim = zoom(true)
    if (!anim) { onClose(); return }
    closing.current = true
    anim.onfinish = onClose
  }
  const go = useCallback((d: 1 | -1) => {
    const next = index + d
    if (next < 0 || next >= n) return
    setDir(d); onIndex(next)
  }, [index, n, onIndex])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close() }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); go(1) }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); go(-1) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [go, close])

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return
    start.current = { x: e.clientX, y: e.clientY, t: performance.now(), axis: '', id: e.pointerId }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = start.current
    if (!s || s.id !== e.pointerId) return
    const dx = e.clientX - s.x, dy = e.clientY - s.y
    if (!s.axis) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
      s.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y'
    }
    if (s.axis === 'x') setDrag({ x: rubber(dx, (dx > 0 && index === 0) || (dx < 0 && index === n - 1)), y: 0 })
    else setDrag({ x: 0, y: dy > 0 ? dy : rubber(dy, index === n - 1) })
  }
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = start.current
    start.current = null
    if (!s || s.id !== e.pointerId) return
    const r = stage.current?.getBoundingClientRect()
    const dx = e.clientX - s.x, dy = e.clientY - s.y
    const intent = s.axis ? swipeIntent(s.axis === 'x' ? dx : 0, s.axis === 'y' ? dy : 0, performance.now() - s.t, r?.width || window.innerWidth, r?.height || window.innerHeight) : 'none'
    setDrag(null)
    if (intent === 'close') close()
    else if (intent === 'next') go(1)
    else if (intent === 'prev') go(-1)
  }
  const h = stage.current?.clientHeight || 800
  const pull = drag && drag.y > 0 ? Math.min(1, drag.y / h) : 0
  const turn = Math.min(1, Math.abs(drag?.x ?? 0) / (stage.current?.clientWidth || 390))
  const adjacent = drag?.x ? index + (drag.x < 0 ? 1 : -1) : -1
  const slideStyle: CSSProperties = drag ? {
    transform: `perspective(850px) translate3d(${drag.x}px,${drag.y}px,0) rotateY(${Math.sign(drag.x) * turn * 48}deg) scale(${1 - pull * .25 - turn * .08})`
  } : {}
  const item = images[index]!
  return (
    <div className={css.viewer} role="dialog" aria-modal="true" aria-label="全屏看图" style={pull ? { background: `rgba(10, 10, 9, ${0.94 * (1 - pull * 0.8)})` } : undefined}>
      <div className={css.viewerTop}>
        <span className={css.pager} aria-live="polite">{n > 1 ? `${index + 1} / ${n}` : nameOf(item, index)}</span>
        <button type="button" className={css.close} aria-label="关闭" onClick={close}><IconClose /></button>
      </div>
      <div className={css.stage} ref={stage} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { start.current = null; setDrag(null) }}>
        {adjacent >= 0 && adjacent < n ? (
          <div className={css.peekSlide} aria-hidden="true" style={{
            transform: `perspective(850px) translateX(${(adjacent - index) * (1 - turn) * 24}px) scale(${.93 + turn * .07})`
          }}>
            <Picture item={images[adjacent]!} index={adjacent} load={load} className={css.full} />
          </div>
        ) : null}
        <div data-gallery-slide="" className={css.slide} style={slideStyle} data-dragging={drag ? '' : undefined}>
          <div key={keyOf(item, index)} className={css.slideInner} data-in={dir === 1 ? 'r' : dir === -1 ? 'l' : source ? 'source' : 'z'}>
            <Picture item={item} index={index} load={load} className={css.full} onDims={() => { if (!entered.current) { entered.current = true; zoom(false) } }} showRetry />
          </div>
        </div>
      </div>
      {n > 1 ? (
        <>
          <button type="button" className={`${css.nav} ${css.prev}`} aria-label="上一张" disabled={index === 0} onClick={() => go(-1)}><IconChevron left /></button>
          <button type="button" className={`${css.nav} ${css.next}`} aria-label="下一张" disabled={index === n - 1} onClick={() => go(1)}><IconChevron /></button>
          {n <= 12 ? <div className={css.dots} aria-hidden="true">{images.map((it, i) => <i key={keyOf(it, i)} data-on={i === index ? '' : undefined} />)}</div> : null}
        </>
      ) : null}
    </div>
  )
}

/* ---------------- 图标（线性、和简洁版其它图标同粗细） ---------------- */
const svg = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
function IconExpand() { return <svg {...svg} width={16} height={16}><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg> }
function IconClose() { return <svg {...svg}><path d="M6 6l12 12M18 6L6 18" /></svg> }
function IconChevron({ left }: { left?: boolean }) { return <svg {...svg} width={22} height={22}><path d={left ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} /></svg> }
function IconBroken() { return <svg {...svg} width={22} height={22}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 15l5-5 4 4M14 12l2-2 5 5M4 4l16 16" /></svg> }
