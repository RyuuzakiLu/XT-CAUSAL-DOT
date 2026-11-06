/* ================================================================
   Typert 生成脚本 · 总导游图

   ▍这是什么
   一条命令做三件事：
   1. 扫描 `packages/*`，把有 tsconfig 的包写进根 `tsconfig.host.json` /
      `tsconfig.client.json` 的 `references`，并把包名映射到源码写进 `paths`。
   2. 生成一份**装饰器身份存根**（见下），让官方生成器认得出 `@Remote`。
   3. 调官方 `WorkspaceTypertGenerator` 分析我们的包，产出
      `lib/typert.host.*` 与 `lib/typert.remote-client.*`。

   ▍为什么要 paths
   官方生成器按**源码面**设计：它用聚合 tsconfig 的 compilerOptions 建 TS 程序，
   再从程序里取"包名 → src 文件"的模块符号去核对导出。上游用 tsconfig paths 把每个
   `@deepseek-ai/dsh-*` 指到源码。树外工程没这套 paths 时，workspace 包会被解析到
   node_modules 里的 `.d.ts`（不在本程序里），`getSymbolAtLocation` 返回 undefined，
   紧接着 `getExportsOfModule(undefined)` 抛 `Cannot read properties of undefined
   (reading 'flags')`。补 paths 是补它要求的前提，不是绕过检查。

   ▍为什么要装饰器身份存根
   生成器判断"这个装饰器是不是 Typert 的 `Remote`"只做两件事
   （analyzer.ts:2084 `isTypeMetaSymbol`）：看符号名，再看它的声明文件属于哪个**已注册包**。
   已注册包只来自 references、且只认 `<root>/packages/**` 下的目录；npm 装的
   `@deepseek-ai/dsh-typert-protocol` 只有 `lib/types/*.d.ts`，永远不在这个范围里，
   于是所有 `@Remote` 都不被识别，报 `publishes Remote artifacts but has no Remote methods`。
   解法是一个**只有识别所需名字**的小存根（不复制整包、不碰 cordis 的合并声明）。
   存根只服务分析：不参与运行、不进产物、不参与类型检查（类型检查走 node_modules 真声明）。

   ▍修改铁律
   1. 【不】把 `checkDiagnostics` 打开：类型检查归各包自己的 `typecheck`。
      这里开着会让一个包的红字冻结所有包的接线产物。代价是"类型不过也可能出产物"，
      所以交付前必须另跑 `pnpm -r typecheck`。
   2. 【不】给存根加真实实现或更多官方包：存根越大，越容易被生成器当成贡献包去分析
      整包声明（实测 cordis 的 `Context` 同时是 interface+class，合并声明直接被拒）。
   3. 【不】给 `./typert`、`./remote` 写 paths —— 生成前它们本来就不存在。
   4. 生成失败必须非零退出，并明确列出跳过哪些包、原因是什么。

   ▍更新记录
   2026-10-23 · 建立；同日收敛：聚合配置 extends 基础 + paths 源码映射 +
                装饰器身份存根（替换早先的整包影子方案）。
   ================================================================ */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WorkspaceTypertGenerator, writeWorkspaceArtifacts } from '@deepseek-ai/dsh-typert-generator'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 生成产物出口，永不写进 paths（生成前不存在）。 */
const GENERATED_SUBPATHS = new Set(['./typert', './remote', './client/typert'])

/**
 * 收集所有"有 package.json 且有 tsconfig"的包目录。
 * 为什么两样都要：只有清单没有 tsconfig 的目录，写进 references 会让 TS 报错；
 * 只有 tsconfig 没有清单的目录，生成器读不到包名。
 * @returns 相对路径列表
 */
function packageDirs() {
  const packagesRoot = join(root, 'packages')
  const dirs = []
  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue // .typert-vendor 是内部目录
    const dir = join(packagesRoot, entry.name)
    if (!existsSync(join(dir, 'package.json')) || !existsSync(join(dir, 'tsconfig.json'))) continue
    dirs.push(`./packages/${entry.name}`)
  }
  return dirs.sort()
}

/**
 * 把一条 export target 反推成源码路径（与生成器内部 sourcePathForExport 同规则）。
 * @param packageRoot - 包目录绝对路径
 * @param target - exports 里的 target，如 `./lib/types/index.d.ts`
 * @returns 期望的源码绝对路径
 */
