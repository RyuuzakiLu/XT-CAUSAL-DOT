/* ================================================================
   原生能力配置的个人版标题 · 总导游图
   ▍这是什么
   官方设置头部槽的一小块品牌内容；只加可定位标记，不改原生表单和存储。
   ▍修改铁律
   1. 【不】复制设置页/Key输入；这里只负责让原生覆盖层沿DOT黑金外观。
   ▍更新记录
   *更新：2026-10-24 · 个人能力配置标题与CSS定位标记*
================================================================ */
import { useEffect, useRef, type RefObject } from 'react'
import { cssText as panelCssText } from './native-settings-panel.module.css'
import { translateNativeSettings } from './native-settings-zh.ts'
/* 品牌头顺带两件事（都只在面板打开期间生效）：
   - 渲染 native-settings-panel.module.css：深色金色配色 + 窄屏重排；
   - 观察面板文字，把已知的宿主英文报错换成中文兜底。 */
function useZhFallback(ref: RefObject<HTMLElement>) {
  useEffect(() => {
    const dialog = ref.current?.closest('[role=dialog]')
    if (!dialog || typeof MutationObserver === 'undefined') return
    translateNativeSettings(dialog)
    const observer = new MutationObserver(() => translateNativeSettings(dialog))
    observer.observe(dialog, { subtree: true, childList: true, characterData: true })
    return () => observer.disconnect()
  }, [ref])
}

export function NativeSettingsChrome() {
  const ref = useRef<HTMLSpanElement>(null)
  useZhFallback(ref)
  return <span ref={ref} data-dot-native-settings="">插件与工具<style>{panelCssText}</style></span>
}
