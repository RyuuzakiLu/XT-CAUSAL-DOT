import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { Context } from '@deepseek-ai/cordis';
import { type PostboxService } from './service.ts';
import type { DeliveryRecord, DotPostboxGetRequest, DotPostboxIdCommandRequest, DotPostboxListRequest, DotPostboxListValue, DotPostboxPendingRequest, DotPostboxPendingValue, DotPostboxPreferencesValue, DotPostboxReceiptRequest, DotPostboxRetryRequest, DotPostboxSetPreferencesRequest, DotPostboxStatusValue, DotPostboxWatchFrame, PostboxEventView } from './types.ts';
declare module '@deepseek-ai/dsh-typert-protocol' {
    interface RemoteErrorDetailsMap {
        /** 事件不存在。 */
        'postbox/not-found': {
            readonly eventId: string;
        };
        /** 同一 operationId 被用于另一个动作，或乐观锁版本不符。 */
        'postbox/conflict': {
            readonly reason: string;
        };
        /** 渠道不可用（微信固定不可用；飞书未配置）。 */
        'postbox/unavailable': {
            readonly reason: string;
        };
        /** 请求本身不合法（空 operationId、非法游标等）。 */
        'postbox/invalid-request': {
            readonly reason: string;
        };
    }
}
/**
 * 星邮匣 Remote owner。
 */
export declare class PostboxRemote extends TypertRemoteService {
    private readonly postbox;
    /** 只依赖自己的业务服务；不加额外服务依赖。 */
    static inject: readonly [];
    /**
     * ⚠️【勿动】Cordis 服务键必须是 `dotPostboxRemote`，**不能**与业务服务键 `dotPostbox` 相同。
     *   同一个键会在 Cordis 里注册两次（一次是本 Remote，一次是 apply 里的 PostboxService），
     *   装配时直接抛 `service "dotPostbox" has been registered`。
     *   官方惯例同款：JobController 的服务键是 `jobController`，wire namespace 才是 `job`。
     */
    constructor(ctx: Context, postbox: PostboxService);
    /** 列表（每条带 deliveries 投影）。 */
    remoteExportList(request: DotPostboxListRequest): DotPostboxListValue;
    /** 增量（Android 前台服务轮询用；规则已在服务端执行）。 */
    remoteExportPending(request: DotPostboxPendingRequest): DotPostboxPendingValue;
    /** 单条读取。 */
    remoteExportGet(request: DotPostboxGetRequest): PostboxEventView;
    /** 标记已读。 */
    remoteExportRead(request: DotPostboxIdCommandRequest): Promise<PostboxEventView>;
    /** 归档。 */
    remoteExportArchive(request: DotPostboxIdCommandRequest): Promise<PostboxEventView>;
    /** 读偏好。 */
    remoteExportPreferences(): DotPostboxPreferencesValue;
    /** 写偏好（rev 乐观锁可选）。 */
    remoteExportSetPreferences(request: DotPostboxSetPreferencesRequest): Promise<DotPostboxPreferencesValue>;
    /** 回执（native 弹完/飞书确认后回写；同 operationId 幂等）。 */
    remoteExportDeliveryReceipt(request: DotPostboxReceiptRequest): Promise<DeliveryRecord>;
    /** 重试投递（飞书真发；native 只标记已交给前端队列）。 */
    remoteExportRetry(request: DotPostboxRetryRequest): Promise<DeliveryRecord>;
    /** 渠道与整体状态。 */
    remoteExportStatus(): DotPostboxStatusValue;
    /** 变化流：Client 订阅后按 seq 主动拉快照/增量。 */
    remoteExportWatch(signal: AbortSignal): AsyncIterable<DotPostboxWatchFrame>;
}
