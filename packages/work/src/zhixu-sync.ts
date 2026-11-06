/**
 * 后台工作 → 知序待办同步（2026-10-31，离线通知第三轮）。
 *
 * 为什么放在这里：后台工作每次状态变化都会走 service.publish，这是唯一可靠的汇合点。
 * 星邮匣读的是知序：知序里一件待办"一个任务一条、原地更新"，所以只要把工作状态
 * 写进知序待办，完成 / 失败 / 要你处理就会自动进星邮匣，DOT 关着也不丢。
 *
 * 映射（知序只有 pending / in_progress / done / canceled 四种）：
 * - queued / running            → in_progress
 * - waiting-input / approval    → pending，说明里写"需要你处理：…"
 * - interrupted                 → pending，说明里写"被打断，要你决定是否重做"
 * - succeeded                   → done，说明里带结果摘要
 * - failed                      → canceled，说明里带"失败：原因"（知序没有"失败"，最接近的是取消）
 * - cancelled                   → canceled
 *
 * 关联：先按说明里的标记 `[DOT 后台工作 <id>]` 找（幂等，链接文件丢了也不会重复建）；
 * 再按标题找 ASTRA 刚建的未完成待办（规范化后相等或互相包含）；都找不到才按工作新建一条。
 *
 * 不在线也能跑：身份用记录的 owner，没有就读 DOT_CLOUD_ACCOUNT；钥匙读 DOT_ZHIXU_URL / DOT_ZHIXU_KEY。
 * 任何失败只记日志，绝不影响工作本身。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { WorkStatus } from '@xtcausal/dot-contracts'
import type { WorkRecord } from './types.ts'

/** 知序调用：工具名 + 参数 + 账号，返回 body.data；失败抛错。 */
export type ZhixuInvoke = (tool: string, args: Record<string, unknown>, actor: string) => Promise<any>

/** 一件工作对应的知序待办。 */
export interface ZhixuLink {
  readonly taskId: string
  readonly version: number
  /** 上次写进知序的内容指纹；没变就不写，避免星邮匣刷屏。 */
  readonly key: string
  /** 关联来源：astra = 接管 ASTRA 建的那条；created = 我们新建的。 */
  readonly source: 'astra' | 'created'
  /** 接管 ASTRA 那条时它原来的说明；我们的状态块接在它后面，不覆盖。 */
  readonly base?: string
}

export interface ZhixuSyncOptions {
  readonly invoke?: ZhixuInvoke
  readonly file?: string
  readonly timeZone?: string
  readonly logger?: { info(message: string): void, warn(message: string): void }
  /** 是否启用；默认：有 DOT_ZHIXU_URL 和 DOT_ZHIXU_KEY 才启用。 */
  readonly enabled?: boolean
}

const MARK = (id: string): string => `[DOT 后台工作 ${id}]`
const BLOCK_HEAD = '—— 后台工作 ——'

/** 知序待办状态 + 说明块。 */
export interface ZhixuTarget {
  readonly status: 'pending' | 'in_progress' | 'done' | 'canceled'
  readonly block: string
}

