/* ================================================================
   DOT 稳定标识与状态取值

   ▍这是什么
   跨插件传递的 ID 与状态机的取值域。

   ▍为什么用品牌类型
   裸 string 会让"工作 ID"和"成果 ID"在编译期可以互串——传错了也照样编译通过，
   到了界面上就是"点一封信打开了另一件事"。品牌类型让编译器替我们挡这一刀，
   运行时零成本（类型擦除后还是字符串）。

   ▍修改铁律
   1. 【不】删状态取值；删了会让历史记录读不出来。要淘汰就保留并标 deprecated。
   2. 【不】用中文标题做机器判定；标题会改，取值不会。
   3. 品牌标记只用unique symbol；普通__dotBrand字段会让生成器要求字符串同时是对象。
   ▍更新记录
   *更新：2026-10-26 · 修编号标记的线路擦除，保留编译期防互串*
   ================================================================ */

/** ⚠️ 仅用unique symbol作编译期标记：Typert会擦除它；普通命名字段会被误生成为JSON对象校验。 */
declare const DOT_ID: unique symbol
/** 品牌化的稳定 ID：运行时就是字符串，编译期不可与其它 ID 互串。 */
export type Branded<B extends string> = string & { readonly [DOT_ID]: B }

/** 一件工作的稳定标识。 */
export type WorkId = Branded<'WorkId'>

/** 一份成果的稳定标识。 */
export type ArtifactId = Branded<'ArtifactId'>

/** 一条星邮匣事件的稳定标识。 */
export type PostboxEventId = Branded<'PostboxEventId'>

/** 一次工作的状态。 */
export type WorkStatus =
  /** 已登记，等待后台额度。 */
  | 'queued'
  /** 正在执行。 */
  | 'running'
  /** 需要用户补充信息才能继续。 */
  | 'waiting-input'
  /** 需要用户确认（例如外部动作）才能继续。 */
  | 'waiting-approval'
  /** 已有真实结果。 */
  | 'succeeded'
  /** 明确失败，带原因。 */
  | 'failed'
  /** 用户取消；已发生的外部动作不因取消而撤回。 */
  | 'cancelled'
  /** 进程重启等原因中断，是否需要续跑未知。 */
  | 'interrupted'
  /** 记录存在但状态无法确认（例如重启后对不上执行记录）。 */
  | 'unknown'

/** 仍在推进的状态集合——界面用它决定要不要继续订阅。 */
export const ACTIVE_WORK_STATUSES: readonly WorkStatus[] = ['queued', 'running', 'waiting-input', 'waiting-approval']

/** 终态集合——到达后不再有新的阶段变化。 */
export const TERMINAL_WORK_STATUSES: readonly WorkStatus[] = ['succeeded', 'failed', 'cancelled', 'interrupted']

/**
 * 判断一个状态是否仍在推进。
 * 为什么单独成函数：界面和通知都要用同一条判定，分散写 `status === 'running'`
 * 会漏掉 waiting-input 这类"还没完但不动"的状态。
 * @param status - 工作状态
 * @returns 仍在推进时为 true
 */
export function isActiveWork(status: WorkStatus): boolean {
  return ACTIVE_WORK_STATUSES.includes(status)
}

/**
 * 把线路/界面来的裸字符串标记成工作 ID。
 *
 * ▍为什么需要这个函数
 * 品牌类型在编译期防止"工作 ID 和成果 ID 互串"，但跨越真实边界（解析后的 JSON、
 * 界面列表项、用户输入）时，它就是字符串。边界处显式收口一次，比在调用点撒
 * `as WorkId` 安全：类型系统能保证只有经过这个函数的值才被当作 ID，
 * 而散落的 `as` 会让编译器彻底失去这条线索。
 * @param value - 来自线路或界面的字符串 ID
 * @returns 同一字符串，带工作 ID 品牌
 */
export function workId(value: string): WorkId {
  return value as WorkId
}

/**
 * 把裸字符串标记成成果 ID。
 * @param value - 来自线路或界面的字符串 ID
 * @returns 同一字符串，带成果 ID 品牌
 */
export function artifactId(value: string): ArtifactId {
  return value as ArtifactId
}

/**
 * 把裸字符串标记成星邮匣事件 ID。
 * @param value - 来自线路或界面的字符串 ID
 * @returns 同一字符串，带事件 ID 品牌
 */
export function postboxEventId(value: string): PostboxEventId {
  return value as PostboxEventId
}
