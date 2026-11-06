import { createFastReply } from './fast-reply.ts'

const running = '[data-chat-running]'
const user = '[data-chat-flow-kind="user"]:not([data-dot-chain-row])'
const reply = '[data-chat-flow-kind="assistant-step"][data-chat-group-part="response"]:not([data-turn-process-hidden]):not([data-dot-chain-row])'
const duration = 440

/** 只接当前回合的正文。流式追加复用原卡，正式节点接替时续接入场时间。 */
export function installReplyMotion(root: HTMLElement, reduced: boolean): () => void {
  let list: Element | null = null
  let settleTimer = 0
  let priorKey: string | undefined
  let shown: HTMLElement | null = null
  let surface: HTMLElement | null = null
  let firstKey = ''
  let start = 0
  let motion: Animation | undefined
  const writer = createFastReply()
  const media = matchMedia('(prefers-reduced-motion: reduce)')
  function reset() {
    clearTimeout(settleTimer)
    settleTimer = 0
    shown?.removeAttribute('data-dot-live-answer')
    motion?.cancel()
    writer.stop()
    shown = surface = null
    firstKey = ''
    list = null
  }
  function update(records: MutationRecord[]) {
    // 空闲时只检查新挂入的运行提示，回看历史、切页不会播放入场。
    if (!list) {
      for (const record of records) for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue
        const waiting = node.matches(running) ? node : node.querySelector(running)
        if (waiting?.parentElement && root.contains(waiting)) {
          list = waiting.parentElement
          // 运行提示可能先于新用户行出现，上一轮回答不能被当作新回复。
          const existing = Array.from(list.querySelectorAll<HTMLElement>(reply)).at(-1)
          priorKey = existing && !existing.querySelector('[data-streaming="true"]') ? existing.dataset.chatNodeKey : undefined
        }
      }
      if (!list) return
    }
    if (!root.contains(list)) { reset(); return }
    const waiting = list.querySelector(running)
    if (waiting && settleTimer) {
      clearTimeout(settleTimer)
      settleTimer = 0
      priorKey = firstKey || priorKey
      firstKey = ''
      shown = surface = null
    }
    let row: HTMLElement | null = null
    for (let n = list.lastElementChild; n; n = n.previousElementSibling) {
      if (!row && n.matches('[data-submission-echo], [data-chat-flow-kind="tool-call"]')) break
      if (n.matches(user)) {
        if (row?.dataset.chatTurn !== n.getAttribute('data-chat-turn')) row = null
        break
      }
      if (!row && n.matches(reply)) row = n as HTMLElement
    }
    const card = row?.querySelector<HTMLElement>('[data-slot="conversation.chat.node"] > :first-child')
    const eligible = waiting || !row?.hasAttribute('data-turn-process-member') || row.hasAttribute('data-turn-process-answer')
    if (row && eligible && card?.textContent?.trim() && row.dataset.chatNodeKey !== priorKey) {
      if (row !== shown) {
        shown?.removeAttribute('data-dot-live-answer')
        if (waiting) row.setAttribute('data-dot-live-answer', '')
        shown = row
      }
      const changed = surface !== card
      if (changed) {
        const now = Number(document.timeline.currentTime ?? performance.now())
        if (!firstKey) { firstKey = row.dataset.chatNodeKey!; start = now }
        surface = card
        motion?.cancel()
        if (row.dataset.chatNodeKey === firstKey && !reduced && !media.matches && now - start < duration) {
          motion = card.animate([{ opacity: 0, translate: '0 16px' }, { opacity: 1, translate: '0 0' }],
            { duration, easing: 'cubic-bezier(.22,.45,.28,1)' })
          motion.startTime = start
        }
      }
      if (!reduced && !media.matches && (changed || records.some(record => card.contains(record.target)))) {
        writer.update(card, row.dataset.chatNodeKey!)
      }
    } else if (shown) {
      writer.stop()
      shown.removeAttribute('data-dot-live-answer')
      shown = surface = null
    }
    if (!waiting) {
      // 回合结束后交回原生可见性，已经开始的动画自然走完。
      shown?.removeAttribute('data-dot-live-answer')
      // 正文有时在运行提示消失后的下一次提交才落入列表。
      if (!settleTimer) settleTimer = window.setTimeout(() => {
        list = shown = surface = null
        firstKey = ''
        settleTimer = 0
      }, 1500)
    }
  }
  const observer = new MutationObserver(update)
  observer.observe(root, { childList: true, characterData: true, subtree: true, attributes: true,
    attributeFilter: ['data-chat-group-part', 'data-turn-process-hidden', 'data-turn-process-answer'] })
  const reduce = () => { if (media.matches) { motion?.cancel(); writer.stop() } }
  media.addEventListener('change', reduce)
  return () => { observer.disconnect(); media.removeEventListener('change', reduce); reset() }
}
