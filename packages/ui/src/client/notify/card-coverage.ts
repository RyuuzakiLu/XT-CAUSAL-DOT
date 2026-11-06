/* ================================================================
   精灵气泡 × 工作卡去重 · 总导游图
   ▍这是什么
   工作卡（对话里的工作小卡 / 工作空间主卡）已经在屏幕上展示同一件事、同一个状态时，
   精灵不再弹同样的气泡（2026-10-30 用户要求：精灵正常通知要留，只是不跟工作卡同时弹重复的内容）。
   ▍规则
   1. 只管带 workId 的「要你补充」「做完了」「没做成」；卡上的 data-status 得是同一状态才算重复。
   2. 「请你确认」不去重：批准/拒绝按钮只在精灵气泡上，工作小卡没有。
   3. 卡得真的露在视口里（有尺寸、和视口相交）；滚出去或在别的空间时精灵照常弹。
   ▍更新记录
   *新建：2026-10-30 · 工作卡和精灵气泡不重复弹*
================================================================ */
import type { DotNotice } from './notices.ts'

/** 这条通知对应的工作卡状态；不参与去重的返回 undefined。 */
export function cardStatusOf(notice: Pick<DotNotice, 'kind' | 'tone' | 'workId'> & { readonly key?: string }): 'waiting-input' | 'succeeded' | 'failed' | undefined {
  if (!notice.workId) return undefined
  /* 「你不在时…」汇总的是好几件工作，不能因为其中一张卡露着就收掉。 */
  if (notice.key?.startsWith('away:')) return undefined
  if (notice.kind === 'input') return 'waiting-input'
  if (notice.kind === 'info' && notice.tone === 'done') return 'succeeded'
  if (notice.kind === 'info' && notice.tone === 'failed') return 'failed'
  return undefined
}

/** 屏幕上是否已有一张同一工作、同一状态的工作卡在展示这条通知的内容。 */
export function noticeCoveredByCard(notice: Pick<DotNotice, 'kind' | 'tone' | 'workId'> & { readonly key?: string }, doc: Document | undefined = globalThis.document): boolean {
  const status = cardStatusOf(notice)
  if (!status || !doc) return false
  const view = doc.defaultView
  const width = view?.innerWidth ?? 0, height = view?.innerHeight ?? 0
  for (const element of doc.querySelectorAll('[data-work-id]')) {
    if (element.getAttribute('data-work-id') !== notice.workId || element.getAttribute('data-status') !== status) continue
    if (element.closest('[hidden],[aria-hidden="true"],[inert]')) continue
    const box = element.getBoundingClientRect()
    if (box.width <= 0 || box.height <= 0) continue
    if (box.bottom <= 0 || box.right <= 0 || box.top >= height || box.left >= width) continue
    return true
  }
  return false
}
