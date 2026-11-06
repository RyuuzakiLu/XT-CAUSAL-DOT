import { useState } from 'react'
import { ErrorBoundary, GenuiActionContext, GenuiBlock, isRenderableProcess, processGenuiSpec } from '@changfenhuang/dsh-genui/embed'
import type { GenuiSpec } from '@changfenhuang/dsh-genui/embed'
export type SendAction = (action: string, payload: Record<string, unknown>) => Promise<void>
export function parseSpec(value: unknown): GenuiSpec | undefined {
  try {
    const result = processGenuiSpec(value)
    return isRenderableProcess(result) && result.spec ? result.spec : undefined
  } catch { return undefined }
}
export function GenuiView({ spec, stateKey, send, readOnly = false }: {
  spec: GenuiSpec; stateKey: string; send?: SendAction | undefined; readOnly?: boolean
}) {
  const [error, setError] = useState('')
  return <div data-dot-genui-card style={{ minWidth: 0, maxWidth: '100%' }}>
    {readOnly && <small>历史卡片仅供查看；如需继续，请在下方对话中提出。</small>}
    {!readOnly && !send && <small>未能确认这张卡片所属的会话，发送操作已停用。</small>}
    <ErrorBoundary label="互动卡片">
      <GenuiActionContext.Provider value={send && !readOnly ? (action, payload) => {
        setError(''); void send(action, payload).catch(() => setError('未能发送，请确认连接后重试。'))
      } : undefined}>
        <GenuiBlock spec={spec} stateKey={stateKey} animateEntrance={false} />
      </GenuiActionContext.Provider>
    </ErrorBoundary>
    {error && <div role="alert">{error}</div>}
  </div>
}
