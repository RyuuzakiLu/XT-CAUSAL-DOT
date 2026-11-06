/* ================================================================
   DSH 原生设置定位桥 · 总导游图
   ▍这是什么
   读取已注册设置壳的公开 store 句柄，打开原生 Models/Plugins 内层；不复制其子槽。
   ▍修改铁律
   1. 【不】再次声明 settings.section：它已由官方设置壳拥有，两位房东会让页面装载失败。
   2. 原生目前没有 openSection 服务；这里只依赖登记表里真实动作，缺失明确报错。
   3. 不写 DSH 配置或凭据，本桥只开关显示，底下 DOT 场景保持挂载。
   ▍更新记录
   *更新：2026-10-24 · 复用原生设置壳 store，避免复制槽所有权*
================================================================ */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

type NativeStore = { getSnapshot(): { open: boolean }; actions: { open(): void; close(): void; openSection(id: string): void } }
/* 登记表提供的是 owner 自己返回同一个实例的句柄，不从私有变量偷状态。 */
export function nativeSettings(ctx: Context) {
  const resolve = (): NativeStore | null => {
    for (const entry of ctx.slots.entries('sidebar.settings')) {
      const handle = entry.store
      if (!handle || typeof handle !== 'object' || !('create' in handle) || typeof handle.create !== 'function') continue
      const instance = handle.create() as unknown as NativeStore
      if (typeof instance.actions?.openSection === 'function' && typeof instance.actions?.close === 'function') return instance
    }
    return null
  }
  return {
    open(section?: string): void { const store = resolve(); if (!store) throw new Error('插件设置尚未就绪，请待连接恢复后重试'); if (section) store.actions.openSection(section); else store.actions.open() },
    close(): boolean { const store = resolve(); if (!store?.getSnapshot().open) return false; store.actions.close(); return true },
    isOpen(): boolean { return resolve()?.getSnapshot().open ?? false },
  }
}
