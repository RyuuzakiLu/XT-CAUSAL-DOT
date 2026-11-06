/* ================================================================
   DOT 云端补丁（反向同步自线上构建产物 lib/index.js，2026-10-31）
   ----------------------------------------------------------------
   这些代码最早直接手改在构建产物里（split-2026-10-27 worker model、
   dot-cloud-dispatch-2026-10-27），源码里没有。现在搬回源码，构建结果
   与线上那份行为一致；以后改这里，再从源码构建。

   - 后台 Worker 模型：只从环境变量读（DOT_WORKER_PROVIDER / DOT_WORKER_MODEL）。
   - 按账号隔离：工作记录带 owner，只对同账号可见。
   - 两层并发闸（跨进程）：全局 + 每账号名额，状态放在共享目录。
   ================================================================ */
import * as dotFs from 'node:fs'

/**
 * 后台 Worker 模型：只从环境变量读（systemd 从 /path/to/dot-config-worker.env 注入），界面不出现。
 * DOT_WORKER_PROVIDER / DOT_WORKER_MODEL 任一为空 = 后台模型还没接：派活直接拒绝并明说，绝不回退到前台或别的模型。
 */
const DOT_WORK_SESSIONS_KEY = Symbol.for('dot.work.sessions')

export function registerWorkSession(sessionId: unknown): void {
  const bag = globalThis as any
  if (!(bag[DOT_WORK_SESSIONS_KEY] instanceof Set)) bag[DOT_WORK_SESSIONS_KEY] = new Set()
  if (typeof sessionId === 'string') bag[DOT_WORK_SESSIONS_KEY].add(sessionId)
}

// ── DOT 云端派活（dot-cloud-dispatch-2026-10-27）：按账号隔离 + 两层并发闸 + 结果回前台 ──
export const DOT_CLOUD = process.env.DOT_CLOUD_MODE === '1'

/** 当前请求/回合的账号（云端 runtime 的 ALS）；本机模式恒为 undefined。 */
export function dotCloudActor(): string | undefined {
  return (globalThis as any)[Symbol.for('dot.cloud.identity')]?.getStore?.()?.actor
}

/** 后台会话 → 所属账号；runtime 的 runAgent 用它给后台回合恢复账号上下文（不写进 tenancy，不出现在用户会话列表）。 */
export const DOT_WORK_SESSION_OWNERS: Map<string, string> = (globalThis as any)[Symbol.for('dot.work.sessionOwners')] ??= new Map()

/** 这条工作对当前账号可见吗：云端只认 owner === 当前账号；没有账号上下文一律不可见。 */
export function dotOwnerVisible(record: { owner?: string } | undefined): boolean {
  if (!DOT_CLOUD) return true
  const actor = dotCloudActor()
  return actor !== undefined && record?.owner === actor
}

export function dotWorkLimits(): { perAccount: number, global: number } {
  return {
    perAccount: Number(process.env.DOT_WORK_MAX_PER_ACCOUNT) || 2,
    global: Number(process.env.DOT_WORK_MAX_GLOBAL) || 4,
  }
}

interface GateEntry { workId: string, actor: string, pid: number, at: number, seen?: number }
interface GateState { running: GateEntry[], queue: GateEntry[] }

export interface DotWorkGate {
  tryAcquire(workId: string, actor: string | undefined): boolean
  markRunning(workId: string, actor: string | undefined): void
  release(workId: string): void
  sync(queuedIds: Iterable<string>): void
  snapshot(): GateState
}

/**
 * 两层并发闸（跨进程）：状态放在共享目录的 state.json，mkdir 当互斥锁，全同步。
 * running = 正在跑；queue = 先来后到。能不能开跑：按队列顺序模拟分配，
 * 全局没满且本账号没满的才占位，轮到自己才放行。死进程的条目自动清掉。
 */
