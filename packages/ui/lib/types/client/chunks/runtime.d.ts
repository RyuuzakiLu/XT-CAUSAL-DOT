/** 本包允许按需取回的固定块。新增块必须同时登记文件名与构建配置。 */
export type ChunkId = 'scene-conversation' | 'scene-memory' | 'scene-work' | 'scene-postbox' | 'settings' | 'sprite' | 'art';
/** 块 id → 宿主要求的同目录文件名。文件名就是路由的一部分，不能随手改。 */
export declare const CHUNK_FILE: Readonly<Record<ChunkId, string>>;
/**
 * 同步探针：测试与首帧渲染用。
 * @param id - 块 id
 * @returns 已就绪的模块；未加载时 undefined
 */
export declare function peekChunk<T>(id: ChunkId): T | undefined;
/**
 * 直接登记一个已就绪的块。
 * 为什么需要：jsdom / 截图环境没有宿主的 require.async，也不能为了测试把大图
 * 静态 import 回 client.js；测试侧登记真实组件，生产侧仍走网络块。
 * @param id - 块 id
 * @param module - 与生产块同形状的导出对象
 */
export declare function registerChunk<T>(id: ChunkId, module: T): void;
/** 测试用：撤掉登记，验证占位与重试路径。生产代码不调用。 */
export declare function unregisterChunk(id: ChunkId): void;
/**
 * 取一块，返回它的导出。失败只 reject，不缓存失败。
 * @param id - 块 id
 * @returns 块导出对象（形如 `{ Scene }` / `{ SpriteStateArt }` / `{ src }`）
 */
export declare function loadChunk<T>(id: ChunkId): Promise<T>;