function sourceForTarget(packageRoot, target) {
  const normalized = target.replace(/^\.\//, '')
  if (normalized.startsWith('lib/types/')) {
    return join(packageRoot, 'src', normalized.slice('lib/types/'.length).replace(/\.d\.(?:mts|cts|ts)$/, '.ts'))
  }
  if (normalized.startsWith('lib/')) {
    return join(packageRoot, 'src', normalized.slice('lib/'.length).replace(/\.(?:mjs|cjs|js|d\.ts)$/, '.ts'))
  }
  return join(packageRoot, normalized)
}

/**
 * 采集 workspace 包的源码 paths。
 * 只收"源码确实存在"的出口：`./typert`、`./remote` 是生成产物，生成前不存在。
 * @param dirs - 包目录列表
 * @returns paths 映射
 */
function sourcePaths(dirs) {
  const paths = {}
  for (const dir of dirs) {
    const manifest = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'))
    if (typeof manifest.name !== 'string') continue
    const exportsField = manifest.exports
    if (exportsField === null || typeof exportsField !== 'object') continue
    for (const [subpath, value] of Object.entries(exportsField)) {
      if (!subpath.startsWith('.') || subpath.includes('*')) continue
      if (GENERATED_SUBPATHS.has(subpath)) continue
      const target = typeof value === 'string' ? value : (value?.types ?? value?.default)
      if (typeof target !== 'string') continue
      const source = sourceForTarget(join(root, dir), target)
      if (!existsSync(source)) continue
      paths[subpath === '.' ? manifest.name : `${manifest.name}/${subpath.slice(2)}`] = [source]
    }
  }
  return paths
}

/**
 * 生成装饰器身份存根并返回它占用的 paths 条目。
 *
 * 存根里只出现生成器识别时会比对的名字（`Remote` / `RemoteScope` /
 * `bindTypertRemote` / `TypertRemoteService`），不引入任何 Cordis 或业务类型——
 * 一旦引入，存根就会把别人的合并声明拖进建模，从而被整体拒绝。
 * @returns 存根目录（相对）与 paths 条目
 */
function writeTypertStub() {
  // ⚠️ 这里只提供**装饰器身份**，不是协议实现。
  //
  // 为什么不用上游真实源码：真实 protocol 源码 import `Events`（cordis）与各 wire map 的
  // 增补方（dsh-session 等）。把它们逐个变成"已注册包"会触发生成器对**合并声明**的硬限制
  // （cordis 的 `Context` 同时是 interface 与 class，analyzer.ts:2161 直接拒绝），
  // 于是链条会无限延长到整棵官方树——那就不是树外工程了。
  //
  // 代价与已知边界（必须如实记录，不糊过去）：
  //   · 装饰器识别、方法签名、参数/返回类型的 codec 全部来自**我们自己的源码**，是真产物；
  //   · `RemoteErrorDetailsMap` 在本程序里为空，所以生成产物里不会出现"官方码表 + 业务码"的
  //     联合类型；运行时抛出的 RemoteError 仍按字符串 code 正常经网关返回（已由 roundtrip 核）。
  //     若将来需要编译期码表联合，正确做法是把 protocol 与 session 的源码面整体纳入工作区
  //     （即改用上游源码树构建），而不是继续给存根加内容。
  const STUB = `/* 由 scripts/gen-typert.mjs 生成：仅供 Typert 分析识别装饰器与 wire map 归属，不参与运行、不进产物、不参与类型检查。 */
export declare function Remote(name: string): MethodDecorator
export declare function Remote(options: { mode?: 'stream'; name?: string }): MethodDecorator
export declare function RemoteScope(context: string, name?: string): MethodDecorator
export declare abstract class TypertRemoteService<T = never> {
  protected constructor(ctx: unknown, serviceKey: string, options?: { namespace?: string })
  readonly typertRemote: unknown
}
export declare class RemoteError extends Error {
  constructor(code: string, message: string, details?: Record<string, unknown>, options?: { cause?: unknown })
}
export declare function remoteErrorOf(value: unknown): RemoteError | undefined
export declare function bindTypertRemote(service: object, serviceKey: string, options?: { namespace?: string }): unknown
export interface TypertLookup<Host = unknown, Wire = unknown> {
  readonly host: Host
  readonly wire: Wire
}
export interface TypertContext<Wire = unknown> {
  readonly wire: Wire
}
export interface TypertResource<Wire = unknown> {
  readonly wire: Wire
}
export interface TypertResourceMap {}
export interface TypertLookupMap {}
export interface TypertContextMap {}
export interface TypertRemoteMap {}
export interface RemoteErrorDetailsMap {}
export interface TypertRemoteNamespaceMap {}
export interface TypertRemoteScopeMap {}
`
  const dir = join(root, 'packages', '.typert-vendor', 'deepseek-ai__dsh-typert-protocol')
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src', 'index.d.ts'), STUB)
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({
    name: '@deepseek-ai/dsh-typert-protocol',
    version: '0.0.0-typert-analysis-stub',
    private: true,
    type: 'module',
    '//': 'Typert 分析用的装饰器身份存根（scripts/gen-typert.mjs 生成）。不参与运行、不进 workspace、不参与类型检查。',
    exports: { '.': { types: './src/index.d.ts', default: './src/index.d.ts' } },
  }, null, 2)}
`)
  writeFileSync(join(dir, 'tsconfig.json'), `${JSON.stringify({
    extends: '../../../tsconfig.base.json',
    compilerOptions: { rootDir: 'src', outDir: 'lib/types', composite: true, tsBuildInfoFile: 'lib/.tsbuildinfo' },
    include: ['src'],
  }, null, 2)}
`)
  return {
    dir: './packages/.typert-vendor/deepseek-ai__dsh-typert-protocol',
    path: ['@deepseek-ai/dsh-typert-protocol', [join(dir, 'src', 'index.d.ts')]],
  }
}

/**
 * 重写一份聚合配置。
 *
 * ⚠️ 必须 `extends` 基础配置：生成器用**这份聚合配置的 compilerOptions** 建立分析程序
 * （analyzer.ts 里 `...aggregate.options`）。只写 files/references 会退回默认 lib
 * （ES5，没有 fetch/AbortController/setTimeout），每个用 Node/浏览器全局的包都报
 * "找不到名字"——看着像包代码坏了，其实只是聚合配置没给环境。
 * @param file - `tsconfig.host.json` 或 `tsconfig.client.json`
 * @param comment - 文件头说明（JSON 里用 `//` 键承载）
 * @param dirs - references 目录列表
 * @param base - 继承的基础配置
 * @param paths - 源码 paths 映射
 */
function writeAggregate(file, comment, dirs, base, paths) {
  const document = {
    '//': comment,
    extends: base,
    // files/include 留空：这份配置只作为"包清单 + 解析面"被生成器读取，
    // 不参与 tsc 构建（各包用自己的 tsconfig 独立编译）。
    files: [],
    references: dirs.map(path => ({ path })),
    compilerOptions: { paths },
  }
  writeFileSync(join(root, file), `${JSON.stringify(document, null, 2)}\n`)
  console.log(`已写入 ${file}（${dirs.length} 个包引用、${Object.keys(paths).length} 条 paths）`)
}

const dirs = packageDirs()
const paths = sourcePaths(dirs)
const stub = writeTypertStub()
console.log(`已生成装饰器身份存根：${stub.dir}`)

writeAggregate(
  'tsconfig.host.json',
  'Host 面聚合：Typert 用这里的 references 发现贡献包、用 paths 把包名解析到源码。由 scripts/gen-typert.mjs 自动生成，不要手改。',
  [...dirs, stub.dir],
  './tsconfig.base.json',
  { ...paths, [stub.path[0]]: stub.path[1] },
)
writeAggregate(
  'tsconfig.client.json',
  'Client 面聚合：与 tsconfig.host.json 成对存在（生成器工作区根判定 + Client 面分析种子）。由 scripts/gen-typert.mjs 自动生成，不要手改。',
  [...dirs, stub.dir],
  './tsconfig.base.client.json',
  { ...paths, [stub.path[0]]: stub.path[1] },
)

const generator = new WorkspaceTypertGenerator(root, { checkDiagnostics: false })
// ⚠️ 只生成我们自己的包：存根也落在 packages/ 下带 exports，生成器会把它一起"发现"，
// 但它是纯声明、没有实现面，被当贡献包分析只会失败。过滤是刻意的。
const contributors = generator.discover()
  .filter(entry => entry.package.startsWith('@xtcausal/'))
  .filter(entry => entry.package !== '@xtcausal/dot-contracts')
console.log(`发现 Typert 贡献包：${contributors.length === 0 ? '（无）' : contributors.map(c => `${c.package}[${c.faces.join('+')}]`).join(', ')}`)
if (contributors.length === 0) {
  console.log('没有包声明 ./typert 出口，跳过生成（不是失败：先落地包再跑本命令）。')
  process.exit(0)
}

/**
 * 全量生成，失败则退回逐包隔离生成。
 *
 * 为什么留退路：全量把全部贡献包放进同一个 TS 程序，任何一包的解析问题都会让别人也拿不到
 * 产物。逐包隔离的代价是跨包声明合并可能不完整，所以只作为退路，并明确打印跳过清单。
 * @returns 产物与跳过清单
 */
function generateAll() {
  try {
    // ⚠️ 只跑 **host** 面：与上游 `scripts/typert-faces.ts` 的 WORKSPACE_TYPERT_FACES 一致。
    // 不传 faces 时生成器会把 client 面也一起分析，而我们的包只发布 Host 反射
    // （没有 `./client/typert` 出口），于是全量生成必然报
    // "must export ./client/typert as …" 然后退回逐包隔离——那样会丢掉跨包声明合并。
    return { artifacts: generator.generateContributors(['host']), skipped: [] }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.log('全量生成失败，改为逐包隔离生成。失败摘要：')
    console.log(message.split(/\r?\n/).slice(0, 4).join(' | '))
    const artifacts = []
    const skipped = []
    for (const contributor of contributors) {
      try {
        artifacts.push(...generateOne(contributor.package))
        console.log(`  已生成 ${contributor.package}`)
      } catch (singleError) {
        const detail = singleError instanceof Error ? singleError.message.split(/\r?\n/)[0] : String(singleError)
        skipped.push({ package: contributor.package, detail })
        console.log(`  跳过 ${contributor.package}：${detail}`)
      }
    }
    return { artifacts, skipped }
  }
}

/**
 * 只让一个包进入分析程序。
 *
 * ▍为什么必须缩到单包
 * `generate(packages)` 只过滤**输出**，不缩小**分析面**：所有 contributor 都会进同一个
 * TS 程序。于是任何一个包的自有类型错误（比如"边界类型没有从 ./types 子路径导出"）
 * 都会让所有包的产物一起生不出来——多代理并行施工时，等于一个人卡住整条接线。
 * 这里改成给该包单独写一份只含它自己的聚合 references，跑完再把完整聚合写回。
 * @param packageName - 要生成的包名
 * @returns 该包产物
 */
function generateOne(packageName) {
  const onlyDir = dirs.find(dir => JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8')).name === packageName)
  if (onlyDir === undefined) throw new Error(`找不到包目录：${packageName}`)
  const aggregate = [onlyDir, stub.dir]
  const fullPaths = { ...paths, [stub.path[0]]: stub.path[1] }
  writeAggregate(
    'tsconfig.host.json',
    'Host 面聚合（单包临时态）：由 scripts/gen-typert.mjs 在逐包隔离生成时写入，跑完会恢复完整清单。',
    aggregate,
    './tsconfig.base.json',
    fullPaths,
  )
  try {
    return new WorkspaceTypertGenerator(root, { checkDiagnostics: false }).generate([packageName], ['host'])
  } finally {
    writeAggregate(
      'tsconfig.host.json',
      'Host 面聚合：Typert 用这里的 references 发现贡献包、用 paths 把包名解析到源码。由 scripts/gen-typert.mjs 自动生成，不要手改。',
      [...dirs, stub.dir],
      './tsconfig.base.json',
      fullPaths,
    )
  }
}

const { artifacts, skipped } = generateAll()
writeWorkspaceArtifacts(root, artifacts)
console.log(`完成：${artifacts.length} 份产物${skipped.length === 0 ? '' : `，跳过 ${skipped.length} 个包`}`)
for (const item of skipped) console.log(`  ✗ ${item.package} — ${item.detail}`)

// 产物已写出但 manifest 没声明出口时给出可执行提示，别让人对着报错猜。
for (const dir of dirs) {
  const manifest = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'))
  if (!contributors.some(c => c.package === manifest.name)) continue
  for (const [subpath, file] of [['./typert', 'typert.host.js'], ['./remote', 'typert.remote-client.js']]) {
    if (manifest.exports?.[subpath] === undefined && existsSync(join(root, dir, 'lib', file))) {
      console.log(`提示：${manifest.name} 已生成 ${subpath} 产物，但 package.json exports 还没有声明它`)
    }
  }
}

if (skipped.length > 0) process.exitCode = 1