export function createDotWorkGate(dir: string): DotWorkGate {
  const stateFile = `${dir}/state.json`
  const lockDir = `${dir}/.lock`
  const pid = process.pid
  const sleeper = new Int32Array(new SharedArrayBuffer(4))
  const alive = (other: number): boolean => {
    if (other === pid) return true
    try {
      process.kill(other, 0)
      return true
    } catch (error: any) {
      return error?.code === 'EPERM'
    }
  }
  function withLock<T>(fn: (state: GateState, now: number) => T): T {
    dotFs.mkdirSync(dir, { recursive: true })
    const deadline = Date.now() + 5000
    for (;;) {
      try {
        dotFs.mkdirSync(lockDir)
        break
      } catch (error: any) {
        if (error?.code !== 'EEXIST') throw error
        try {
          if (Date.now() - dotFs.statSync(lockDir).mtimeMs > 5000) {
            dotFs.rmdirSync(lockDir)
            continue
          }
        } catch {}
        if (Date.now() > deadline) throw new Error('dot-work gate: lock timeout')
        Atomics.wait(sleeper, 0, 0, 10)
      }
    }
    try {
      let state: any
      try {
        state = JSON.parse(dotFs.readFileSync(stateFile, 'utf8'))
      } catch {
        state = {}
      }
      const now = Date.now()
      state.running = (Array.isArray(state.running) ? state.running : []).filter((e: GateEntry) => alive(e.pid))
      state.queue = (Array.isArray(state.queue) ? state.queue : []).filter((e: GateEntry) => alive(e.pid) && (e.pid === pid || now - (e.seen ?? 0) < 60000))
      const out = fn(state, now)
      const tmp = `${stateFile}.${pid}.tmp`
      dotFs.writeFileSync(tmp, JSON.stringify(state, null, 1))
      dotFs.renameSync(tmp, stateFile)
      return out
    } finally {
      try {
        dotFs.rmdirSync(lockDir)
      } catch {}
    }
  }
  function eligible(state: GateState, workId: string, limits: { perAccount: number, global: number }): boolean {
    let slots = limits.global - state.running.length
    const counts = new Map<string, number>()
    for (const e of state.running) counts.set(e.actor, (counts.get(e.actor) ?? 0) + 1)
    for (const e of state.queue) {
      if (slots <= 0) return false
      if ((counts.get(e.actor) ?? 0) < limits.perAccount) {
        if (e.workId === workId) return true
        slots -= 1
        counts.set(e.actor, (counts.get(e.actor) ?? 0) + 1)
      }
    }
    return false
  }
  return {
    /** 占一个名额；不够就（首次）排进队尾并返回 false。 */
    tryAcquire(workId, actor) {
      return withLock((state, now) => {
        if (state.running.some((e) => e.workId === workId)) return true
        let entry = state.queue.find((e) => e.workId === workId)
        if (entry === undefined) {
          entry = { workId, actor: actor ?? '', pid, at: now, seen: now }
          state.queue.push(entry)
        }
        entry.seen = now
        if (!eligible(state, workId, dotWorkLimits())) return false
        state.queue = state.queue.filter((e) => e.workId !== workId)
        state.running.push({ workId, actor: actor ?? '', pid, at: now })
        return true
      })
    },
    /** 重启接回的在跑工作：直接记在跑（它们本来就在跑，不重新排队）。 */
    markRunning(workId, actor) {
      withLock((state, now) => {
        state.queue = state.queue.filter((e) => e.workId !== workId)
        if (!state.running.some((e) => e.workId === workId)) state.running.push({ workId, actor: actor ?? '', pid, at: now })
      })
    },
    release(workId) {
      withLock((state) => {
        state.running = state.running.filter((e) => e.workId !== workId)
        state.queue = state.queue.filter((e) => e.workId !== workId)
      })
    },
    /** 本进程的排队条目与本地排队区对齐，并刷新心跳。 */
    sync(queuedIds) {
      const keep = new Set(queuedIds)
      withLock((state, now) => {
        state.queue = state.queue.filter((e) => e.pid !== pid || keep.has(e.workId))
        for (const e of state.queue) if (e.pid === pid) e.seen = now
      })
    },
    snapshot() {
      return withLock((state) => ({
        running: state.running.map((e) => ({ ...e })),
        queue: state.queue.map((e) => ({ ...e })),
      }))
    },
  }
}

/** runners 表：进表=占名额，出表=还名额（所有 runners.set/delete 自动过闸）。 */
export class DotGatedRunners<K extends string, V> extends Map<K, V> {
  declare private dotGate: DotWorkGate
  declare private dotOwnerOf: (id: K) => string | undefined
  constructor(gate: DotWorkGate, ownerOf: (id: K) => string | undefined) {
    super()
    this.dotGate = gate
    this.dotOwnerOf = ownerOf
  }

  override set(id: K, runner: V): this {
    if (this.dotGate !== undefined && !super.has(id)) this.dotGate.markRunning(id, this.dotOwnerOf(id))
    return super.set(id, runner)
  }

  override delete(id: K): boolean {
    const had = super.delete(id)
    if (had) this.dotGate.release(id)
    return had
  }

  override clear(): void {
    for (const id of [...super.keys()]) this.dotGate.release(id)
    super.clear()
  }
}

export function workerModel(): { provider: string, model: string } | undefined {
  const provider = String(process.env.DOT_WORKER_PROVIDER ?? '').trim()
  const model = String(process.env.DOT_WORKER_MODEL ?? '').trim()
  return provider === '' || model === '' ? undefined : { provider, model }
}

export const WORKER_UNCONFIGURED = '后台模型还没接：这件事需要后台 Worker 来做，但后台模型还没配置，暂时做不了。请如实告诉用户，不要自己代做。'
