import { type ChunkId } from './runtime.ts';
export interface ChunkState<T> {
    /** 已就绪的块导出；未就绪为 null。 */
    readonly module: T | null;
    /** 取块失败原因；成功后清空。 */
    readonly error: Error | null;
    /** 失败后重试（也用于调用方手动重取）。 */
    readonly retry: () => void;
    /** 第几次尝试（从 0 起）。占位组件拿它当 key，重试时慢网提示从头计时。 */
    readonly attempt: number;
}
/**
 * 取一块并跟随其状态。
 * @param id - 块 id
 * @param enabled - 关掉时不发起请求，但仍会响应"已经就绪"的同步命中
 * @returns 模块、错误与重试入口
 */
export declare function useChunk<T>(id: ChunkId, enabled?: boolean): ChunkState<T>;
