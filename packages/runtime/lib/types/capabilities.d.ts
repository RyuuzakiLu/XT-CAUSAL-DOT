import type { Context } from '@deepseek-ai/cordis';
import type { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
/** 一项能力的模型可见摘要。 */
export interface CapabilityRow {
    readonly name: string;
    readonly description: string;
    /** 必填参数名清单；空数组表示无参数。 */
    readonly requiredFields: readonly string[];
}
/** 一次目录读取的结果。 */
export interface CapabilitySnapshot {
    readonly tools: readonly CapabilityRow[];
    /** 快照序号：每次发布自增，消费端据此判断新旧。 */
    readonly revision: number;
    /**
     * 这份目录的视角。
     *
     * `global` 是**进程级已安装**的工具集合；`agent` 是**某个会话里模型真正能调**
     * 的集合。两者不等：agent 视图 = 全局层 + 该 agent 的 preset 层（再加自己注册的），
     * 所以全局集合通常**是** agent 集合的子集。界面说"已安装能力"时用 global；
     * 回答"你现在能做什么"必须用 agent，否则会承诺模型其实调不到的工具。
     */
    readonly scope: 'global' | 'agent';
}
/** 真实工具注册表的只读投影 + 订阅。 */
export declare class CapabilityDirectory {
    private readonly tools;
    private revision;
    private snapshot;
    private readonly listeners;
    private readonly offs;
    private disposed;
    /**
     * @param ctx - 承载 `tools/change` 事件的上下文（事件由 Service 发出，订阅在 ctx 上）
     * @param tools - 工具注册表（唯一的真相来源）
     */
    constructor(ctx: Context, tools: ToolRuntime);
    /** 当前快照；内容不变时返回同一引用，方便 useSyncExternalStore 直接比较。 */
    readonly getSnapshot: () => CapabilitySnapshot;
    /** 订阅快照变化；返回取消函数。 */
    readonly subscribe: (listener: () => void) => () => void;
    /**
     * 重新读注册表并发布。
     * 为什么按工具名排序：注册顺序受加载顺序影响，排序后同一组能力得到同一份快照，
     * 界面不会因为无关插件重排而闪。
     */
    refresh(): void;
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
    snapshotFor(scope?: object): CapabilitySnapshot;
    /** 释放事件监听；资源由创建者关闭。 */
    dispose(): void;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** DOT 能力目录：真实工具注册表的只读投影。 */
        dotCapabilities: DotCapabilitiesController;
    }
}
/**
 * 能力目录的 Remote 出口。
 * 界面通过 `ctx.remote.dotCapabilities.list()` 读到与模型工具同一份快照；
 * 这里不缓存、不合并，现场问目录。
 */
export declare class DotCapabilitiesController extends TypertRemoteService {
    static inject: string[];
    /** 目录实例由插件 apply 创建后注入，保证两边读同一个注册表订阅。 */
    private directory;
    constructor(ctx: Context);
    /**
     * 绑定目录实例（apply 在创建后立刻调用）。
     * 为什么不用构造参数：Loader 按行实例化行配置里的插件，构造参数只能来自 Config；
     * 而目录依赖的是 apply 里拿到的同一注册表，绑定时序由本包自己掌握。
     * @param directory - 目录服务
     */
    bind(directory: CapabilityDirectory): void;
    /**
     * 进程内读取当前能力目录（给同进程消费者与测试用，不走 wire）。
     * @returns 同一份快照
     */
    getSnapshot(): CapabilitySnapshot;
    /**
     * 读某一会话作用域可见的工具（进程内调用与测试用）。
     * @param scope - agent 作用域；省略退回全局视图
     * @returns 该作用域的目录快照
     */
    snapshotFor(scope?: object): CapabilitySnapshot;
    /**
     * 读取当前能力目录。
     * @returns 与模型工具同一份快照
     */
    list(): Promise<CapabilitySnapshot>;
}
