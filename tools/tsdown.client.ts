/* ================================================================
   DOT Client 包构建预设 · 总导游图

   ▍这是什么
   树外 DOT Client 插件包的 tsdown 配置工厂，复刻 DSH 官方 0.2.1-rc.2 的产物契约：
   浏览器补丁必须由 `window.__ModuleLoader__.load({ id, factory: (require) => {...} })`
   注册，外层是 CJS 工厂、内部通过注入的 require 解析模块表（React、Cordis、
   ui-slots 等由 shell 预先塞进模块表），而不是原生 ESM import。

   ▍为什么必须照抄这个形状
   官方 modules 行按 `/plugins/<包名>/client.js` 取资源，然后在冻结的模块表里执行
   factory。产物形态一旦写成 ESM，浏览器端 `require` 拿不到 React 身份，会出现
   第二份 React（hook 报错）或直接 "cannot find module"。
   —— 所以这里不是"我喜欢这么打包"，是宿主契约。

   ▍结构
   readManifest()：读包名，作为 __ModuleLoader__ 的 id 与 CSS 标签归属。
   clientBundle()：返回 [Node 面 ESM, Client 面 CJS 工厂] 两份 tsdown 配置。
   cssPlugin()：.module.css → 注入 <style> + 导出类名映射；.css → 只注入。

   ▍修改铁律
   1. 【不】改 banner/footer/intro 三段文字——它们就是模块加载契约本身。
   2. 【不】把 baseline 里的包（react / cordis / ui-slots / ui-primitives /
      client-store / ui-dockkit / zod / @tanstack/react-virtual）加进
      dsh.client.external；重复声明会让模块身份漂移。
   3. 【不】让 Client 面 runtime import 另一个功能插件的值；跨插件走 Cordis 服务
      或 slot，类型共享用 import type（类型会被擦除，不触发 externals 检查）。
   4. 产物文件名固定 client.js / lib/index.js；改名会让 package.json 的
      exports 与 files 一起烂掉。

   ▍更新记录
   2026-10-23 · 建立：从官方 packages/client/tsdown.client.ts 抽取最小必需面，
                去掉仓库级 purity 门禁与 source map 链（树外包不参与上游门禁）。
   ================================================================ */
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, relative as relativePath, resolve as resolvePath } from 'node:path'
import { transform } from 'lightningcss'
import type { TsdownPlugin, UserConfig } from 'tsdown'

/**
 * shell 已经塞进模块表的名字。任何包都可以直接 import 它们而保持单一份实例；
 * 同时它们也永远不进 dsh.client.external（重复声明会漂移身份）。
 */
const PLATFORM_MODULES: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

/** 可以放心内联的纯协议/纯工具层：没有需要跨插件共享的运行时身份。 */
const INLINE_SAFE = /^@deepseek-ai\/dsh-(?:typert-protocol|brand|deque|output-retention|file-reference|session|llm|tools|util-crypto|util-values|util-workspace-path)(?:\/|$)/

/** 生成的 Remote 描述符产物：内联是设计本意（它就是 wire 词汇表）。 */
const GENERATED_REMOTE = /^@deepseek-ai\/[a-z0-9-]+\/remote$/

interface Manifest {
  readonly name?: string
  readonly dsh?: { readonly client?: { readonly external?: readonly string[] } } }

/**
 * 读 manifest 只为一件事：包名即模块 id。
 * @param packageDir - 包目录（通常是配置文件的 import.meta.dirname）
 * @returns 包名与包级 external 请求
 * @throws 包没有名字时——没有 id 的工厂根本注册不进去
 */
function readManifest(packageDir: string): { name: string; external: readonly string[] } {
  const manifest = JSON.parse(readFileSync(resolvePath(packageDir, 'package.json'), 'utf8')) as Manifest
  if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
    throw new Error(`dot tsdown: ${packageDir}/package.json 没有 name，无法生成模块 id`)
  }
  return { name: manifest.name, external: manifest.dsh?.client?.external ?? [] }
}

