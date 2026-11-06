/* ================================================================
   DOT UI 包 · 类型合并入口（不参与运行）

   ▍这是什么
   两件事只有"被 import 过"才会生效，而它们都不是运行时代码：
   1. `@deepseek-ai/dsh-client-ui-renderer/client` 的声明合并里带着 `SlotMap['root']`，
      不 import 它，`PropsRuntime<'root'>` 直接编译失败（类型表里没有 root 这一行）。
   2. 官方 locale 的 `LocaleNamespaceMap` 是空的合并点；谁拥有词典谁声明自己的命名空间，
      否则 `PropsLocale<'dot'>` 退化成 `object`，组件上的 `t` 就不存在。

   ▍为什么放在包根而不是 src
   这是构建/类型接线，不是界面代码；放 src 会让"界面源码"混进不属于它的类型声明。
   同时它被 tsconfig 显式 include，tsdown 不会把它当入口打包。

   ▍修改铁律
   1. 【不】在这里加运行时代码或副作用 import；只用 `import type`。
   2. 新增 locale 命名空间时，键必须与 `src/client/locales.ts` 导出的对象保持一致，
      否则 `t('xxx')` 的键域会对不上。
   ================================================================ */
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

/** DOT 自己的词典命名空间：键域直接取自词表对象，改词表不需要同步改这里。 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    dot: keyof typeof import('./src/client/locales.ts').zh
  }
}
