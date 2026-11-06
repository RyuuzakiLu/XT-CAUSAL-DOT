/* ================================================================
   DOT 运行装配构建配置

   ▍这是什么
   Host 面插件（没有浏览器补丁）：tsdown 出 ESM 的 lib/index.js。

   ▍为什么必须挂 typertPlugin
   两件事只有它做：
   1. **装饰器降级**：`@Remote('list')` 是标准（stage-3）装饰器语法，Node 的原生
      ESM 加载器**不认识**它——不降级就会在 Host import 时报
      `SyntaxError: Invalid or unexpected token`（实测踩过，且看起来像"文件坏了"）。
      官方插件在 bundle 前用 ts.transpileModule 把它降成 `__esDecorate` 调用。
   2. **产物生成**：lib/typert.host.* / lib/typert.remote-client.* 由它写。
      本包也跑 `pnpm typert:gen` 统一生成；两条路径产出同一份字节，不冲突。

   ▍为什么外部化 @deepseek-ai/*
   Cordis 与工具注册表必须与宿主共用同一实例；打第二份就会出现"注册了但宿主看不见"。

   ▍修改铁律
   1. 【不】去掉 typertPlugin——去掉后产物仍能"生成"，但运行时加载会直接炸。
   2. 【不】把 @deepseek-ai/* 打进产物。
   ================================================================ */
import { typertPlugin } from '@deepseek-ai/dsh-typert-generator/tsdown'
import type { UserConfig } from 'tsdown'

const config: UserConfig = {
  name: '@xtcausal/dot-runtime',
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2023',
  fixedExtension: false,
  dts: false,
  clean: false,
  sourcemap: false,
  deps: { neverBundle: [/^@deepseek-ai\//, /^node:/, /^@xtcausal\//] },
  // package 模式：只生成本包产物，不接管整棵工作区（生成职责归 scripts/gen-typert.mjs）。
  plugins: [typertPlugin({ mode: 'package', faces: ['host'] })],
}

export default config
