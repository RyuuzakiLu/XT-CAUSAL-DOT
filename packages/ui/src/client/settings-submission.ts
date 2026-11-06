/* ================================================================
   普通对话设置指令接线 · 总导游图
   ▍这是什么
   在原生对话提交前只处理完整明确的个人设置；普通聊天与附件仍走原生方法。
   ▍修改铁律
   1. 【不】给 Cordis 服务代理直接赋方法：它写入调用者影子，真正发送方看不见。
   2. 只改已核实的原型方法并在卸载时还原；不能另包 HTTP 或修改 DSH 源码。
   3. 原方法的 this 仍取实际调用者，防止把另一个会话的上下文拿来发送。
   ▍更新记录
   *更新：2026-10-24 · 精确提交桥与原型回收，核真实Cordis消费者*
================================================================ */
import type { ConversationController } from '@deepseek-ai/dsh-client-ui-conversation/client'

/* 只包已经存在的原生方法；未知版本明确失败，不能静默拿到一个没生效的接头。 */
export function installSettingSubmission(conversation: ConversationController, handle: (text: string) => Promise<boolean>): () => void {
  const prototype = Object.getPrototypeOf(conversation)
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'sendSession')
  if (!descriptor || typeof descriptor.value !== 'function' || !descriptor.configurable) throw new Error('原生对话提交接口未匹配，设置指令桥未安装')
  const original = descriptor.value as ConversationController['sendSession']
  const wrapped: typeof original = async function (this: ConversationController, session, text, attachments, mode, signal) {
    if (!attachments.length && !signal?.aborted && await handle(text)) return { kind: 'success' }
    return original.call(this, session, text, attachments, mode, signal)
  }
  Object.defineProperty(prototype, 'sendSession', { ...descriptor, value: wrapped })
  return () => {
    if (Object.getOwnPropertyDescriptor(prototype, 'sendSession')?.value === wrapped) Object.defineProperty(prototype, 'sendSession', descriptor)
  }
}
