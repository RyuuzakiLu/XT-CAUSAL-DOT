/* ================================================================
   DOT 记忆 · XTMEM 适配器（"接线盒"）

   ▍这是什么
   把 XTMEM 引擎（独立 Python 进程，vendored 在本包 vendor/xtmem/）接成 Node 侧可用的
   MemoryEngine 接口：search / store / correct / forget / get / list / status。

   ▍为什么走子进程而不是 import 引擎
   ① 真引擎是 Python；② 引擎有自己的进程级状态（WAL、FTS、embedding 缓存、观测端口），
   直接在同进程反复构造会互相踩；③ 子进程给了一道天然隔离：一次调用一个干净进程，
   引擎崩了不会带走 Host。代价是每次调用有 ~0.6s 启动开销（实测 jieba 词典加载）。
   —— 像打电话问档案室，而不是把档案室搬进办公室。

   ▍身份/域/库从哪来（安全边界）
   全部来自插件配置（`MemoryEngineConfig`）。**请求对象里没有这些字段**，
   模型工具与前端 Remote 也都不接受它们。库路径只允许在"测试模式"下由适配器
   显式传入；生产装配不允许模型或前端指定任何路径。
   —— 门禁卡由物业发，访客不能现场填号码。

   ▍修改铁律
   1. 【不】让任何请求参数流进 env 的 XTMEM_ACTOR / XTMEM_DB_PATH。这两个只从配置取。
   2. 【不】在失败时返回空数组冒充"没有记忆"；失败抛 MemoryEngineError，由上层如实报。
   3. 【不】把引擎 stdout 的原始噪音（jieba 词典提示）当成协议；协议只认最后一行合法 JSON。
   4. 【不】复用子进程（当前实现每次调用新起一个）：引擎未做多调用常驻契约，
      复用会把"上一次写入的 WAL 未落盘"这类状态带进来，故障难查。
   5. 超时必须真的杀掉子进程；不能只 reject 还留个 python 在后台写库。

   ▍特殊机制
   "最后一行的 JSON"：引擎会先往 stderr 打 jieba 加载提示，stdout 里也可能有噪音；
   本适配器从 stdout 末尾往前找第一个能 parse 成对象的行。找不到就是协议失败（抛错）。
   ================================================================ */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MemoryHit } from './types.ts'

/** 引擎调用失败（区别于"没有命中"）。 */
export class MemoryEngineError extends Error {
  readonly code: 'memory/engine-unavailable' | 'memory/engine-failed' | 'memory/engine-timeout' | 'memory/rejected'
  constructor(
    code: 'memory/engine-unavailable' | 'memory/engine-failed' | 'memory/engine-timeout' | 'memory/rejected',
    message: string,
  ) {
    super(message)
    this.name = 'MemoryEngineError'
    this.code = code
  }
}

/** 适配器配置：身份/域/路径只在这里出现。 */
export interface MemoryEngineConfig {
  /** Python 解释器（默认 `python`）。 */
  readonly python?: string
  /** 独立库文件路径；必填——绝不回落到引擎默认库（那可能是生产库）。 */
  readonly dbPath: string
  /** 引擎工作目录（WAL 落 `<workspace>/.hermes/memory/wal`）。 */
  readonly workspaceDir: string
  /** 本端身份（引擎的 actor）；写库与可见性过滤都用它。 */
  readonly actor: string
  /** 默认域（引擎的 namespace）。 */
  readonly namespace: string
  /** 单次调用超时（毫秒）。 */
  readonly timeoutMs?: number
  /** 引擎源码根（`.../memory`）；不传则用包内 vendor。 */
  readonly engineRoot?: string
  /** CLI 入口（`.../xtmem.py`）；不传则用包内 vendor。 */
  readonly cliPath?: string
  /** 纠正桥脚本；不传则用包内 scripts/xtmem_correct.py。 */
  readonly correctScript?: string
  /** 单次检索默认条数。 */
  readonly defaultTop?: number
}

