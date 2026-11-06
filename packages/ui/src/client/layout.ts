/* ================================================================
   DOT 原生布局服务 · 总导游图
   ▍这是什么
   提供官方 ILayout 接口和 panelInfo；DOT 独占 root，但原生对话/设置仍可导航。
   ▍修改铁律
   1. 不加载官方 ui-layout 的 root，两位房东不能同时给同一房间办产权。
   2. 侧栏动作映射召唤菜单，而不是把永久侧栏重新塞回来。
   ▍更新记录
   *更新：2026-10-23 · 承接原生布局动作和可取消导航*
================================================================ */
import type { ILayout, MainPanelId, PanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { Space } from './view-store.ts'

/* 纯布局面保留官方调用契约，视图写入仅经声明 actions。 */
export class DotLayout implements ILayout {
  private selection: PanelInfo = { activePanelId: 'dot.study' as MainPanelId }
  private listeners = new Set<() => void>()
  private navigation = new AbortController()
  readonly panelInfo: HostObservable<PanelInfo> = {
    getSnapshot: () => this.selection,
    subscribe: listener => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } },
  }
  constructor(private readonly move: (space: Space) => void, private readonly menu: () => void, private readonly nativePanel: (id: string) => void, private readonly rightbar: (shown: boolean) => void) {}
  selectPanel(panelId: MainPanelId | null): void {
    this.navigation.abort()
    this.selection = { activePanelId: panelId }
    const space = panelId === null || panelId === 'conversation' ? 'conversation' : String(panelId).replace(/^dot\./, '')
    /* 2026-10-27 能力空间整页删除：宿主或旧链接仍点名 dot.capabilities 时送回书房，不落进原生面板。 */
    if (space === 'capabilities') this.move('study')
    else if (['study', 'conversation', 'work', 'memory', 'postbox'].includes(space)) this.move(space as Space)
    else this.nativePanel(String(panelId))
    for (const listener of this.listeners) listener()
  }
  beginNavigation(): AbortSignal { this.navigation.abort(); this.navigation = new AbortController(); return this.navigation.signal }
  toggleSidebar(): void { this.menu() }
  openRightbar(_track: boolean, _fullscreen: boolean): void { this.rightbar(true) }
  closeRightbar(): void { this.rightbar(false) }
  dispose(): void { this.navigation.abort(); this.listeners.clear() }
}
