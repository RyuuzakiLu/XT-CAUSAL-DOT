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
   星邮匣 · Remote 门面（wire namespace = `dotPostbox`）

   ▍这是什么
   把 PostboxService 的能力按官方 Typert Remote 规则暴露给 Client（WebView / Android）。
   服务继承 `TypertRemoteService`，wire 命名空间与 Cordis 服务键一起在构造函数里绑定。

   ▍为什么每个方法要包一层 `remoteExport*`
   官方生成器要求 Remote 方法参数"具名且必填、不能可选/解构/默认值"；所以对外统一
   收一个请求对象（`{...}` 里都是必填字段，可选语义放在对象内部字段上由 zod 描述），
   再转给业务方法。业务方法保持内部形态不变。
   —— 像柜台：窗口只收填好的表单，后厨怎么切菜不归窗口管。

   ▍修改铁律
   1. 【不】在这些方法里加业务规则；所有判定都在 service/rules 里，本层只做参数搬运。
   2. 失败一律抛 `RemoteError('postbox/xxx')`，不用自定义 {status,data,error} 外壳。
   3. 【不】新增"任意路径/任意库"这类参数；事件域由本包固定声明。
   4. Android 只消费 `pending` 与 `deliveryReceipt`；不要把 pending 的规则再暴露成可配参数，
      否则服务端与壳子会出现两套判定。
   ================================================================ */
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { PostboxError } from "./service.js";
/** 把域异常折成官方 Remote 失败。 */
function asRemoteFailure(error) {
    if (error instanceof PostboxError) {
        switch (error.code) {
            case 'postbox/not-found':
                // details.eventId 必须指向真实出错对象（PostboxError 自带 subjectId），
                // 不能填空串——界面按它定位，空串等于把用户带到"没有那封信"。
                throw new RemoteError('postbox/not-found', error.message, { eventId: error.subjectId ?? '' });
            case 'postbox/conflict':
                throw new RemoteError('postbox/conflict', error.message, { reason: error.message });
            case 'postbox/unavailable':
                throw new RemoteError('postbox/unavailable', error.message, { reason: error.message });
            case 'postbox/invalid-request':
                throw new RemoteError('postbox/invalid-request', error.message, { reason: error.message });
            default:
                throw error;
        }
    }
    throw error;
}
/**
 * 星邮匣 Remote owner。
 */
