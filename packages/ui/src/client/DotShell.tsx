import type { ComponentType, ReactNode } from 'react'
import type { PropsRuntime, PropsRenderSlots, PropsStore, PropsLocale, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { PersonalSettings } from './personal-settings.ts'
import type { createDotViewStore, Space } from './view-store.ts'
import type { DotDataModel } from './model.ts'
import type { DotLive } from './notify/live-runtime.ts'
import type { CallEngine } from './call/engine.ts'
import { useChunk } from './chunks/use-chunk.ts'
import { ChunkFrame } from './chunks/ChunkFrame.tsx'
import { LiteShell } from './lite/LiteShell.tsx'

export type ImClientService = { render(props?: { preferredSectionId?: string }): ReactNode }
export type ImClientStore = { subscribe(listener: () => void): () => void; getSnapshot(): ImClientService | null }

export type DotInjected = {
  personalSettings?: PersonalSettings
  apiSettings?: import('./api-settings.ts').ApiSettingsPort
  nativeSettingsOpen?: () => boolean
  /** dsh-im 客户端服务（只在开了 dsh-im 的账号上有）：简洁版设置页的「微信」入口用它渲染扫码与管理面板。 */
  imClient?: ImClientStore
  readData?: () => import('./model.ts').DataSnapshot
  hooks: { dotData: DotDataModel }
  navigate(space: Space): void
  back(): void
  refresh(): Promise<void>
  /** 工作空间自己的详情也要按需读取成果，不能等第二层临时卡才取正文。 */
  readWorkArtifacts?(workId: string | null): void
  /** 按需取一块数据（简洁版「我的」页取 capabilities 拿 XTMEM 状态）。 */
  loadDomain?(domain: import('./model.ts').DataDomain): Promise<void> | void
  /** 读记忆历史（含已取代/已归档）。记忆空间点"历史"时才调，不参与首屏。 */
  readHistory?(query?: string, project?: string): Promise<void>
  command(action: string, value?: Record<string, unknown>): Promise<void>
  search(query: string): Promise<void>
  quickSend(text: string): Promise<void>
  startVoice(): Promise<string>
  openSession(id: string): void
  newConversation(): Promise<void>
  /** 联动运行时：工作全局状态、精灵气泡、确认桥接（2026-10-24）。没有时不画气泡、精灵不换图。 */
  live?: DotLive
  /** dot-call-2026-10-27 打电话模式的引擎；通话层和两个通话按钮都用它。 */
  call?: CallEngine
}
export type DotProps = PropsRuntime<'root'> & PropsRenderSlots<'main' | 'rightbar' | 'sidebar.settings' | 'shell.overlay' | 'shell.bottom'> & PropsStore<ReturnType<typeof createDotViewStore>> & PropsLocale<'dot'> & InjectFace<DotInjected>

export function DotShell(props: DotProps) {
  return <LiteShell {...props} renderSettings={() => <SettingsHost props={props} />} />
}

function SettingsHost({ props }: { props: DotProps }) {
  const { module, error, retry, attempt } = useChunk<{ Scene: ComponentType<DotProps> }>('settings')
  if (module === null) return <ChunkFrame key={attempt} overlay label="设置" error={error} retry={retry} fallback={() => props.actions.settings(null)} />
  const Scene = module.Scene
  return <Scene {...props} />
}

