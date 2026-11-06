/** 一条记忆命中（引擎结果 → 前端/模型共用形状）。 */
export interface MemoryHit {
    /** 引擎条目 id，形如 `mem-xxxxxxxx`；纠正/删除都用它。 */
    readonly id: string;
    /** 正文（引擎原文）。 */
    readonly text: string;
    /** 相关性分数；引擎给了才有。 */
    readonly score?: number | undefined;
    /** 重要度 0..1。 */
    readonly importance?: number | undefined;
    /** 所属域（引擎的 namespace；只读展示，不作为输入）。 */
    readonly namespace: string;
    readonly project?: string | undefined;
    /** 最后更新时间（毫秒）。 */
    readonly updatedAt?: number | undefined;
    /** 层级：`refined`（精选）或 `raw`（原料）。 */
    readonly tier?: string | undefined;
    /** 轨迹：`default` / `profile` / `identity` … */
    readonly track?: string | undefined;
    /** 状态：`active` / `superseded` / `archived`。 */
    readonly state?: string | undefined;
    /** 被哪条记忆取代（纠正后旧条目的真指针）。 */
    readonly supersededBy?: string | undefined;
}
/** 检索请求。 */
export interface MemorySearchRequest {
    readonly query: string;
    readonly top?: number;
    readonly project?: string;
}
/** 检索结果。 */
export interface MemorySearchValue {
    readonly ok: true;
    readonly query: string;
    readonly count: number;
    readonly hits: readonly MemoryHit[];
    /** 引擎给的检索模式（refined-first / raw-fallback / backfill-only …），用于解释置信度。 */
    readonly mode: string;
    /** 引擎给的判定文字（中文，仅供展示，不参与机器判断）。 */
    readonly verdict?: string | undefined;
}
/** 保存请求。 */
export interface MemoryStoreRequest {
    readonly text: string;
    /** 防重标识：同一 operationId 重放返回同一 id（引擎层真实幂等）。 */
    readonly operationId: string;
    readonly project?: string;
    readonly importance?: number;
    readonly tags?: readonly string[];
}
/** 保存结果。 */
export interface MemoryStoreValue {
    readonly ok: boolean;
    readonly id?: string | undefined;
    /** created=新写入；idempotent=同 operationId 重放；skipped=去重跳过；rejected=引擎拒写。 */
    readonly action: 'created' | 'idempotent' | 'skipped' | 'rejected';
    readonly namespace: string;
    readonly reason?: string | undefined;
}
/** 纠正请求。 */
export interface MemoryCorrectRequest {
    readonly id: string;
    readonly text: string;
    readonly operationId: string;
    readonly reason?: string;
}
/** 纠正结果。 */
export interface MemoryCorrectValue {
    readonly ok: boolean;
    /** 新条目 id（纠正后的正确事实）。 */
    readonly id: string;
    /** 被取代的旧条目 id（引擎 `superseded_by` 指向新条目）。 */
    readonly supersededId: string;
    readonly action: 'corrected';
}
/** 删除请求。 */
export interface MemoryForgetRequest {
    readonly id: string;
    readonly operationId: string;
    /** 缺省=false：只预览将命中的条目，零副作用。true 才真删（引擎归档 + 存根）。 */
    readonly confirmed?: boolean;
}
/** 删除结果。 */
export interface MemoryForgetValue {
    readonly ok: boolean;
    readonly confirmed: boolean;
    readonly removed: number;
    /** 未确认时的待删数量（预览）。 */
    readonly pending?: number | undefined;
    /** 未确认时的待删 id 清单（最多 20 条，引擎给多少回多少）。 */
    readonly preview?: readonly string[] | undefined;
    /** 确认删除时引擎是否登记了遗忘存根（防 WAL 重放复活）。 */
    readonly tombstoneRegistered?: boolean | undefined;
    readonly reason?: string | undefined;
}
/** 单条读取请求。 */
export interface MemoryGetRequest {
    readonly id: string;
}
/** 单条读取结果。 */
export interface MemoryGetValue {
    readonly ok: boolean;
    readonly hit?: MemoryHit | undefined;
}
/** 列表请求。 */
export interface MemoryListRequest {
    readonly query?: string;
    readonly limit?: number;
    readonly project?: string;
}
/** 列表结果。 */
export interface MemoryListValue {
    readonly ok: true;
    readonly count: number;
    readonly hits: readonly MemoryHit[];
}
/** 能力状态：缺配置就如实不可用，不假成功。 */
export interface MemoryStatusValue {
    readonly available: boolean;
    readonly engine: 'xtmem';
    /** 本端身份（配置给定，模型/前端不可覆盖）。 */
    readonly actor: string;
    /** 默认域（配置给定）。 */
    readonly namespace: string;
    /** 是否连接到隔离库（永远 true：本适配器不接受外部库路径）。 */
    readonly dbIsolated: true;
    /** 不可用原因；可用时不出现。 */
    readonly reason?: string | undefined;
    /** 引擎版本/入口描述（便于排障，不含密钥）。 */
    readonly engineVersion?: string | undefined;
}
/**
 * 变化通知帧（界面刷新用）。
 *
 * `ready` 是开流第一帧：官方流协议没有开流确认帧，不推这一帧客户端就分不清
 * "订阅成功但暂无变化"与"流根本没起来"（实测：不开流确认会让 8s 内零字节）。
 */
export type MemoryWatchFrame = {
    readonly type: 'ready';
} | {
    readonly type: 'changed';
    /** 变化类型。 */
    readonly action: 'store' | 'correct' | 'forget';
    /** 相关条目 id。 */
    readonly ids: readonly string[];
};