let PostboxRemote = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _remoteExportList_decorators;
    let _remoteExportPending_decorators;
    let _remoteExportGet_decorators;
    let _remoteExportRead_decorators;
    let _remoteExportArchive_decorators;
    let _remoteExportPreferences_decorators;
    let _remoteExportSetPreferences_decorators;
    let _remoteExportDeliveryReceipt_decorators;
    let _remoteExportRetry_decorators;
    let _remoteExportStatus_decorators;
    let _remoteExportWatch_decorators;
    return class PostboxRemote extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _remoteExportList_decorators = [Remote('list')];
            _remoteExportPending_decorators = [Remote('pending')];
            _remoteExportGet_decorators = [Remote('get')];
            _remoteExportRead_decorators = [Remote('read')];
            _remoteExportArchive_decorators = [Remote('archive')];
            _remoteExportPreferences_decorators = [Remote('preferences')];
            _remoteExportSetPreferences_decorators = [Remote('setPreferences')];
            _remoteExportDeliveryReceipt_decorators = [Remote('deliveryReceipt')];
            _remoteExportRetry_decorators = [Remote('retryDelivery')];
            _remoteExportStatus_decorators = [Remote('status')];
            _remoteExportWatch_decorators = [Remote({ name: 'watch', mode: 'stream' })];
            __esDecorate(this, null, _remoteExportList_decorators, { kind: "method", name: "remoteExportList", static: false, private: false, access: { has: obj => "remoteExportList" in obj, get: obj => obj.remoteExportList }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteExportPending_decorators, { kind: "method", name: "remoteExportPending", static: false, private: false, access: { has: obj => "remoteExportPending" in obj, get: obj => obj.remoteExportPending }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteExportGet_decorators, { kind: "method", name: "remoteExportGet", static: false, private: false, access: { has: obj => "remoteExportGet" in obj, get: obj => obj.remoteExportGet }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteExportRead_decorators, { kind: "method", name: "remoteExportRead", static: false, private: false, access: { has: obj => "remoteExportRead" in obj, get: obj => obj.remoteExportRead }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteExportArchive_decorators, { kind: "method", name: "remoteExportArchive", static: false, private: false, access: { has: obj => "remoteExportArchive" in obj, get: obj => obj.remoteExportArchive }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteExportPreferences_decorators, { kind: "method", name: "remoteExportPreferences", static: false, private: false, access: { has: obj => "remoteExportPreferences" in obj, get: obj => obj.remoteExportPreferences }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteExportSetPreferences_decorators, { kind: "method", name: "remoteExportSetPreferences", static: false, private: false, access: { has: obj => "remoteExportSetPreferences" in obj, get: obj => obj.remoteExportSetPreferences }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteExportDeliveryReceipt_decorators, { kind: "method", name: "remoteExportDeliveryReceipt", static: false, private: false, access: { has: obj => "remoteExportDeliveryReceipt" in obj, get: obj => obj.remoteExportDeliveryReceipt }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteExportRetry_decorators, { kind: "method", name: "remoteExportRetry", static: false, private: false, access: { has: obj => "remoteExportRetry" in obj, get: obj => obj.remoteExportRetry }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteExportStatus_decorators, { kind: "method", name: "remoteExportStatus", static: false, private: false, access: { has: obj => "remoteExportStatus" in obj, get: obj => obj.remoteExportStatus }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remoteExportWatch_decorators, { kind: "method", name: "remoteExportWatch", static: false, private: false, access: { has: obj => "remoteExportWatch" in obj, get: obj => obj.remoteExportWatch }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        postbox = __runInitializers(this, _instanceExtraInitializers);
        /** 只依赖自己的业务服务；不加额外服务依赖。 */
        static inject = [];
        /**
         * ⚠️【勿动】Cordis 服务键必须是 `dotPostboxRemote`，**不能**与业务服务键 `dotPostbox` 相同。
         *   同一个键会在 Cordis 里注册两次（一次是本 Remote，一次是 apply 里的 PostboxService），
         *   装配时直接抛 `service "dotPostbox" has been registered`。
         *   官方惯例同款：JobController 的服务键是 `jobController`，wire namespace 才是 `job`。
         */
        constructor(ctx, postbox) {
            super(ctx, 'dotPostboxRemote', { namespace: 'dotPostbox' });
            this.postbox = postbox;
        }
        /** 列表（每条带 deliveries 投影）。 */
        remoteExportList(request) {
            try {
                return this.postbox.list({
                    ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
                    ...(request.limit === undefined ? {} : { limit: request.limit }),
                    ...(request.unreadOnly === undefined ? {} : { unreadOnly: request.unreadOnly }),
                    ...(request.kinds === undefined ? {} : { kinds: request.kinds }),
                    ...(request.includeArchived === undefined ? {} : { includeArchived: request.includeArchived }),
                });
            }
            catch (error) {
                return asRemoteFailure(error);
            }
        }
        /** 增量（Android 前台服务轮询用；规则已在服务端执行）。 */
        remoteExportPending(request) {
            try {
                return this.postbox.pending(request.since, request.limit ?? 50);
            }
            catch (error) {
                return asRemoteFailure(error);
            }
        }
        /** 单条读取。 */
        remoteExportGet(request) {
            try {
                return this.postbox.get(request.id);
            }
            catch (error) {
                return asRemoteFailure(error);
            }
        }
        /** 标记已读。 */
        async remoteExportRead(request) {
            try {
                const event = await this.postbox.read(request.id, request.operationId);
                return this.postbox.get(event.id);
            }
            catch (error) {
                return asRemoteFailure(error);
            }
        }
        /** 归档。 */
        async remoteExportArchive(request) {
            try {
                const event = await this.postbox.archive(request.id, request.operationId);
                return this.postbox.get(event.id);
            }
            catch (error) {
                return asRemoteFailure(error);
            }
        }
        /** 读偏好。 */
        remoteExportPreferences() {
            return this.postbox.preferences();
        }
        /** 写偏好（rev 乐观锁可选）。 */
        async remoteExportSetPreferences(request) {
            try {
                return await this.postbox.setPreferences(request.preferences, request.operationId, request.rev);
            }
            catch (error) {
                return asRemoteFailure(error);
            }
        }
        /** 回执（native 弹完/飞书确认后回写；同 operationId 幂等）。 */
        async remoteExportDeliveryReceipt(request) {
            try {
                return await this.postbox.deliveryReceipt(request.id, request.channel, request.status, request.operationId, request.detail);
            }
            catch (error) {
                return asRemoteFailure(error);
            }
        }
        /** 重试投递（飞书真发；native 只标记已交给前端队列）。 */
        async remoteExportRetry(request) {
            try {
                return await this.postbox.retryDelivery(request.id, request.channel, request.operationId);
            }
            catch (error) {
                return asRemoteFailure(error);
            }
        }
        /** 渠道与整体状态。 */
        remoteExportStatus() {
            return this.postbox.status();
        }
        /** 变化流：Client 订阅后按 seq 主动拉快照/增量。 */
        /* ⚠️ 显式给导出名 'watch'：`@Remote({mode:'stream'})` 不带 name 时，endpoint 名会回落成
           方法名 `remoteExportWatch`，Client 侧 `ctx.remote.dotPostbox.watch` 就找不到它。 */
        remoteExportWatch(signal) {
            return watchStream(this.postbox, signal);
        }
    };
})();
export { PostboxRemote };
/**
 * 把服务订阅桥成 AsyncIterable。
 *
 * 为什么不用轮询：官方 Remote 流自带取消与背压；轮询会在这条链上再造一个定时器。
 * 断开时通过 signal 收尾，不留下悬挂的监听（生命周期交给 carrier）。
 *
 * ★先发一帧 `ready`★（2026-10-23 实测教训）：官方流协议没有"开流确认"帧，
 *   item 就是唯一信号。若订阅后暂无变化，客户端**收不到任何字节**，只能靠超时判断，
 *   看起来像"流没开起来"。所以开流立刻推一帧 ready（带当前水位），
 *   客户端据此确认订阅生效、并按 seq 拉首次快照。
 * @param postbox - 业务服务
 * @param signal - carrier 取消信号
 * @returns 帧流
 */
async function* watchStream(postbox, signal) {
    /*
     * ⚠️【勿动顺序】先订阅、再发 ready、最后进循环。
     *   若把 subscribe 放在 `yield ready` 之后，async generator 在两次 next() 之间是
     *   挂起的——调用方拿到 ready 后、再调 next() 之前发生的业务变化**会被永久丢掉**
     *   （实测：本地帧序测试卡死 120s，因为 publish 落在订阅建立之前）。
     *   订阅先行才能保证"ready 之后的所有变化都进队列"。
     */
    const queue = [];
    let wake;
    const unsubscribe = postbox.subscribe((frame) => {
        queue.push(frame);
        wake?.();
        wake = undefined;
    });
    signal.addEventListener('abort', () => { wake?.(); wake = undefined; }, { once: true });
    try {
        // 第一帧：开流确认 + 当前水位（客户端据此拉首次快照）。
        yield { type: 'ready', seq: postbox.status().seq, eventIds: [] };
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
        // 创建者负责关闭：流结束（含取消）时立刻退订，防止监听器堆积。
        unsubscribe();
    }
}
