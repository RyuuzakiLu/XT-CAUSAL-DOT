/** Never infer a historical card's owner from the currently retained conversation. */
export function sourceSession(element: Element): { id: string; readOnly: boolean } | undefined {
  const history = element.closest('[data-dot-chain-row]')
  if (history) {
    const id = history.getAttribute('data-dot-source-session')
    return id ? { id, readOnly: true } : undefined
  }
  const id = element.closest('[data-conversation-session]')?.getAttribute('data-conversation-session')
  return id ? { id, readOnly: false } : undefined
}
export function fingerprint(text: string): string {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return (hash >>> 0).toString(36)
}
export function actionMessage(action: string, payload: Record<string, unknown>): string {
  // Values remain data in a user message, never interpreted as HTML or executable code.
  return `[genui-action] ${action}\n${JSON.stringify(payload)}\n请在回答正文更新内联卡片，不使用 panel 或 Dock。`
}