/**
 * 把一条样式注入写成"执行期挂 <style>"的模块。
 * 为什么不是构建期产出独立 CSS 文件：插件包按 client.js 单资源取回，没有额外的
 * 样式资源路由；标签归属用 data-plugin-css 去重，保证 HMR 重挂不叠加。
 * @param id - 包名（标签归属与去重键前缀）
 * @param fileId - 样式文件绝对路径
 * @param css - 已编译的 CSS 文本
 * @param classMap - CSS Modules 的 局部名 → 哈希名 映射（普通 .css 传 undefined）
 * @returns 模块源码
 */
function styleModule(id: string, fileId: string, css: string, classMap?: Readonly<Record<string, string>>): string {
  const tagId = `${id}/${basename(fileId)}`
  // ⚠️ 这里**绝不**在模块求值时就插 <style>。
  // 为什么：模块求值发生在插件 apply 之前、且没有卸载钩子——插件被停用/重挂时，
  // 样式会留在 document 里变成无法回收的残留（实测会和新版本样式叠加）。
  // 正确做法：本模块只导出样式文本与类名映射，由插件在自己的 ctx.effect 里
  // 插入并在清理函数里移除。创建资源的人负责关闭。
  const lines = [
    `/** 插件样式的唯一来源：由 apply 在 ctx.effect 里插入 <style data-plugin-css> 并在清理时移除。 */`,
    `export const cssText = ${JSON.stringify(css)};`,
    `/** 这份样式在 document 上的稳定身份（包名/文件名），供去重与清理定位。 */`,
    `export const cssTagId = ${JSON.stringify(tagId)};`,
    `/** 把这些样式挂进文档；返回移除函数，交给 ctx.effect 持有。 */`,
    'export function attachStyle() {',
    '  if (typeof document === "undefined") return () => {};',
    '  const existing = document.querySelector("style[data-plugin-css=" + JSON.stringify(cssTagId) + "]");',
    '  if (existing !== null) return () => { existing.remove(); };',
    '  const tag = document.createElement("style");',
    `  tag.dataset.plugin = ${JSON.stringify(id)};`,
    '  tag.dataset.pluginCss = cssTagId;',
    '  tag.textContent = cssText;',
    '  document.head.appendChild(tag);',
    '  return () => { tag.remove(); };',
    '}',
    classMap === undefined ? 'export {};' : `export default ${JSON.stringify(classMap)};`,
  ]
  return lines.join('\n')
}

/**
 * CSS / CSS Modules 内联插件。
 * ⚠️ 虚拟 id 特意不以 `.css` 结尾：tsdown 自己的 css 管线会抢走这类 id。
 * @param packageName - 包名，用于 <style> 归属与去重
 * @returns tsdown 插件
 */
/**
 * 类名哈希只认「包名 + 样式文件在包内的相对路径」，不认绝对路径。
 * 为什么：lightningcss 的 [hash] 取自 filename。以前传绝对路径，同一份样式在别的文件夹
 * 里构建，前缀就变（2026-10-30 f96a024：外壳在另一个目录构建，前缀 QuV2nW；对话空间还是
 * 旧前缀 _84Ajva，对话空间整页丢样式）。现在不管在哪个目录构建，同一份源码得到同一个前缀。
 * @param packageName - 包名
 * @param packageDir - 包目录
 * @param fileId - 样式文件绝对路径
 * @returns 稳定的哈希输入
 */
export function stableCssFilename(packageName: string, packageDir: string, fileId: string): string {
  const rel = relativePath(packageDir, fileId).split('\\').join('/')
  return rel.startsWith('..') ? fileId : `${packageName}/${rel}`
}

function cssPlugin(packageName: string, packageDir: string): TsdownPlugin {
  // ⚠️ 虚拟 id 末尾**不能**是 .css：tsdown 的 css 管线按后缀抢单，会要求装 @tsdown/css。
  const VIRTUAL = '\0dot-css:'
  const SUFFIX = '\0dot-style'
  return {
    name: 'dot-css-inline',
    resolveId(source: string, importer?: string) {
      if (!source.endsWith('.css')) return null
      const abs = source.startsWith('.') && importer !== undefined
        ? resolvePath(dirname(importer), source)
        : source
      return VIRTUAL + abs + SUFFIX
    },
    load(virtualId: string) {
      if (!virtualId.startsWith(VIRTUAL)) return null
      const fileId = virtualId.slice(VIRTUAL.length, -SUFFIX.length)
      this.addWatchFile(fileId) // 让 --watch 能看见样式改动
      const isModule = fileId.endsWith('.module.css')
      const { code, exports } = transform({
        filename: stableCssFilename(packageName, packageDir, fileId),
        code: readFileSync(fileId),
        cssModules: isModule ? { pattern: '[hash]_[local]' } : undefined,
        minify: true,
      })
      let classMap: Record<string, string> | undefined
      if (isModule) {
        classMap = {}
        for (const [local, exp] of Object.entries(exports ?? {})) classMap[local] = exp.name
      }
      return styleModule(packageName, fileId, code.toString(), classMap)
    },
  }
}

