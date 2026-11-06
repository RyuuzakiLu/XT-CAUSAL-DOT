/* ================================================================
   DOT UI 包构建配置（导游图见 tools/tsdown.client.ts）

   ▍这是什么
   复用项目级 clientBundle 预设：Host 面从 src/index.ts 出 lib/index.js，
   Client 面从 src/client/index.tsx 出 lib/client.js（CJS 工厂 + __ModuleLoader__）。
   另加设置、精灵、人物图共 3 个按需块，产物是本目录的 client.<名字>.js。
   （2026-10-27 能力空间整页删除，scene-capabilities 块已撤掉。）

   ▍为什么一块一份配置
   宿主的按需路由只认单个 client.<名字>.js，多入口会被 rolldown 拆出共享 chunk，
   那些共享文件名既不在路由契约里也不会被一起取回。代价是几 KB 的公共代码在块间重复。

   ▍修改铁律
   1. 【不】在这里写死 banner/footer；那是加载契约，改动去 tools/tsdown.client.ts。
   2. 组件样式走 CSS Modules（src/client/*.module.css），不要在这里配独立 CSS 产物。
   3. 新增/改名块必须同时改 src/client/chunks/runtime.ts 的 CHUNK_FILE：
      路由校验的是文件名，两边不一致时浏览器里只会得到一条 404。
   ================================================================ */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve, relative } from 'node:path'
import { transform } from 'lightningcss'
import type { TsdownPlugin } from 'tsdown'
import { clientBundle, clientChunks } from '../../tools/tsdown.client.ts'

// Only GenUI's source CSS needs collection: its public embed imports class maps but
// has no DOT attachStyle calls. Existing DOT CSS lifecycle remains unchanged.
const genuiSource = dirname(createRequire(import.meta.url).resolve('@changfenhuang/dsh-genui/embed'))
const stylesModule = resolve(import.meta.dirname, 'src/client/genui/styles.ts')
function genuiCss(): TsdownPlugin {
  const prefix = '\0dot-genui-css:'
  return {
    name: 'dot-genui-css',
    resolveId(source: string, importer?: string) {
      if (!source.endsWith('.module.css') || !importer?.startsWith(genuiSource + '/')) return null
      return prefix + resolve(dirname(importer), source) + '\0style'
    },
    load(id: string) {
      if (!id.startsWith(prefix)) return null
      const file = id.slice(prefix.length, -6)
      const stable = '@changfenhuang/dsh-genui/src/client/' + relative(genuiSource, file).split('\\').join('/')
      this.addWatchFile(file)
      const result = transform({ filename: stable, code: readFileSync(file), cssModules: { pattern: '[hash]_[local]' }, minify: true })
      const map = Object.fromEntries(Object.entries(result.exports ?? {}).map(([key, value]) => [key, value.name]))
      return `import { registerGenuiStyle } from ${JSON.stringify(stylesModule)}; registerGenuiStyle(${JSON.stringify(stable)}, ${JSON.stringify(result.code.toString())}); export default ${JSON.stringify(map)};`
    },
  }
}
export default [
  ...clientBundle(import.meta.dirname),
  ...clientChunks(import.meta.dirname, {
    settings: 'src/client/entries/settings.ts',
    sprite: 'src/client/entries/sprite.ts',
    art: 'src/client/entries/art.ts',
  }),
].map(config => config.platform === 'browser' ? {
  ...config,
  plugins: [genuiCss(), ...(config.plugins ?? [])],
  // The host only serves client.js / named client.*.js factories, not generic
  // chunks. Inline GenUI's tiny dynamic adapters; vendor engines still load
  // lazily through /plugins/@changfenhuang/dsh-genui/assets/*.js.
  ...(config.name === '@xtcausal/dot-ui-shell/client.client'
    ? { outputOptions: { ...config.outputOptions, codeSplitting: false } }
    : {}),
} : config)
