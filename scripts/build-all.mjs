/* ================================================================
   全量装配构建 · 总导游图

   ▍这是什么
   一条命令按**正确顺序**把整棵工程构建出来：
   ① 各包 `build`（tsdown 打包 + tsc 出声明）
   ② Typert 生成（`lib/typert.host.*` / `lib/typert.remote-client.*`）
   ③ 再跑一次各包 `build`，让上一步刚生成的产物进入最终交付物

   ▍为什么必须分两轮、且中间插生成
   生成器的输入是**源码里的类型**，输出的 `./remote` 却是消费者（UI）编译时要 import
   的东西。若只跑一轮：
   - 先 build 再 gen → 包里的 `lib/index.js` 已经打好，但 `./remote` 还没有，
     后续依赖它的包（UI）编译必失败；
   - 先 gen 再 build → `./typert` 出口指向的文件还不存在，生成器自己会失败。
   所以顺序只能是 **build（让 typert 出口的声明先落地）→ gen → build（把新产物打进去）**。
   代价是第二轮很快（Cargo 式的增量缓存帮不了 tsdown，但它本身只要几秒）。

   ▍为什么装饰器降级有两套机制
   包分两类，各自负责把 `@Remote(...)` 降级成运行时可执行的代码：
   - `entry: 'src/index.ts'`（runtime / work）：靠 `typertPlugin` 在打包前用
     `ts.transpileModule` 降级——这类包不先跑 tsc 也能出可运行的 lib；
   - `entry: 'lib/types/index.js'`（memory / postbox）：靠**先跑 tsc** 降级，
     tsdown 只负责把已经合法的 JS 再打一次。
   两种都对，但根脚本不去猜谁是哪类：统一 `build` 跑一遍，两类各自的 build 脚本
   已经把自己的顺序写死了（见各包 package.json）。

   ▍修改铁律
   1. 【不】把两轮合成一轮：中间那次 gen 是刚需（见上）。
   2. 【不】在这里用 `--parallel`：第二轮必须等 gen 完全写完。
   3. 任何一步非零就整体非零——不要"生成失败但继续构建"。

   ▍更新记录
   2026-10-23 · 建立：build → gen → build 三段的显式顺序。
   ================================================================ */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ⚠️ 不要用 `new URL(...).pathname` 取路径：Windows 上它会给出 `/E:/...`（多一个前导斜杠），
// pnpm 的 cwd 拿到这种路径会解析到盘符根。用 fileURLToPath 才是官方正解。
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 选一个能直接 spawn 的 pnpm 可执行名。
 *
 * ▍为什么不能直接写 'pnpm'
 * Windows 上 pnpm 是 `.cmd` 批处理，`spawnSync('pnpm', […])` 不带 shell 会 ENOENT
 * （实测报 `spawnSync pnpm ENOENT`）。而带 `shell: true` 又会让 Node 警告参数未转义。
 * 按平台显式给 `.cmd`：既不用 shell、也不猜。
 * @returns 可执行名
 */
function pnpmCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

/**
 * 找到 pnpm 的 **JS 入口**，用当前 node 进程直接跑。
 *
 * ▍为什么最后走到这一步（两层坑，都实测过）
 * ① `spawnSync('pnpm', […])` 不带 shell → Windows 上 ENOENT（pnpm 是 .cmd 批处理）。
 * ② 换成 `spawnSync('pnpm.cmd', […])` → Node 24 直接 EINVAL：出于 CVE-2024-27980 的修复，
 *    Node 拒绝在**不带 shell** 的情况下执行 .cmd/.bat。
 * ③ 加 `shell: true` 能跑，但 Node 会警告"参数未转义"——本脚本的参数里含包名，虽然可控，
 *    仍不该把命令行当字符串拼。
 * 正解：读 `.cmd` 里指向的真实入口（`node_modules/pnpm/bin/pnpm.mjs`），
 * 用**同一个 node** 执行它。零 shell、零转义、跨平台。
 * @returns `{ command, prefix }`；拿不到时回退到平台默认可执行名
 */
function pnpmInvocation() {
  const shim = process.env.APPDATA === undefined
    ? undefined
    : resolve(process.env.APPDATA, 'npm', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
  if (shim !== undefined && existsSync(shim)) return { command: process.execPath, prefix: [shim] }
  return { command: pnpmCommand(), prefix: [] }
}

/**
 * 跑一条 pnpm 命令并把输出直通。
 * @param args - pnpm 参数
 * @param label - 阶段名（失败时用于定位）
 */
function run(args, label) {
  console.log(`\n=== ${label} ===`)
  // ⚠️ 不用裸 'pnpm'：Windows 上它是 .cmd，spawnSync 不带 shell 会 ENOENT（实测）。
  const invocation = pnpmInvocation()
  const result = spawnSync(invocation.command, [...invocation.prefix, ...args], { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if ((result.status ?? 1) !== 0) throw new Error(`${label} 失败（退出码 ${String(result.status)}）`)
}

/** Host 侧提供方：不 import 别的包的 `./remote`，可以在生成前先构建。 */
const PROVIDERS = [
  '@xtcausal/dot-contracts',
  '@xtcausal/dot-runtime',
  '@xtcausal/dot-work',
  '@xtcausal/dot-memory',
  '@xtcausal/dot-postbox',
  '@xtcausal/dot-bundle',
]
const providerFilters = PROVIDERS.flatMap(name => ['--filter', name])

try {
  // 第 0 步：先让生成器把**类型面脚手架**建起来（`.typert-vendor` 存根 + 聚合 tsconfig）。
  //
  // ▍为什么必须是第 0 步（冷构建血泪，2026-10-23 实测）
  // 包里 tsdown 的 `typertPlugin` 在打包时就要读那份存根来判断"哪些装饰器算 Remote"。
  // 干净树上没有 `.typert-vendor`，第一轮 tsdown 会直接报
  // `publishes Remote artifacts but has no Remote methods`——看着像源码坏了，
  // 其实只是脚手架没生成。而 `typert:gen` 本身带"无产物可跳"的宽容逻辑，
  // 所以让它先跑一次是安全的：它顺手把存根与聚合配置准备好。
  run(['run', 'typert:gen'], '第 0 步：生成类型面脚手架（存根 + 聚合 tsconfig）')
  // 第一轮**只构建提供方**：UI 会 import 各包的 `./remote`，而那是第二轮才有产物，
  // 冷 checkout 上把它放进第一轮必然编译失败（这正是最初遇到的顺序问题）。
  run([...providerFilters, '--workspace-concurrency=3', 'run', 'build'], '第一轮：Host 提供者（不含 UI 消费方）')
  run(['run', 'typert:gen'], 'Typert 生成：typert.host.* 与 typert.remote-client.*')
  // 第二轮全量：提供方重跑以把新产物打进 lib，UI 此时才第一次构建。
  run(['-r', '--workspace-concurrency=3', 'run', 'build'], '第二轮：全量构建（含 UI 消费方）')
  console.log('\n完成：全部包已构建，Typert 产物已就位。')
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
