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
/* ================================================================
   DOT 记忆 · Remote 门面（wire namespace = `dotMemory`）

   ▍这是什么
   把 MemoryService 暴露给 Client（WebView / Android / PC）。服务继承 `TypertRemoteService`，
   namespace 与 Cordis 服务键一起绑定。

   ▍为什么请求对象里没有 namespace / cross / 库路径
   身份、默认域、库路径都由插件配置给定；模型/前端能传就等于能读别人的私有记忆、
   能连生产库。这是硬边界（SPEC F09、约定 §7「普通工具不让模型任意选数据库路径或跨域」）。
   —— 前台窗口只收"查什么/记什么/改哪条/删哪条"，不能填"帮我打开哪个档案柜"。

   ▍修改铁律
   1. 【不】给任何请求类型加 namespace / cross / dbPath / actor 字段。
   2. 失败统一抛 RemoteError('memory/xxx')，由 Gateway 编码上 wire；不自定义外壳。
   3. 删除默认只预览（confirmed 缺省）；真删必须显式 confirmed:true。
   4. 状态如实报不可用（引擎缺失/库不可写），不假成功。
   ================================================================ */
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { MemoryEngineError } from "./engine.js";
/** 把引擎异常折成官方 Remote 失败。 */
function asRemoteFailure(error) {
    if (error instanceof MemoryEngineError) {
        throw new RemoteError(error.code, error.message, { reason: error.message });
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new RemoteError('memory/engine-failed', message, { reason: message });
}
/**
 * 记忆 Remote owner。
 */
let MemoryRemote = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _remoteExportSearch_decorators;
    let _remoteExportStore_decorators;
    let _remoteExportCorrect_decorators;
    let _remoteExportForget_decorators;
    let _remoteExportGet_decorators;
    let _remoteExportList_decorators;
    let _remoteExportStatus_decorators;
    let _remoteExportWatch_decorators;
    return class MemoryRemote extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _remoteExportSearch_decorators = [Remote('search')];
            _remoteExportStore_decorators = [Remote('store')];
            _remoteExportCorrect_decorators = [Remote('correct')];
            _remoteExportForget_decorators = [Remote('forget')];
            _remoteExportGet_decorators = [Remote('get')];
            _remoteExportList_decorators = [Remote('list')];
            _remoteExportStatus_decorators = [Remote('status')];
            _remoteExportWatch_decorators = [Remote({ name: 'watch', mode: 'stream' })];
            __esDecorate(this, null, _remoteExportSearch_decorators, { kind: "method", name: "remoteExportSearch", static: false, private: false, access: { has: obj => "remoteExportSearch" in obj, get: obj => obj.remoteExportSearch }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteExportStore_decorators, { kind: "method", name: "remoteExportStore", static: false, private: false, access: { has: obj => "remoteExportStore" in obj, get: obj => obj.remoteExportStore }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteExportCorrect_decorators, { kind: "method", name: "remoteExportCorrect", static: false, private: false, access: { has: obj => "remoteExportCorrect" in obj, get: obj => obj.remoteExportCorrect }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteExportForget_decorators, { kind: "method", name: "remoteExportForget", static: false, private: false, access: { has: obj => "remoteExportForget" in obj, get: obj => obj.remoteExportForget }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteExportGet_decorators, { kind: "method", name: "remoteExportGet", static: false, private: false, access: { has: obj => "remoteExportGet" in obj, get: obj => obj.remoteExportGet }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteExportList_decorators, { kind: "method", name: "remoteExportList", static: false, private: false, access: { has: obj => "remoteExportList" in obj, get: obj => obj.remoteExportList }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteExportStatus_decorators, { kind: "method", name: "remoteExportStatus", static: false, private: false, access: { has: obj => "remoteExportStatus" in obj, get: obj => obj.remoteExportStatus }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteExportWatch_decorators, { kind: "method", name: "remoteExportWatch", static: false, private: false, access: { has: obj => "remoteExportWatch" in obj, get: obj => obj.remoteExportWatch }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        service = __runInitializers(this, _instanceExtraInitializers);
        /**
         * ⚠️【勿动】Cordis 服务键必须是 `dotMemoryRemote`，**不能**与业务服务键 `dotMemory` 相同：
         *   同一个键注册两次会在装配时抛 `service "dotMemory" has been registered`。
         *   官方惯例同款：JobController 服务键 `jobController` / wire namespace `job`。
         */
        constructor(ctx, service) {
            super(ctx, 'dotMemoryRemote', { namespace: 'dotMemory' });
            this.service = service;
        }
        /** 语义检索。 */
        async remoteExportSearch(request) {
            try {
                const result = await this.service.search(request.query, {
                    ...(request.top === undefined ? {} : { top: request.top }),
                    ...(request.project === undefined ? {} : { project: request.project }),
                });
                return {
                    ok: true,
                    query: request.query,
                    count: result.hits.length,
                    hits: result.hits,
                    mode: result.mode,
                    ...(result.verdict === undefined ? {} : { verdict: result.verdict }),
                };
            }
            catch (error) {
                return asRemoteFailure(error);
            }
        }
        /** 保存。 */
        async remoteExportStore(request) {
            try {
                const result = await this.service.store({
                    text: request.text,
                    operationId: request.operationId,
                    ...(request.project === undefined ? {} : { project: request.project }),
                    ...(request.importance === undefined ? {} : { importance: request.importance }),
                    ...(request.tags === undefined ? {} : { tags: request.tags }),
                });
                return {
                    ok: result.action !== 'rejected',
                    ...(result.id === undefined ? {} : { id: result.id }),
                    action: result.action,
                    namespace: this.service.namespace,
                    ...(result.reason === undefined ? {} : { reason: result.reason }),
                };
            }
            catch (error) {
                return asRemoteFailure(error);
            }
        }
        /** 纠正（新条目 + 旧条目退役）。 */
        async remoteExportCorrect(request) {
            try {
                const result = await this.service.correct({
                    id: request.id,
                    text: request.text,
                    operationId: request.operationId,
                    ...(request.reason === undefined ? {} : { reason: request.reason }),
                });
                return { ok: true, id: result.id, supersededId: result.supersededId, action: result.action };
            }
            catch (error) {
                return asRemoteFailure(error);
            }
        }
        /** 删除（默认只预览）。 */
        async remoteExportForget(request) {
            try {
                const confirmed = request.confirmed === true;
                const result = await this.service.forget({ id: request.id, confirmed });
                return {
                    ok: true,
                    confirmed,
                    removed: result.removed,
                    ...(result.pending === undefined ? {} : { pending: result.pending }),
                    ...(result.preview === undefined ? {} : { preview: result.preview }),
                    ...(result.tombstoneRegistered === undefined ? {} : { tombstoneRegistered: result.tombstoneRegistered }),
                };
            }
            catch (error) {
                return asRemoteFailure(error);
            }
        }
        /** 单条读取。 */
        async remoteExportGet(request) {
            try {
                const hit = await this.service.get(request.id);
                return hit === undefined ? { ok: false } : { ok: true, hit };
            }
            catch (error) {
                return asRemoteFailure(error);
            }
        }
        /** 列表（无 query = 按重要度/时间列最近）。 */
        async remoteExportList(request) {
            try {
                const hits = await this.service.list({
                    ...(request.query === undefined ? {} : { query: request.query }),
                    ...(request.limit === undefined ? {} : { limit: request.limit }),
                    ...(request.project === undefined ? {} : { project: request.project }),
                });
                return { ok: true, count: hits.length, hits };
            }
            catch (error) {
                return asRemoteFailure(error);
            }
        }
        /** 能力状态（缺配置如实不可用）。 */
        async remoteExportStatus() {
            const status = await this.service.status();
            return {
                available: status.available,
                engine: 'xtmem',
                actor: status.actor,
                namespace: status.namespace,
                dbIsolated: true,
                ...(status.reason === undefined ? {} : { reason: status.reason }),
                ...(status.engineVersion === undefined ? {} : { engineVersion: status.engineVersion }),
            };
        }
        /** 变化流：界面订阅后重取快照。 */
        /* ⚠️ 显式给导出名 'watch'：不带 name 时 endpoint 会回落成 `remoteExportWatch`。 */
        remoteExportWatch(signal) {
            return watchStream(this.service, signal);
        }
    };
})();
export { MemoryRemote };
/**
 * 把服务订阅桥成 AsyncIterable（与 postbox 同款；创建者负责退订）。
 * @param service - 记忆服务
 * @param signal - carrier 取消信号
 * @returns 帧流
 */
async function* watchStream(service, signal) {
    /*
     * ⚠️【勿动顺序】先订阅、再发 ready、最后进循环。
     *   async generator 在两次 next() 之间挂起；若先 yield ready 再 subscribe，
     *   调用方拿到 ready 之后、再调 next() 之前的变化会被永久丢掉（实测卡死）。
     */
    const queue = [];
    let wake;
    const unsubscribe = service.subscribe((frame) => {
        queue.push(frame);
        wake?.();
        wake = undefined;
    });
    signal.addEventListener('abort', () => { wake?.(); wake = undefined; }, { once: true });
    try {
        // 第一帧：开流确认。官方流协议没有开流确认帧，客户端靠它确认订阅生效。
        yield { type: 'ready' };
        while (!signal.aborted) {
            const frame = queue.shift();
            if (frame !== undefined) {
                yield frame;
                continue;
            }
            await new Promise((resolve) => { wake = resolve; });
        }
    }
    finally {
        unsubscribe();
    }
}
