var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
/**
 * 从一条模型可见工具 schema 提取目录行。
 * 为什么单独成函数：注册表给的 schema 字段很多，目录只关心三样；
 * 分散在调用处取值会让以后加字段时两处不同步。
 * @param schema - 注册表投影的工具 schema
 * @returns 目录行
 */
function toRow(schema) {
    const raw = schema.parameters['required'];
    const required = Array.isArray(raw) ? raw.filter((field) => typeof field === 'string') : [];
    return { name: schema.name, description: schema.description, requiredFields: required };
}
/** 真实工具注册表的只读投影 + 订阅。 */
export class CapabilityDirectory {
    tools;
    revision = 0;
    snapshot = { tools: [], revision: 0, scope: 'global' };
    listeners = new Set();
    offs = [];
    disposed = false;
    /**
     * @param ctx - 承载 `tools/change` 事件的上下文（事件由 Service 发出，订阅在 ctx 上）
     * @param tools - 工具注册表（唯一的真相来源）
     */
    constructor(ctx, tools) {
        this.tools = tools;
        // 注册与注销都会改变可见集合；用注册表自己的事件重算，不靠轮询。
        this.offs.push(ctx.on('tools/change', () => { this.refresh(); }));
        this.refresh();
    }
    /** 当前快照；内容不变时返回同一引用，方便 useSyncExternalStore 直接比较。 */
    // ⚠️ 显式标注成员类型：Typert 只接受"公开成员都有明确类型注解"的类，
    // 靠箭头函数推断类型的成员会被判为 missing explicit type annotation 而拒绝生成 Remote。
    getSnapshot = () => this.snapshot;
    /** 订阅快照变化；返回取消函数。 */
    subscribe = (listener) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };
    /**
     * 重新读注册表并发布。
     * 为什么按工具名排序：注册顺序受加载顺序影响，排序后同一组能力得到同一份快照，
     * 界面不会因为无关插件重排而闪。
     */
    refresh() {
        if (this.disposed)
            return;
        const rows = this.tools.schemas().map(toRow).sort((left, right) => left.name.localeCompare(right.name));
        this.snapshot = { tools: rows, revision: ++this.revision, scope: 'global' };
        for (const listener of this.listeners)
            listener();
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
    snapshotFor(scope) {
        const rows = this.tools.schemas(scope).map(toRow).sort((left, right) => left.name.localeCompare(right.name));
        return { tools: rows, revision: this.revision, scope: scope === undefined ? 'global' : 'agent' };
    }
    /** 释放事件监听；资源由创建者关闭。 */
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        for (const off of this.offs.splice(0))
            off();
        this.listeners.clear();
    }
}
/**
 * 能力目录的 Remote 出口。
 * 界面通过 `ctx.remote.dotCapabilities.list()` 读到与模型工具同一份快照；
 * 这里不缓存、不合并，现场问目录。
 */
let DotCapabilitiesController = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _list_decorators;
    return class DotCapabilitiesController extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _list_decorators = [Remote('list')];
            __esDecorate(this, null, _list_decorators, { kind: "method", name: "list", static: false, private: false, access: { has: obj => "list" in obj, get: obj => obj.list }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        static inject = ['tools', 'typert'];
        /** 目录实例由插件 apply 创建后注入，保证两边读同一个注册表订阅。 */
        directory = __runInitializers(this, _instanceExtraInitializers);
        constructor(ctx) {
            super(ctx, 'dotCapabilities', { namespace: 'dotCapabilities' });
        }
        /**
         * 绑定目录实例（apply 在创建后立刻调用）。
         * 为什么不用构造参数：Loader 按行实例化行配置里的插件，构造参数只能来自 Config；
         * 而目录依赖的是 apply 里拿到的同一注册表，绑定时序由本包自己掌握。
         * @param directory - 目录服务
         */
        bind(directory) {
            this.directory = directory;
        }
        /**
         * 进程内读取当前能力目录（给同进程消费者与测试用，不走 wire）。
         * @returns 同一份快照
         */
        getSnapshot() {
            const directory = this.directory;
            if (directory === undefined)
                throw new Error('能力目录尚未绑定');
            directory.refresh();
            return directory.getSnapshot();
        }
        /**
         * 读某一会话作用域可见的工具（进程内调用与测试用）。
         * @param scope - agent 作用域；省略退回全局视图
         * @returns 该作用域的目录快照
         */
        snapshotFor(scope) {
            const directory = this.directory;
            if (directory === undefined)
                throw new Error('能力目录尚未绑定');
            return directory.snapshotFor(scope);
        }
        /**
         * 读取当前能力目录。
         * @returns 与模型工具同一份快照
         */
        async list() {
            const directory = this.directory;
            if (directory === undefined)
                throw new Error('能力目录尚未绑定');
            // 每次读取都重算：注册表可能在两次调用之间变了，缓存只会给出旧答案。
            directory.refresh();
            return directory.getSnapshot();
        }
    };
})();
export { DotCapabilitiesController };
