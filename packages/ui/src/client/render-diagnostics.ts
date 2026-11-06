/* ================================================================
   DOT 渲染故障探针 · 总导游图
   ▍这是什么
   只保留最近的渲染错误消息，便于定位白屏；不记录私聊正文或模型请求。
   ▍修改铁律
   1. 监听属于插件生命周期，卸载必须释放。
   ▍更新记录
   *更新：2026-10-23 · 最终装配白屏取证*
================================================================ */
declare global { interface Window { dotRenderErrors?: string[] } }
export function observeRenderErrors(): () => void {
  window.dotRenderErrors = []
  const capture = (event: ErrorEvent) => { window.dotRenderErrors?.push(`${event.message}\n${event.error instanceof Error ? event.error.stack ?? '' : ''}`); if ((window.dotRenderErrors?.length ?? 0) > 10) window.dotRenderErrors?.shift() }
  window.addEventListener('error', capture)
  return () => { window.removeEventListener('error', capture); delete window.dotRenderErrors }
}