/** 引擎层的能力面（供 service 与测试共用；不含任何"任意路径"参数）。 */
export interface MemoryEngine {
  /** 语义检索。 */
  search(query: string, options?: { top?: number; project?: string }): Promise<{
    hits: readonly MemoryHit[]
    mode: string
    verdict?: string
  }>
  /** 写一条记忆（引擎 operationId 真幂等）。 */
  store(input: { text: string; operationId?: string; project?: string; importance?: number; tags?: readonly string[] }):
    Promise<{ id?: string; action: 'created' | 'idempotent' | 'skipped' | 'rejected'; reason?: string }>
  /** 纠正：新条目 + 旧条目退役（引擎真指针）。 */
  correct(input: { id: string; text: string; operationId?: string; reason?: string }):
    Promise<{ id: string; supersededId: string; action: 'corrected' }>
  /** 删除：未确认只预览；确认才归档 + 登记存根。 */
  forget(input: { id: string; confirmed: boolean }): Promise<{
    removed: number; pending?: number; preview?: readonly string[]; tombstoneRegistered?: boolean
  }>
  /** 按 id 精确读取。 */
  get(id: string): Promise<MemoryHit | undefined>
  /** 关键词/最近列表。 */
  list(options?: { query?: string; limit?: number; project?: string }): Promise<readonly MemoryHit[]>
  /**
   * 能力状态。
   * `namespace` 是**有效域**（实际读写的那个），不是配置里原样抄来的值——
   * 界面必须展示这个，否则会出现"配置说 dot-personal、实际写 dot-user"的错位。
   */
  status(): Promise<{ available: boolean; namespace: string; reason?: string; engineVersion?: string }>
}

/** 引擎 CLI 返回的原始条目（字段名与引擎一致，逐项映射成 MemoryHit）。 */
interface RawItem {
  id?: unknown
  content?: unknown
  score?: unknown
  importance?: unknown
  namespace?: unknown
  project?: unknown
  timestamp?: unknown
  updated_at?: unknown
  tier?: unknown
  track?: unknown
  state?: unknown
  superseded_by?: unknown
}

/**
 * 把引擎条目映射成本包统一形状。
 * 为什么集中一处映射：引擎字段名（content / updated_at / superseded_by）与前端词汇不同，
 * 分散在各调用点改会在下次引擎加字段时漏改一半。
 * @param raw - 引擎返回的条目
 * @returns 统一命中形状
 */
function toHit(raw: RawItem): MemoryHit {
  const seconds = typeof raw.updated_at === 'number' ? raw.updated_at
    : (typeof raw.timestamp === 'number' ? raw.timestamp : undefined)
  return {
    id: String(raw.id ?? ''),
    text: String(raw.content ?? ''),
    ...(typeof raw.score === 'number' ? { score: raw.score } : {}),
    ...(typeof raw.importance === 'number' ? { importance: raw.importance } : {}),
    namespace: String(raw.namespace ?? ''),
    ...(typeof raw.project === 'string' && raw.project !== '' ? { project: raw.project } : {}),
    // ⚠️ 引擎给的是**秒**（float），对外统一毫秒；混用会让界面显示 1970 年。
    ...(seconds === undefined ? {} : { updatedAt: Math.round(seconds * 1000) }),
    ...(typeof raw.tier === 'string' ? { tier: raw.tier } : {}),
    ...(typeof raw.track === 'string' ? { track: raw.track } : {}),
    ...(typeof raw.state === 'string' ? { state: raw.state } : {}),
    ...(typeof raw.superseded_by === 'string' && raw.superseded_by !== ''
      ? { supersededBy: raw.superseded_by } : {}),
  }
}

/** 包内 vendor 路径（构建后仍在包根，因此用 import.meta.url 反推，不写死盘符）。 */
function packageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  // 源码布局是 <pkg>/src/，构建产物是 <pkg>/lib/；两种情况都往上退一级。
  return resolve(here, '..')
}

/** 找 vendored CLI（`vendor/xtmem/xtmem.py`）。 */
function defaultCliPath(): string {
  return join(packageRoot(), 'vendor', 'xtmem', 'xtmem.py')
}

/** 找 vendored 引擎根（`vendor/xtmem/memory`）。 */
function defaultEngineRoot(): string {
  return join(packageRoot(), 'vendor', 'xtmem', 'memory')
}

/** 找纠正桥脚本（`scripts/xtmem_correct.py`）。 */
function defaultCorrectScript(): string {
  return join(packageRoot(), 'scripts', 'xtmem_correct.py')
}

/** 一次子进程调用的结果。 */
interface RunResult {
  readonly stdout: string
  readonly stderr: string
  readonly code: number | null
}

