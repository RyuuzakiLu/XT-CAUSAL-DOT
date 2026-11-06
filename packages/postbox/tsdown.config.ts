/* ================================================================
   星邮匣构建配置

   ▍这是什么
   两段式构建：先 `tsc` 把 `src/*.ts` 编成 `lib/types/*.js`（TC39 标准装饰器在这里被
   降级成 `__esDecorate`），再由 tsdown 把 `lib/types/index.js` 打成 `lib/index.js`。

   ▍为什么不让 tsdown 直接吃 src/*.ts（血泪，2026-10-23 实测）
   `@Remote(...)` 是标准装饰器；rolldown 直接转译 .ts 会原样保留 `@Remote` 语法，
   运行时立刻 `SyntaxError: Invalid or unexpected token`（能 build、一 import 就炸）。
   上游 DSH 根 tsdown 配置同样是先 tsc 再打包 `lib/types/*.js`，本包沿用同秩序。

   ▍为什么外部化 @deepseek-ai/*
   Cordis / storage-domain / typert-protocol 必须与宿主共用同一实例；打第二份会出现
   "服务注册了宿主看不见""Remote 描述符落在另一个上下文"这类幽灵故障。
   ================================================================ */
import type { UserConfig } from 'tsdown'

const config: UserConfig = {
  name: '@xtcausal/dot-postbox',
  // ⚠️【勿改】入口必须是 tsc 产物，不是 src/*.ts：装饰器已由 tsc 降级。
  entry: { index: 'lib/types/index.js' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2023',
  fixedExtension: false,
  dts: false,
  clean: false,
  sourcemap: false,
  deps: { neverBundle: [/^@deepseek-ai\//, /^node:/, /^@xtcausal\//, /^zod$/] },
}

export default config
