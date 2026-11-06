/* ================================================================
   DOT 工作插件 · 构建配置

   ▍这是什么
   Host 面插件（没有浏览器补丁）：tsdown 出 ESM 的 lib/index.js，
   再挂官方 Typert 生成器产出 lib/typert.host.* 与 lib/typert.remote-client.*。

   ▍为什么必须挂 typertPlugin
   用户明令"不手抄 Remote 客户端签名"。`@Remote` 装饰器只有经过官方生成器，
   才会产出 `TypertRemoteNamespaceMap` 的类型合并与调用 codec；手写这两样东西
   等于自己维护一套会和 Host 现场漂移的镜像。

   ▍为什么 mode 是 workspace
   生成器分析的是"一个 TS 程序里的所有显式贡献包"，单包模式仍然要先找到根
   （tsconfig.host.json + packages/）。用 workspace 模式一次生成全部贡献包，
   代价只是多建一个编译程序，换来的是不会漏掉本包。

   ▍修改铁律
   1. 【不】在本文件里改产物路径：exports 与 files 都钉死了 lib/typert.*。
   2. 【不】把 @deepseek-ai/* 打进产物：Cordis/storage 必须与宿主同一实例，
      否则 DomainFacility 会变成第二份、schedule 服务也拿不到。
   ================================================================ */
import { typertPlugin } from '@deepseek-ai/dsh-typert-generator/tsdown'
import type { UserConfig } from 'tsdown'

const config: UserConfig = {
  name: '@xtcausal/dot-work',
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
  plugins: [typertPlugin({ mode: 'workspace', faces: ['host'] })],
}

export default config