/**
 * 起一个 Python 子进程跑 CLI，收集输出。
 * ⚠️【不】把 process.env 原样继承：宿主环境里的 XTMEM_ACTOR / XTMEM_DB_PATH /
 *   XTMEM_HERMES_HOME 会劫持本适配器显式指定的身份与库（引擎自己的注释里也点了这个坑）。
 * @param python - 解释器
 * @param argv - CLI 参数
 * @param env - 显式构造的环境
 * @param timeoutMs - 超时（真杀进程）
 * @returns 收集到的输出
 */
function runChild(python: string, argv: readonly string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(python, [...argv], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (fn: () => void): void => { if (!settled) { settled = true; fn() } }
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* 已退出 */ }
      finish(() => reject(new MemoryEngineError('memory/engine-timeout', `引擎调用超时（${timeoutMs}ms）`)))
    }, timeoutMs)
    timer.unref?.()
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', (error: Error) => {
      clearTimeout(timer)
      finish(() => reject(new MemoryEngineError('memory/engine-unavailable',
        `无法启动 Python（${python}）：${error.message}`)))
    })
    child.on('close', (code: number | null) => {
      clearTimeout(timer)
      finish(() => resolvePromise({ stdout, stderr, code }))
    })
  })
}

/**
 * 从输出里取最后一个能 parse 的 JSON 对象。
 * 为什么从后往前：引擎在 JSON 之后可能还有清理日志；从前往后会把噪音也当成协议。
 * @param stdout - 子进程标准输出
 * @returns 解析出的对象；找不到返回 undefined
 */
function lastJsonObject(stdout: string): Record<string, unknown> | undefined {
  const lines = stdout.split(/\r?\n/)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (line === undefined) continue
    const trimmed = line.trim()
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) continue
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch { /* 继续往前找 */ }
  }
  return undefined
}

/**
 * 构造 XTMEM 适配器。
 * @param config - 身份/域/路径配置（唯一来源）
 * @returns 引擎接口实现
 */
