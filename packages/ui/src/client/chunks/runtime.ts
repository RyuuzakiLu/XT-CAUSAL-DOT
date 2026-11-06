/* ================================================================
   按需分块运行时 · 总导游图（改代码前必读）
   ▍这是什么
   壳（client.js）需要某个房间/设置/精灵时才去取它那一块
   `client.<名字>.js`，取到后渲染；取不到就显示可点重试的占位，不让整页白屏。
   ▍为什么不用原生 import()
   宿主的分块路由只认"插件同目录、文件名符合 client.<name>.js，且由
   __ModuleLoader__.load({ id, chunk, factory }) 注册"这一种脚本；`import('./x.js')`
   产出的是浏览器 ESM 块，既不在这个路由里，也没有宿主的模块表 require，
   React 会变成第二份实例（hook 报错）。所以这里必须走宿主注入给工厂的
   `require.async('./client.xxx.js')`——就是字体分片用的同一条通道。
   ▍结构
   块清单（ChunkId → 文件名）→ 缓存与在途去重 → 失败即清空可重试 →
   测试/截图环境用 registerChunk 直接放模块（同步命中，不碰网络）。
   ▍修改铁律
   1. 【不】在这里做通用模块联邦/预取框架：只登记本包自己的固定几块。
   2. 【不】缓存失败：失败必须从 inflight 清掉，否则重试永远拿到旧异常。
   3. 块名必须匹配宿主正则 ^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$，
      否则 require.async 会在浏览器里直接抛 invalid relative chunk request。
   ▍更新记录
   2026-10-25 · 建立：六空间/设置/精灵/美术块的最小按需加载。
   2026-10-27 · 能力空间整页删除，scene-capabilities 块随之撤掉。
================================================================ */

/** 本包允许按需取回的固定块。新增块必须同时登记文件名与构建配置。 */
export type ChunkId =
  | 'scene-conversation'
  | 'scene-memory'
  | 'scene-work'
  | 'scene-postbox'
  | 'settings'
  | 'sprite'
  | 'art'

/** 块 id → 宿主要求的同目录文件名。文件名就是路由的一部分，不能随手改。 */
export const CHUNK_FILE: Readonly<Record<ChunkId, string>> = {
  'scene-conversation': 'client.scene-conversation.js',
  'scene-memory': 'client.scene-memory.js',
  'scene-work': 'client.scene-work.js',
  'scene-postbox': 'client.scene-postbox.js',
  settings: 'client.settings.js',
  sprite: 'client.sprite.js',
  art: 'client.art.js',
}

/**
 * 已取到（或测试直接塞入）的块，以及在途请求。
 *
 * ⚠️ 必须是页面单例：壳与各按需块各打包一份本模块，模块级 Map 不互通；若各自记一份，
 * 房间块里的 `useChunk('art')` 会和壳对同一块再发一次请求（宿主会去重，但两个加载栈
 * 的"已就绪"判断会不同步，重试与缓存语义就乱了）。这里用 Symbol.for 共享同一张表。
 */
interface ChunkBridge {
  loaded: Map<ChunkId, unknown>
  inflight: Map<ChunkId, Promise<unknown>>
}
const BRIDGE_KEY = Symbol.for('xtcausal.dot.chunk-runtime')
const bridgeHost = globalThis as unknown as { [BRIDGE_KEY]?: ChunkBridge }
const bridge: ChunkBridge = bridgeHost[BRIDGE_KEY] ?? (bridgeHost[BRIDGE_KEY] = {
  loaded: new Map(), inflight: new Map(),
})
const loaded = bridge.loaded
const inflight = bridge.inflight

/**
 * 同步探针：测试与首帧渲染用。
 * @param id - 块 id
 * @returns 已就绪的模块；未加载时 undefined
 */
export function peekChunk<T>(id: ChunkId): T | undefined {
  return loaded.get(id) as T | undefined
}

/**
 * 直接登记一个已就绪的块。
 * 为什么需要：jsdom / 截图环境没有宿主的 require.async，也不能为了测试把大图
 * 静态 import 回 client.js；测试侧登记真实组件，生产侧仍走网络块。
 * @param id - 块 id
 * @param module - 与生产块同形状的导出对象
 */
export function registerChunk<T>(id: ChunkId, module: T): void {
  loaded.set(id, module)
  inflight.delete(id)
}

/** 测试用：撤掉登记，验证占位与重试路径。生产代码不调用。 */
export function unregisterChunk(id: ChunkId): void {
  loaded.delete(id)
  inflight.delete(id)
}

/**
 * 找宿主注入的异步取块函数。
 *
 * ⚠️ 必须走工厂参数里的 `require`：它才是模块表那一个；全局 `require` 在
 * 浏览器里不存在。取块函数用动态拼接，避免打包器把 `./client.x.js` 当静态
 * 依赖去解析出一个并不存在的文件。
 * @returns 取块函数，或 undefined（不在 DSH 宿主里）
 */
function hostChunkImport(): ((spec: string) => Promise<unknown>) | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req: any = typeof require === 'function' ? require : undefined
    if (req && typeof req.async === 'function') return (spec: string) => req.async(spec) as Promise<unknown>
  } catch {
    /* 不在宿主里 */
  }
  const g = globalThis as { __dotChunkImport?: (file: string) => Promise<unknown> }
  return typeof g.__dotChunkImport === 'function' ? g.__dotChunkImport : undefined
}

/** 块工厂导出可能是裸对象（宿主原样返回 module.exports），这里也只容忍 default 包装。 */
function moduleValue<T>(raw: unknown): T {
  const box = raw as { default?: unknown } | null | undefined
  return (box && typeof box === 'object' && 'default' in box && box.default !== undefined
    ? box.default
    : raw) as T
}

/**
 * 取一块，返回它的导出。失败只 reject，不缓存失败。
 * @param id - 块 id
 * @returns 块导出对象（形如 `{ Scene }` / `{ SpriteStateArt }` / `{ src }`）
 */
export function loadChunk<T>(id: ChunkId): Promise<T> {
  const hit = loaded.get(id)
  if (hit !== undefined) return Promise.resolve(hit as T)
  const running = inflight.get(id)
  if (running !== undefined) return running as Promise<T>
  const load = hostChunkImport()
  if (load === undefined) {
    return Promise.reject(new Error(`当前环境没有分块加载器，无法取 ${CHUNK_FILE[id]}`))
  }
  const pending = load(`./${CHUNK_FILE[id]}`)
    .then((raw) => {
      const value = moduleValue<T>(raw)
      loaded.set(id, value)
      return value
    })
    .finally(() => { inflight.delete(id) })
  inflight.set(id, pending)
  return pending
}