function clip(text: string | undefined, max: number): string {
  const value = (text ?? '').replace(/\s+\n/g, '\n').trim()
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

/**
 * 工作记录 → 知序目标状态；undefined 表示这个状态不用同步。
 * @param record - 工作记录
 */
export function zhixuTargetOf(record: WorkRecord): ZhixuTarget | undefined {
  const lines: string[] = []
  let status: ZhixuTarget['status']
  const s: WorkStatus = record.status
  switch (s) {
    case 'queued':
    case 'running':
      status = 'in_progress'
      lines.push('状态：后台正在做')
      break
    case 'waiting-input':
    case 'waiting-approval': {
      status = 'pending'
      const message = clip(record.blocked?.message, 300)
      lines.push(`状态：需要你处理${message === '' ? '' : `：${message}`}`)
      lines.push('打开 DOT 就能处理；链接过期了会自动换新。')
      break
    }
    case 'interrupted':
      status = 'pending'
      lines.push('状态：被打断（进程重启），要你决定是否重做')
      lines.push('打开 DOT，在这件工作上点"重试"即可。')
      break
    case 'succeeded': {
      status = 'done'
      lines.push('状态：已完成')
      const summary = clip(record.stage, 1500)
      if (summary !== '' && summary !== '已完成') lines.push(`结果：${summary}`)
      if (record.artifacts.length > 0) lines.push(`成果文件：${record.artifacts.length} 个（打开 DOT 查看）`)
      break
    }
    case 'failed': {
      status = 'canceled'
      const reason = clip(record.error ?? record.stage, 600)
      lines.push(`状态：失败${reason === '' ? '' : `：${reason}`}`)
      break
    }
    case 'cancelled':
      status = 'canceled'
      lines.push('状态：已取消')
      break
    default:
      return undefined
  }
  return { status, block: [BLOCK_HEAD, ...lines, MARK(record.id)].join('\n') }
}

/** 标题规范化：去空白和常见标点、转小写。 */
export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

/** 标题是否算同一件事：规范化后相等，或较短的一边（≥4 字）被较长的一边包含。 */
export function titlesMatch(a: string, b: string): boolean {
  const x = normalizeTitle(a)
  const y = normalizeTitle(b)
  if (x === '' || y === '') return false
  if (x === y) return true
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  return short.length >= 4 && long.includes(short)
}

/** 默认知序调用：跟 @xtcausal/dot-zhixu/lib/client.js 同一个协议，单独实现以免包互相依赖。 */
export const defaultZhixuInvoke: ZhixuInvoke = async (tool, args, actor) => {
  const base = process.env.DOT_ZHIXU_URL
  const key = process.env.DOT_ZHIXU_KEY
  if (!base || !key) throw new Error('知序未配置（DOT_ZHIXU_URL / DOT_ZHIXU_KEY 缺失）')
  const response = await fetch(`${base.replace(/\/+$/, '')}/invoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dot-zhixu-key': key, 'x-dot-actor': actor },
    body: JSON.stringify({ name: tool, arguments: args }),
    signal: AbortSignal.timeout(30_000),
  })
  const body = await response.json().catch(() => ({})) as any
  if (!response.ok || body?.ok !== true) {
    const code = body?.error?.code ?? `HTTP_${response.status}`
    const error = new Error(`知序 ${tool} 失败（${code}）：${body?.error?.message ?? '知序没有返回结果'}`) as Error & { code?: string }
    error.code = String(code)
    throw error
  }
  return body.data
}

/**
 * 工作 → 知序同步器。每件工作串行，状态指纹没变就不写。
 */
export class WorkZhixuSync {
  private readonly invoke: ZhixuInvoke
  private readonly file: string
  private readonly timeZone: string | undefined
  private readonly logger: NonNullable<ZhixuSyncOptions['logger']>
  readonly enabled: boolean
  private links: Map<string, ZhixuLink> | undefined
  private loading: Promise<Map<string, ZhixuLink>> | undefined
  private readonly chains = new Map<string, Promise<void>>()
  private saving: Promise<void> = Promise.resolve()

  constructor(options: ZhixuSyncOptions = {}) {
    this.invoke = options.invoke ?? defaultZhixuInvoke
    this.file = options.file ?? process.env.DOT_WORK_ZHIXU_LINKS ?? join(homedir(), '.dot-work-zhixu-links.json')
    this.timeZone = options.timeZone ?? process.env.DOT_ZHIXU_TIMEZONE
    this.logger = options.logger ?? { info: () => {}, warn: () => {} }
    this.enabled = options.enabled ?? (Boolean(process.env.DOT_ZHIXU_URL) && Boolean(process.env.DOT_ZHIXU_KEY))
  }

  /** 收到一次工作发布；排进这件工作自己的队列。 */
  notify(record: WorkRecord): void {
    if (!this.enabled) return
    const target = zhixuTargetOf(record)
    if (target === undefined) return
    const prev = this.chains.get(record.id) ?? Promise.resolve()
    const next = prev.then(() => this.sync(record, target)).catch((error) => {
      this.logger.warn(`dot-work: 知序同步失败（${record.id}）：${String(error)}`)
    })
    this.chains.set(record.id, next)
    void next.then(() => {
      if (this.chains.get(record.id) === next) this.chains.delete(record.id)
    })
  }

  /** 等所有排队的同步做完（测试和关停用）。 */
  async idle(): Promise<void> {
    while (this.chains.size > 0) await Promise.all([...this.chains.values()])
    await this.saving
  }

  /** 读当前链接（测试用）。 */
  async linkOf(workId: string): Promise<ZhixuLink | undefined> {
    return (await this.load()).get(workId)
  }

  private actorOf(record: WorkRecord): string {
    const actor = record.owner ?? process.env.DOT_CLOUD_ACCOUNT
    if (actor === undefined || actor === '') throw new Error('缺少账号身份，无法同步知序')
    return actor
  }

  private async load(): Promise<Map<string, ZhixuLink>> {
    if (this.links !== undefined) return this.links
    this.loading ??= (async () => {
      try {
        const raw = JSON.parse(await readFile(this.file, 'utf8')) as Record<string, ZhixuLink>
        this.links = new Map(Object.entries(raw))
      } catch {
        this.links = new Map()
      }
      return this.links
    })()
    return this.loading
  }

  private save(): Promise<void> {
    const links = this.links
    if (links === undefined) return this.saving
    this.saving = this.saving.then(async () => {
      const tmp = `${this.file}.${process.pid}.tmp`
      await mkdir(dirname(this.file), { recursive: true })
      await writeFile(tmp, JSON.stringify(Object.fromEntries(links), null, 1), { mode: 0o600 })
      await rename(tmp, this.file)
    }).catch((error) => {
      this.logger.warn(`dot-work: 写知序链接文件失败：${String(error)}`)
    })
    return this.saving
  }

  private describe(link: Pick<ZhixuLink, 'base'> | undefined, block: string): string {
    const base = link?.base?.trim() ?? ''
    return clip(base === '' ? block : `${base}\n\n${block}`, 9_000)
  }

  private async sync(record: WorkRecord, target: ZhixuTarget): Promise<void> {
    const links = await this.load()
    const actor = this.actorOf(record)
    const key = `${target.status}\n${target.block}`
    let link = links.get(record.id)
    if (link !== undefined && link.key === key) return
    // 重做出来的工作接着用原工作那条待办，不另起一条。
    if (link === undefined && record.retryOf !== undefined) {
      const inherited = links.get(record.retryOf)
      if (inherited !== undefined) link = { ...inherited, key: '' }
    }
    if (link === undefined) {
      link = await this.attach(record, target, actor, links)
      if (link.key === key) {
        links.set(record.id, link)
        await this.save()
        return
      }
    }
    const updated = await this.update(record, link, target, actor)
    links.set(record.id, { ...link, version: updated.version, key })
    await this.save()
  }

  /** 找到或新建这件工作对应的知序待办。 */
  private async attach(record: WorkRecord, target: ZhixuTarget, actor: string, links: Map<string, ZhixuLink>): Promise<ZhixuLink> {
    const listed = await this.invoke('zhixu_list_tasks', { statuses: ['pending', 'in_progress'], limit: 100 }, actor)
      .catch(() => ({ items: [] }))
    const items: any[] = Array.isArray(listed?.items) ? listed.items : []
    const marked = items.find(item => String(item?.data?.description ?? '').includes(MARK(record.id)))
    if (marked !== undefined) {
      const base = String(marked.data.description).split(BLOCK_HEAD)[0]?.trim() ?? ''
      return { taskId: String(marked.id), version: Number(marked.version), key: '', source: 'astra', base }
    }
    const taken = new Set([...links.values()].map(item => item.taskId))
    const candidates = items
      .filter(item => !taken.has(String(item?.id)))
      .filter(item => !String(item?.data?.description ?? '').includes('[DOT 后台工作 '))
      .filter(item => typeof item?.data?.title === 'string' && titlesMatch(item.data.title, record.title))
      .sort((a, b) => String(b?.data?.createdAt ?? '').localeCompare(String(a?.data?.createdAt ?? '')))
    const astra = candidates[0]
    if (astra !== undefined) {
      this.logger.info(`dot-work: 工作 ${record.id} 关联到 ASTRA 建的知序待办 ${String(astra.id)}`)
      return { taskId: String(astra.id), version: Number(astra.version), key: '', source: 'astra', base: String(astra.data.description ?? '') }
    }
    const created = await this.invoke('zhixu_create_task', {
      title: clip(record.title, 200) || '后台工作',
      ...(this.timeZone === undefined ? {} : { timeZone: this.timeZone }),
      description: this.describe(undefined, target.block),
      operationId: `dot-work.${record.id}.create`.slice(0, 100),
    }, actor)
    const link: ZhixuLink = { taskId: String(created.id), version: Number(created.version), key: '', source: 'created' }
    // 新建的待办默认是 pending；目标正好是 pending 且说明一致时就不用再改一次。
    if (target.status === 'pending') return { ...link, key: `${target.status}\n${target.block}` }
    return link
  }

  private async update(record: WorkRecord, link: ZhixuLink, target: ZhixuTarget, actor: string): Promise<{ version: number }> {
    const send = (version: number): Promise<any> => this.invoke('zhixu_update_task', {
      id: link.taskId,
      expectedVersion: version,
      status: target.status,
      description: this.describe(link, target.block),
      operationId: `dot-work.${record.id}.r${record.revision}.v${version}`.slice(0, 100),
    }, actor)
    try {
      const result = await send(link.version)
      return { version: Number(result?.version ?? link.version + 1) }
    } catch (error) {
      // 版本冲突（用户或 ASTRA 刚改过这条）：读最新版本再试一次。
      if (!/CONFLICT|VERSION/i.test(String((error as any)?.code ?? error))) throw error
      const fresh = await this.invoke('zhixu_get_record', { kind: 'task', id: link.taskId }, actor)
      const result = await send(Number(fresh?.version))
      return { version: Number(result?.version ?? Number(fresh?.version) + 1) }
    }
  }
}
