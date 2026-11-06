/* ================================================================
   DOT 记忆 · 插件入口

   ▍这是什么
   Cordis 插件入口：name / inject / apply / Config。apply 只做组装：建服务、注册工具、
   装上下文注入、起 Remote owner，并登记清理。

   ▍为什么身份/域/库是"必填配置"而不是可选
   可选就会有人在没配的时候跑起来，然后回落到引擎默认库——那可能是**生产记忆库**。
   本适配器宁可启动失败，也不允许"没配好就默默连上别的库"。
   —— 像油罐车：宁可打不着火，也不能默认接着别人的油管。

   ▍修改铁律
   1. 【不】给 dbPath / actor / namespace 设默认值或回落值。
   2. 装配失败必须原样抛出（Cordis 标 FAILED），不许 catch 成"部分可用"。
   3. 卸载只撤注册与监听；记忆数据在独立库里，不因插件卸载被删。
   4. 【不】在本文件读密钥、读环境变量来"补全"配置；配置就是唯一来源。
   ================================================================ */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MemoryService } from './service.ts'
import { isCloudMode } from './deployment-mode.ts'
import { MemoryRemote } from './remote.ts'
import { MemoryPromptInjector } from './context.ts'
import { registerMemoryTools } from './tools.ts'

/** Loader 诊断里显示的名字。 */
export const name = 'dot-memory'

/** 硬依赖：工具注册表、提示词装配、Remote 注册面。 */
export const inject = ['tools', 'systemPrompt', 'typert']

/** 插件配置。 */
export interface Config {
  /** 独立 XTMEM 库文件路径（必填；生产绝不复用引擎默认库）。 */
  readonly dbPath: string
  /** 引擎工作目录（WAL 落在其下 `.hermes/memory/wal`）。 */
  readonly workspaceDir: string
  /** 本端身份（引擎 actor）；模型与前端不可覆盖。 */
  readonly actor: string
  /** 默认域（引擎 namespace）；模型与前端不可覆盖。 */
  readonly namespace: string
  /** Python 解释器。 */
  readonly python: string
  /** 引擎源码根（`.../memory`）；留空=用包内 vendor。 */
  readonly engineRoot: string
  /** CLI 入口（`.../xtmem.py`）；留空=用包内 vendor。 */
  readonly cliPath: string
  /** 单次引擎调用超时（毫秒）。 */
  readonly timeoutMs: number
  /** 每轮记忆注入条数；0=关闭注入（工具仍可用）。 */
  readonly contextTop: number
  /** 单条注入最大字符数。 */
  readonly contextMaxChars: number
  /** 是否注入记忆使用规则段。 */
  readonly injectUsageRules: boolean
}

/*
 * 配置 schema。
 * ⚠️ 本地（默认）模式下 dbPath / workspaceDir / actor / namespace 仍然**必填**：
 *   这里只在云端模式下放宽成空串，因为云端的 Agent 侧不直用 Python、不持库文件，
 *   身份也来自工牌而非配置；
 *   真正的"必须配好"校验放在 apply()（本地缺值仍启动失败，绝不会默默连别的库）。
 *   为什么不让 schema 硬 required：云端 launcher 不该为了过校验编一个假磁盘路径。
 */
export const Config: z<Config> = z.object({
  dbPath: z.string().default(''),
  workspaceDir: z.string().default(''),
  actor: z.string().default(''),
  namespace: z.string().default(''),
  python: z.string().default('python'),
  engineRoot: z.string().default(''),
  cliPath: z.string().default(''),
  timeoutMs: z.natural().min(1000).max(600000).default(120000),
  contextTop: z.natural().min(0).max(20).default(5),
  contextMaxChars: z.natural().min(80).max(4000).default(400),
  injectUsageRules: z.boolean().default(true),
})

/** 服务键。 */
export const MEMORY_SERVICE_KEY = 'dotMemory' as const

/*
 * 对外再导出（装配侧/测试从包根取，不摸 src/）。
 */
export { MemoryService } from './service.ts'
export type { MemoryServiceConfig, MemoryServiceStatus } from './service.ts'
/*
 * ⚠️【勿删】必须从包入口静态导出 Remote owner 类。
 *   Typert 生成器靠**静态分析包入口的类型图**发现 `@Remote` 方法；只在 apply 里
 *   `ctx.plugin(MemoryRemote, …)` 动态挂载，生成器看不到这个类，`./remote` 产物就会缺方法，
 *   Client 侧 `ctx.remote.dotMemory.*` 全部落空（表现为"接口在、类型没有"）。
 */
export { MemoryRemote } from './remote.ts'
export type {
  MemoryCorrectValue, MemoryForgetValue, MemoryGetValue, MemoryListValue, MemorySearchValue,
  MemoryStatusValue, MemoryStoreValue, MemoryWatchFrame,
} from './types.ts'
export { MemoryEngineError, createXtmemEngine } from './engine.ts'
export type { MemoryEngine, MemoryEngineConfig } from './engine.ts'
export {
  MemoryPromptInjector, MEMORY_CONTEXT_SECTION, MEMORY_USAGE_SECTION,
} from './context.ts'
export type { MemoryContextConfig } from './context.ts'
export { registerMemoryTools, MEMORY_TOOL_NAMES } from './tools.ts'
export type * from './types.ts'

/**
 * 装配记忆适配。
 * @param ctx - Host 上下文
 * @param config - 已由 schemastery 补齐的配置
 */
export function apply(ctx: Context, config: Config): void {
  const cloud = isCloudMode()
  // 本地模式下"没配好就起不来"必须保住：schema 为了让云端能空着启动放宽了必填，
  // 这里把校验补回来。云端则只要求能拿到数据服务地址（身份走工牌）。
  if (!cloud) {
    const missing = (['dbPath', 'workspaceDir', 'actor', 'namespace'] as const)
      .filter((key) => config[key].trim() === '')
    if (missing.length > 0) {
      throw new Error(`dot-memory: 本地模式缺少必填配置 ${missing.join(' / ')}（拒绝回落到引擎默认库）`)
    }
  }
  const service = new MemoryService({
    dbPath: config.dbPath,
    workspaceDir: config.workspaceDir,
    actor: config.actor,
    namespace: config.namespace,
    python: config.python,
    timeoutMs: config.timeoutMs,
    // 云端模式由 DOT_CLOUD_MODE=1 决定：服务层据此改用 HTTP"电话线"，绝不回落本地 CLI。
    cloud: isCloudMode(),
    ...(config.engineRoot === '' ? {} : { engineRoot: config.engineRoot }),
    ...(config.cliPath === '' ? {} : { cliPath: config.cliPath }),
  })

  ctx.effect(() => registerMemoryTools(ctx.tools, service), 'dot-memory: 模型工具')
  if (config.contextTop > 0 || config.injectUsageRules) {
    const injector = new MemoryPromptInjector(ctx, service, {
      top: config.contextTop,
      maxCharsPerHit: config.contextMaxChars,
      injectUsageRules: config.injectUsageRules,
    })
    ctx.effect(() => () => injector.dispose(), 'dot-memory: 上下文注入')
  }
  ctx.effect(() => ctx.reflect.provide(MEMORY_SERVICE_KEY, service), 'dot-memory: 服务注册')
  ctx.plugin(MemoryRemote, service)
}