export function createXtmemEngine(config: MemoryEngineConfig): MemoryEngine {
  const python = config.python ?? 'python'
  const dbPath = config.dbPath
  if (dbPath.trim() === '') {
    // 空库路径会退到引擎默认库（可能是生产库）——这是绝不能发生的回落。
    throw new MemoryEngineError('memory/engine-unavailable', 'dbPath 为空：拒绝使用引擎默认库（可能是生产库）')
  }
  const engineRoot = config.engineRoot ?? defaultEngineRoot()
  const cliPath = config.cliPath ?? defaultCliPath()
  const correctScript = config.correctScript ?? defaultCorrectScript()
  const timeoutMs = config.timeoutMs ?? 120_000
  const defaultTop = config.defaultTop ?? 5

  /** 构造子进程环境：身份与库只从配置取，其余一律清洗。 */
  const baseEnv = (): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = { ...process.env }
    // 管理员凭据绝不继承（与官方 XTMEM DSH 接头同口径）。
    delete env.XTMEM_ADMIN
    delete env.XTMEM_ADMIN_TOKEN
    delete env.XTMEM_SERVE_TOKEN
    // 宿主可能塞了别的库/插件根，这里一律覆盖成显式值。
    delete env.XTMEM_HERMES_HOME
    delete env.HERMES_HOME
    delete env.MIMOX_HOME
    env.XTMEM_ACTOR = config.actor
    env.XTMEM_DB_PATH = dbPath
    env.XTMEM_HERMES_ROOT = engineRoot
    env.PYTHONIOENCODING = 'utf-8'
    env.PYTHONUTF8 = '1'
    return env
  }

  /** 跑一条 CLI 子命令并解析 JSON。 */
  const cli = async (argv: readonly string[]): Promise<Record<string, unknown>> => {
    if (!existsSync(cliPath)) {
      throw new MemoryEngineError('memory/engine-unavailable', `找不到 XTMEM CLI：${cliPath}`)
    }
    const result = await runChild(python, [cliPath, ...argv], baseEnv(), timeoutMs)
    const parsed = lastJsonObject(result.stdout)
    if (parsed === undefined) {
      // 引擎协议失败：明确报错，不返回空结果冒充"没有记忆"。
      const tail = result.stderr.trim().split(/\r?\n/).slice(-3).join(' | ')
      throw new MemoryEngineError('memory/engine-failed',
        `引擎输出无法解析（exit=${String(result.code)}）：${tail || result.stdout.slice(0, 200)}`)
    }
    return parsed
  }

  /** 跑纠正桥（stdin JSON 协议）。 */
  const correctViaBridge = async (payload: Record<string, unknown>): Promise<Record<string, unknown>> => {
    if (!existsSync(correctScript)) {
      throw new MemoryEngineError('memory/engine-unavailable', `找不到纠正桥：${correctScript}`)
    }
    const body = JSON.stringify(payload)
    return new Promise((resolvePromise, reject) => {
      const child = spawn(python, [correctScript], { windowsHide: true, env: baseEnv(), stdio: ['pipe', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      let settled = false
      const finish = (fn: () => void): void => { if (!settled) { settled = true; fn() } }
      const timer = setTimeout(() => {
        try { child.kill() } catch { /* 已退出 */ }
        finish(() => reject(new MemoryEngineError('memory/engine-timeout', `纠正桥超时（${timeoutMs}ms）`)))
      }, timeoutMs)
      timer.unref?.()
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => { stdout += chunk })
      child.stderr.on('data', (chunk: string) => { stderr += chunk })
      child.on('error', (error: Error) => {
        clearTimeout(timer)
        finish(() => reject(new MemoryEngineError('memory/engine-unavailable', `无法启动纠正桥：${error.message}`)))
      })
      child.on('close', (code: number | null) => {
        clearTimeout(timer)
        const parsed = lastJsonObject(stdout)
        if (parsed === undefined) {
          finish(() => reject(new MemoryEngineError('memory/engine-failed',
            `纠正桥输出无法解析（exit=${String(code)}）：${stderr.trim().split(/\r?\n/).slice(-3).join(' | ')}`)))
          return
        }
        finish(() => resolvePromise(parsed))
      })
      child.stdin.end(body, 'utf8')
    })
  }

  const actor = config.actor
  const namespace = config.namespace
  /*
   * ★有效域（effectiveNamespace）：读写纠正删除查询上下文必须全部用它★
   *
   * 病灶与教训（2026-10-23，主端当场指出）：
   *   ① 若写入域收敛到 actor、而读取仍用配置的 namespace ⇒ **存得进、搜不到**，
   *      模型以为记住了，召回永远空——比直接拒写更坏，因为它不报错。
   *   ② 若照配置写 actor≠namespace 的域 ⇒ 引擎硬规则「本端只能写本域」把每条写入都拒，
   *      整条记忆链静默失效（活 Host 实测撞到）。
   * 两者都是"双域"造成的。唯一正确解：**一个有效域贯穿全链**。
   *
   * 取值规则（不猜、不悄悄改语义）：
   *   · namespace === actor → 用它（推荐装配，identity 与域同名）；
   *   · namespace === 'knowledge' → 用它（引擎唯一允许跨身份写的共享知识域）；
   *   · 其他组合 → 取 actor，并且随后 status() 回报的 namespace 也是它（同一个值，
   *     界面看到的域必然等于实际读写的域，不会出现"配置说 A、实际用 B"）。
   * ⚠️【不】把这个值只用在写入侧：read/write/correct/get/forget/prompt 注入全部同源。
   */
  const writeNamespace = namespace === actor || namespace === 'knowledge' ? namespace : actor

  return {
    async search(query, options = {}) {
      const top = options.top ?? defaultTop
      const argv = ['recall', '--query', query, '--top', String(top), '--namespace', writeNamespace, '--as', actor]
      if (options.project !== undefined && options.project !== '') argv.push('--project', options.project)
      const raw = await cli(argv)
      if (raw.ok !== true) {
        throw new MemoryEngineError('memory/engine-failed', `recall 失败：${String(raw.error ?? 'unknown')}`)
      }
      const items = Array.isArray(raw.items) ? raw.items as RawItem[] : []
      return {
        hits: items.map(toHit),
        mode: String(raw.mode ?? 'unknown'),
        ...(typeof raw.verdict === 'string' ? { verdict: raw.verdict } : {}),
      }
    },

    async store(input) {
      // ⚠️【不】给 store 传 --as：引擎的 store 只认 XTMEM_ACTOR 环境变量，多传会让 argparse 退出码 2。
      const argv = ['store', '--agent', actor, '--namespace', writeNamespace, '--text', input.text,
        '--importance', String(input.importance ?? 0.5), '--tier', 'refined', '--visibility', 'shared']
      if (input.project !== undefined && input.project !== '') argv.push('--project', input.project)
      if (input.tags !== undefined && input.tags.length > 0) argv.push('--tags', input.tags.join(','))
      if (input.operationId !== undefined && input.operationId !== '') argv.push('--operation-id', input.operationId)
      const raw = await cli(argv)
      const ok = raw.ok === true
      const action = String(raw.action ?? (ok ? 'created' : 'rejected'))
      return {
        ...(typeof raw.id === 'string' ? { id: raw.id } : {}),
        action: (action === 'created' || action === 'idempotent' || action === 'skipped'
          ? action : 'rejected') as 'created' | 'idempotent' | 'skipped' | 'rejected',
        ...(ok ? {} : { reason: String(raw.error ?? 'store rejected') }),
      }
    },

    async correct(input) {
      const payload = {
        engineRoot,
        dbPath,
        workspaceDir: config.workspaceDir,
        actor,
        namespace: writeNamespace,
        oldId: input.id,
        text: input.text,
        reason: input.reason ?? 'corrected by user',
        operationId: input.operationId ?? '',
        importance: 0.7,
        tags: ['corrected'],
        hostOrigin: `dot:${actor}`,
      }
      const raw = await correctViaBridge(payload)
      if (raw.ok !== true) {
        throw new MemoryEngineError('memory/rejected', `纠正失败：${String(raw.error ?? 'unknown')}`)
      }
      const newId = String(raw.id ?? '')
      if (newId === '') {
        // 引擎判定重复：内容已一致，没有新条目；如实报告而不是伪造一个 id。
        throw new MemoryEngineError('memory/rejected',
          `纠正未生效：${String(raw.note ?? '新内容与既有条目重复，未新建')}`)
      }
      return { id: newId, supersededId: String(raw.supersededId ?? input.id), action: 'corrected' }
    },

    async forget(input) {
      if (!input.confirmed) {
        const raw = await cli(['forget', '--id', input.id, '--as', actor])
        if (raw.ok !== true) throw new MemoryEngineError('memory/rejected', `删除预览失败：${String(raw.error ?? 'unknown')}`)
        return {
          removed: Number(raw.removed ?? 0),
          ...(typeof raw.pending === 'number' ? { pending: raw.pending } : {}),
          ...(Array.isArray(raw.preview) ? { preview: raw.preview.map(String) } : {}),
        }
      }
      const raw = await cli(['forget', '--id', input.id, '--as', actor, '--confirm'])
      if (raw.ok !== true) throw new MemoryEngineError('memory/rejected', `删除失败：${String(raw.error ?? 'unknown')}`)
      return {
        removed: Number(raw.removed ?? 0),
        ...(typeof raw.tombstone_registered === 'boolean' ? { tombstoneRegistered: raw.tombstone_registered } : {}),
      }
    },

    async get(id) {
      const raw = await cli(['lookup', '--id', id, '--as', actor])
      if (raw.ok !== true) {
        throw new MemoryEngineError('memory/engine-failed', `lookup 失败：${String(raw.error ?? 'unknown')}`)
      }
      const items = Array.isArray(raw.items) ? raw.items as RawItem[] : []
      const first = items[0]
      return first === undefined ? undefined : toHit(first)
    },

    async list(options = {}) {
      const argv = ['lookup', '--top', String(options.limit ?? 30), '--namespace', writeNamespace, '--as', actor]
      if (options.query !== undefined && options.query !== '') argv.splice(1, 0, '--query', options.query)
      const raw = await cli(argv)
      if (raw.ok !== true) {
        throw new MemoryEngineError('memory/engine-failed', `lookup 失败：${String(raw.error ?? 'unknown')}`)
      }
      const items = Array.isArray(raw.items) ? raw.items as RawItem[] : []
      return items.map(toHit)
    },

    async status() {
      if (!existsSync(cliPath)) {
        return { available: false, namespace: writeNamespace, reason: `找不到 XTMEM CLI：${cliPath}` }
      }
      if (!existsSync(engineRoot)) {
        return { available: false, namespace: writeNamespace, reason: `找不到 XTMEM 引擎：${engineRoot}` }
      }
      // 只探测"能不能跑通一次只读查询"，不写任何东西。
      try {
        const raw = await cli(['lookup', '--top', '1', '--namespace', writeNamespace, '--as', actor])
        if (raw.ok !== true) {
          return { available: false, namespace: writeNamespace, reason: String(raw.error ?? 'lookup 失败') }
        }
        return { available: true, namespace: writeNamespace, engineVersion: 'xtmem 1.1.0.dev0 (vendored)' }
      } catch (error: unknown) {
        return { available: false, namespace: writeNamespace, reason: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}