/**
 * 给一个 DOT 包生成 Node 面 + Client 面两份 tsdown 配置。
 *
 * 用法（包内 tsdown.config.ts 全文）：
 *   import { clientBundle } from '../../tools/tsdown.client.ts'
 *   export default clientBundle(import.meta.dirname)
 *
 * @param packageDir - 包目录
 * @param options.nodeEntry - Node 面入口，默认 src/index.ts
 * @param options.clientEntry - Client 面入口；省略时自动探测 src/client/index.tsx/.ts
 * @returns tsdown 配置数组
 */
export function clientBundle(
  packageDir: string,
  options: { readonly nodeEntry?: string; readonly clientEntry?: string | null } = {},
): UserConfig[] {
  const { name, external } = readManifest(packageDir)
  const configs: UserConfig[] = [
    {
      name: `${name}/node`,
      entry: { index: options.nodeEntry ?? 'src/index.ts' },
      outDir: 'lib',
      format: ['esm'],
      platform: 'node',
      target: 'es2023',
      fixedExtension: false,
      dts: false,
      clean: false,
      sourcemap: false,
      // Node 面：@deepseek-ai/* 与 node: 内建保持外部——它们由 profile 的
      // node_modules 提供，绝不能打第二份 Cordis。
      external: [/^@deepseek-ai\//, /^node:/],
    },
  ]

  const detected = options.clientEntry === null
    ? undefined
    : options.clientEntry
      ?? ['src/client/index.tsx', 'src/client/index.ts'].map(p => resolvePath(packageDir, p)).find(p => existsSync(p))
  if (detected === undefined) return configs

  configs.push(browserConfig(packageDir, { name, external }, {
    entryName: 'client',
    entry: detected,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(name)}, factory: (require) => {`,
  }))
  return configs
}

/**
 * 为包内按需块生成一组 tsdown 配置：一块一次构建，产物名 `client.<名字>.js`。
 *
 * ▍为什么一块一份配置、而不是一次多入口
 * tsdown/rolldown 多入口默认会把共用模块拆成共享 chunk（`chunk-xxx.js`）。宿主的
 * on-demand 路由只认 `^client\.[A-Za-z0-9][\w.-]*\.js$` 且只返回"你请求的那一个文件"，
 * 共享 chunk 既不在契约里、也不会被一起取回。所以一块一次构建，代价是共用的小代码
 * 会在多块里重复（几 KB 量级），换来的是每块自洽、能单独加载。
 *
 * ▍为什么必须是 chunk 字段而不是第二份 client.js
 * 宿主注册表用 `包名/chunk文件名` 作为模块 id；少了 `chunk` 字段会被当成包入口重复注册，
 * 直接抛 duplicate factory registration。
 *
 * @param packageDir - 包目录
 * @param chunks - 块名 → 该块入口的相对路径（相对包目录）
 * @returns 每个块一份 tsdown 配置
 */
export function clientChunks(
  packageDir: string,
  chunks: Readonly<Record<string, string>>,
): UserConfig[] {
  const { name, external } = readManifest(packageDir)
  return Object.entries(chunks).map(([chunk, entry]) => {
    const fileName = `client.${chunk}.js`
    return browserConfig(packageDir, { name, external }, {
      entryName: chunk,
      entry: resolvePath(packageDir, entry),
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(name)}, chunk: ${JSON.stringify(fileName)}, factory: (require) => {`,
    })
  })
}

