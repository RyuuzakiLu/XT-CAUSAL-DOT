import type { WorkSnapshot } from '@xtcausal/dot-contracts';
export interface WorkPick {
    /** 唯一确定的工作（可能为空：没有任何工作，或有歧义）。 */
    readonly works: readonly WorkSnapshot[];
    /** 有歧义时的候选（新→旧，最多 5 项）；无歧义时为空。 */
    readonly candidates: readonly WorkSnapshot[];
}
/** match 与一项工作的相关度（0 = 无关）。整词命中权重最高，其次中文双字重叠。 */
export declare function matchScore(work: Pick<WorkSnapshot, 'goal' | 'stage'>, match: string): number;
/**
 * 从最近的工作里挑出用户问的那一项。
 * @param works - 按 updatedAt 新→旧排好的快照
 * @param match - 用户原话里描述这项工作的词；可缺
 */
export declare function pickWorkForQuery(works: readonly WorkSnapshot[], match?: string): WorkPick;
