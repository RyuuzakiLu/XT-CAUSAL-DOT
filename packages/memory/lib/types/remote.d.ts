import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { Context } from '@deepseek-ai/cordis';
import type { MemoryService } from './service.ts';
import type { MemoryCorrectRequest, MemoryCorrectValue, MemoryForgetRequest, MemoryForgetValue, MemoryGetRequest, MemoryGetValue, MemoryListRequest, MemoryListValue, MemorySearchRequest, MemorySearchValue, MemoryStatusValue, MemoryStoreRequest, MemoryStoreValue, MemoryWatchFrame } from './types.ts';
declare module '@deepseek-ai/dsh-typert-protocol' {
    interface RemoteErrorDetailsMap {
        /** 引擎不可用（缺 CLI、缺引擎目录、Python 起不来）。 */
        'memory/engine-unavailable': {
            readonly reason: string;
        };
        /** 引擎执行失败或输出无法解析。 */
        'memory/engine-failed': {
            readonly reason: string;
        };
        /** 引擎超时。 */
        'memory/engine-timeout': {
            readonly reason: string;
        };
        /** 引擎明确拒绝（重复内容、跨域纠正、旧条目不存在等）。 */
        'memory/rejected': {
            readonly reason: string;
        };
    }
}
/**
 * 记忆 Remote owner。
 */
export declare class MemoryRemote extends TypertRemoteService {
    private readonly service;
    /**
     * ⚠️【勿动】Cordis 服务键必须是 `dotMemoryRemote`，**不能**与业务服务键 `dotMemory` 相同：
     *   同一个键注册两次会在装配时抛 `service "dotMemory" has been registered`。
     *   官方惯例同款：JobController 服务键 `jobController` / wire namespace `job`。
     */
    constructor(ctx: Context, service: MemoryService);
    /** 语义检索。 */
    remoteExportSearch(request: MemorySearchRequest): Promise<MemorySearchValue>;
    /** 保存。 */
    remoteExportStore(request: MemoryStoreRequest): Promise<MemoryStoreValue>;
    /** 纠正（新条目 + 旧条目退役）。 */
    remoteExportCorrect(request: MemoryCorrectRequest): Promise<MemoryCorrectValue>;
    /** 删除（默认只预览）。 */
    remoteExportForget(request: MemoryForgetRequest): Promise<MemoryForgetValue>;
    /** 单条读取。 */
    remoteExportGet(request: MemoryGetRequest): Promise<MemoryGetValue>;
    /** 列表（无 query = 按重要度/时间列最近）。 */
    remoteExportList(request: MemoryListRequest): Promise<MemoryListValue>;
    /** 能力状态（缺配置如实不可用）。 */
    remoteExportStatus(): Promise<MemoryStatusValue>;
    /** 变化流：界面订阅后重取快照。 */
    remoteExportWatch(signal: AbortSignal): AsyncIterable<MemoryWatchFrame>;
}
