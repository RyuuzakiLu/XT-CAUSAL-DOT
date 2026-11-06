/* ================================================================
   能力目录 · 总导游图

   ▍这是什么
   把 `ctx.tools` 里真实注册的工具投影成一份可订阅快照，供界面（能力空间）和
   模型工具（dot_capabilities）共用。同时它自己就是一个 `TypertRemoteService`：
   浏览器用生成的 `ctx.remote.dotCapabilities.list()` 取同一份事实。

   ▍为什么不缓存一份静态列表
   插件会被启用/停用（能力空间就是干这个的）。静态列表在停用之后会说谎，
   而说谎的能力页比没有能力页更糟——用户按它去点，点不动。

   ▍为什么 Remote 与目录是同一个类
   界面读的是"注册表现在长什么样"，不是另一套业务状态。分成两个服务只会多一份
   需要同步的真相；合成一个，list() 现场读注册表，天然不会旧。

   ▍结构
   CapabilityRow：一项能力（名称、说明、必填参数）
   CapabilitySnapshot：一次读取的完整目录 + revision
   CapabilityDirectory：读注册表 + 去重通知 + 释放
   DotCapabilitiesController：上面那个类的 Remote 出口（namespace `dotCapabilities`）

   ▍修改铁律
   1. 【不】把工具结果、模型输出塞进快照；这里只说"有哪些能力"。
   2. 【不】对同一个事实维护两份来源；一切现场读注册表。
   3. 读失败必须抛真实错误，不能返回空列表冒充"没有能力"。
   4. 【不】在这里造第二套启停开关；启停复用官方 pluginManager。

   ▍更新记录
   2026-10-23 · 建立；同日补 Remote 出口（生成 ./remote）。
   ================================================================ */
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

/** 一项能力的模型可见摘要。 */
export interface CapabilityRow {
  readonly name: string
  readonly description: string
  /** 必填参数名清单；空数组表示无参数。 */
  readonly requiredFields: readonly string[]
}

/** 一次目录读取的结果。 */
export interface CapabilitySnapshot {
  readonly tools: readonly CapabilityRow[]
  /** 快照序号：每次发布自增，消费端据此判断新旧。 */
  readonly revision: number
  /**
   * 这份目录的视角。
   *
   * `global` 是**进程级已安装**的工具集合；`agent` 是**某个会话里模型真正能调**
   * 的集合。两者不等：agent 视图 = 全局层 + 该 agent 的 preset 层（再加自己注册的），
   * 所以全局集合通常**是** agent 集合的子集。界面说"已安装能力"时用 global；
   * 回答"你现在能做什么"必须用 agent，否则会承诺模型其实调不到的工具。
   */
  readonly scope: 'global' | 'agent'
}

/**
 * 从一条模型可见工具 schema 提取目录行。
 * 为什么单独成函数：注册表给的 schema 字段很多，目录只关心三样；
 * 分散在调用处取值会让以后加字段时两处不同步。
 * @param schema - 注册表投影的工具 schema
 * @returns 目录行
 */
function toRow(schema: { readonly name: string; readonly description: string; readonly parameters: Record<string, unknown> }): CapabilityRow {
  const raw = schema.parameters['required']
  const required = Array.isArray(raw) ? raw.filter((field): field is string => typeof field === 'string') : []
  return { name: schema.name, description: schema.description, requiredFields: required }
}

/** 真实工具注册表的只读投影 + 订阅。 */
export class CapabilityDirectory {
  private revision = 0
  private snapshot: CapabilitySnapshot = { tools: [], revision: 0, scope: 'global' }
  private readonly listeners = new Set<() => void>()
  private readonly offs: Array<() => void> = []
  private disposed = false

  /**
   * @param ctx - 承载 `tools/change` 事件的上下文（事件由 Service 发出，订阅在 ctx 上）
   * @param tools - 工具注册表（唯一的真相来源）
   */
  constructor(ctx: Context, private readonly tools: ToolRuntime) {
    // 注册与注销都会改变可见集合；用注册表自己的事件重算，不靠轮询。
    this.offs.push(ctx.on('tools/change', () => { this.refresh() }))
    this.refresh()
  }

