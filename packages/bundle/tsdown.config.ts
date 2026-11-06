import type { UserConfig } from 'tsdown'

// 组合包本身没有行为：它只交付一份 patch 层，Node 面入口必须存在以便 Host import。
const config: UserConfig = {
  name: '@xtcausal/dot-bundle',
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2023',
  fixedExtension: false,
  dts: false,
  clean: false,
  sourcemap: false,
  deps: { neverBundle: [/^@deepseek-ai\//, /^node:/] },
}
export default config
