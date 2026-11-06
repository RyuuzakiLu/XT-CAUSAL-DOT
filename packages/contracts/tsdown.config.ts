/* ================================================================
   契约包构建配置

   ▍这是什么
   纯 Node 面产物（没有 Client 补丁），所以直接用 tsdown 的常规 ESM 打包。

   ▍为什么外部化 @deepseek-ai/*
   契约包只描述形状，不 import 官方运行时；一旦哪天顺手引了，外部化能让它
   继续指向 profile 里的同一份实例，而不是打第二份 Cordis。
   ================================================================ */
import type { UserConfig } from 'tsdown'

const config: UserConfig = {
  name: '@xtcausal/dot-contracts',
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2023',
  fixedExtension: false,
  dts: false,
  clean: false,
  sourcemap: false,
  external: [/^@deepseek-ai\//, /^node:/],
}

export default config