  /** 当前快照；内容不变时返回同一引用，方便 useSyncExternalStore 直接比较。 */
  // ⚠️ 显式标注成员类型：Typert 只接受"公开成员都有明确类型注解"的类，
  // 靠箭头函数推断类型的成员会被判为 missing explicit type annotation 而拒绝生成 Remote。
  readonly getSnapshot: () => CapabilitySnapshot = () => this.snapshot

  /** 订阅快照变化；返回取消函数。 */
  readonly subscribe: (listener: () => void) => () => void = (listener) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * 重新读注册表并发布。
   * 为什么按工具名排序：注册顺序受加载顺序影响，排序后同一组能力得到同一份快照，
   * 界面不会因为无关插件重排而闪。
   */
  refresh(): void {
    if (this.disposed) return
    const rows = this.tools.schemas().map(toRow).sort((left, right) => left.name.localeCompare(right.name))
    this.snapshot = { tools: rows, revision: ++this.revision, scope: 'global' }
    for (const listener of this.listeners) listener()
  }

  /**
   * 读**某一个会话（agent 作用域）**真正可见的工具。
   *
   * ▍为什么不能只给全局视图
   * ASTRA 的工具大多挂在 agent preset 层，不在全局层。只读全局会同时犯两个错：
   * ① 漏掉模型其实能用的（web/fs/present 等 preset 工具）；
   * ② 把别的会话才有的当成本会话可用。
   * 官方 PTC 运行时也是用 `registry.schemas(exec.agent)` 取调用者视图，这里沿用同一口径。
   * @param scope - agent 作用域（`exec.agent`）；省略则退回全局视图
   * @returns 该作用域的目录快照（不发布、不改 revision——它不是全局事实）
   */
  snapshotFor(scope?: object): CapabilitySnapshot {
    const rows = this.tools.schemas(scope).map(toRow).sort((left, right) => left.name.localeCompare(right.name))
    return { tools: rows, revision: this.revision, scope: scope === undefined ? 'global' : 'agent' }
  }

  /** 释放事件监听；资源由创建者关闭。 */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const off of this.offs.splice(0)) off()
    this.listeners.clear()
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** DOT 能力目录：真实工具注册表的只读投影。 */
    dotCapabilities: DotCapabilitiesController
  }
}

/**
 * 能力目录的 Remote 出口。
 * 界面通过 `ctx.remote.dotCapabilities.list()` 读到与模型工具同一份快照；
 * 这里不缓存、不合并，现场问目录。
 */
export class DotCapabilitiesController extends TypertRemoteService {
  static inject = ['tools', 'typert']

  /** 目录实例由插件 apply 创建后注入，保证两边读同一个注册表订阅。 */
  private directory: CapabilityDirectory | undefined

  constructor(ctx: Context) {
    super(ctx, 'dotCapabilities', { namespace: 'dotCapabilities' })
  }

  /**
   * 绑定目录实例（apply 在创建后立刻调用）。
   * 为什么不用构造参数：Loader 按行实例化行配置里的插件，构造参数只能来自 Config；
   * 而目录依赖的是 apply 里拿到的同一注册表，绑定时序由本包自己掌握。
   * @param directory - 目录服务
   */
  bind(directory: CapabilityDirectory): void {
    this.directory = directory
  }

  /**
   * 进程内读取当前能力目录（给同进程消费者与测试用，不走 wire）。
   * @returns 同一份快照
   */
  getSnapshot(): CapabilitySnapshot {
    const directory = this.directory
    if (directory === undefined) throw new Error('能力目录尚未绑定')
    directory.refresh()
    return directory.getSnapshot()
  }

  /**
   * 读某一会话作用域可见的工具（进程内调用与测试用）。
   * @param scope - agent 作用域；省略退回全局视图
   * @returns 该作用域的目录快照
   */
  snapshotFor(scope?: object): CapabilitySnapshot {
    const directory = this.directory
    if (directory === undefined) throw new Error('能力目录尚未绑定')
    return directory.snapshotFor(scope)
  }

  /**
   * 读取当前能力目录。
   * @returns 与模型工具同一份快照
   */
  @Remote('list')
  async list(): Promise<CapabilitySnapshot> {
    const directory = this.directory
    if (directory === undefined) throw new Error('能力目录尚未绑定')
    // 每次读取都重算：注册表可能在两次调用之间变了，缓存只会给出旧答案。
    directory.refresh()
    return directory.getSnapshot()
  }
}