/**
 * 浏览器面 CJS 工厂配置（入口包与按需块共用）。
 * @param packageDir - 包目录（解析外部依赖与纯协议层白名单）
 * @param manifest - 包名与包级 external
 * @param shape - 入口名、入口绝对路径与 loader banner
 * @returns tsdown 配置
 */
function browserConfig(
  packageDir: string,
  manifest: { readonly name: string; readonly external: readonly string[] },
  shape: { readonly entryName: string; readonly entry: string; readonly banner: string },
): UserConfig {
  const { name, external } = manifest
  const requested = new Set<string>([...PLATFORM_MODULES, ...external])
  return {
    name: `${name}/client.${shape.entryName}`,
    entry: { [shape.entryName]: shape.entry },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2023',
    dts: false,
    clean: false,
    sourcemap: false,
    deps: {
      neverBundle: (specifier: string) => requested.has(specifier),
      // 模块表答不上来的 require 一定在浏览器里抛错，所以"没请求的一律内联"。
      alwaysBundle: (specifier: string) => !requested.has(specifier) && !specifier.startsWith('node:'),
    },
    inputOptions: {
      resolve: { conditionNames: ['production', 'browser', 'import', 'module', 'default'] },
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'import.meta.env.MODE': JSON.stringify('production'),
      'import.meta.env': JSON.stringify({ MODE: 'production' }),
    },
    plugins: [purityPlugin(packageDir, name, requested), cssPlugin(name, packageDir)],
    outputOptions: {
      entryFileNames: shape.entryName === 'client' ? 'client.js' : `client.${shape.entryName}.js`,
      // 模块加载契约：id 必须是包名，factory 收 require，尾部把 exports 还给加载器。
      banner: shape.banner,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  }
}

/**
 * 跨插件值导入护城河插件。
 * @param packageDir - 包目录（解析 workspace 依赖用）
 * @param name - 包名（错误信息里点名）
 * @param requested - 已声明 external / 平台基线
 * @returns tsdown 插件
 */
function purityPlugin(packageDir: string, name: string, requested: ReadonlySet<string>): TsdownPlugin {
  return {
    // 跨插件值导入护城河：本包代码若 runtime import 另一个功能插件，要么是模块表
    // 请求（已声明 external），要么是纯协议层（可内联），其余一律构建失败。
    // 为什么必须失败：内联别人的实现会产生第二份状态，而模块表答不上来的 require
    // 会在用户手机上白屏，两者都比构建期报错贵得多。
    name: 'dot-client-purity',
    resolveId(source: string) {
      // ── 未解析的 workspace 导入 → 构建期硬失败 ──
      //
      // 血泪（2026-10-23 实测）：`import workRemote from '@xtcausal/dot-work/remote'`
      // 在 `lib/typert.remote-client.js` 还不存在时，rolldown 只发一条
      // UNRESOLVED_IMPORT 警告、然后**把它当外部依赖留在产物里**，tsdown 照样 exit 0。
      // 结果是"构建成功"的 client.js 里带着 `require("@xtcausal/dot-work/remote")`，
      // 到浏览器才炸——而且体积会莫名缩小，很容易被当成进步。
      // 所以这里显式探测：解析不到就抛出带修复命令的错误，绝不让假绿流出去。
      if (source.startsWith('@xtcausal/')) {
        const require = createRequire(resolvePath(packageDir, 'package.json'))
        try {
          require.resolve(source)
        } catch {
          throw new Error(
            `dot client build: 无法解析 "${source}"。`
            + '它通常指向本包依赖的 Typert 生成产物（./remote），而那个文件还没生成或还没构建。'
            + '请先运行 `node scripts/build-all.mjs`（顺序为 build → typert:gen → build），再重试本包构建。',
          )
        }
        return null
      }
      if (!source.startsWith('@deepseek-ai/')) return null
      if (requested.has(source)) return null
      if (INLINE_SAFE.test(source) || GENERATED_REMOTE.test(source)) return null
      throw new Error(
        `dot client purity: "${source}" 既不在平台基线也不在 ${name} 的 dsh.client.external，`
        + '又不是可内联的协议层——跨插件值导入请改走 Cordis 服务或 Slot，类型共享用 import type',
      )
    },
  }
}

export default clientBundle
