import type { DotNotice } from './notices.ts';
/** 这条通知对应的工作卡状态；不参与去重的返回 undefined。 */
export declare function cardStatusOf(notice: Pick<DotNotice, 'kind' | 'tone' | 'workId'> & {
    readonly key?: string;
}): 'waiting-input' | 'succeeded' | 'failed' | undefined;
/** 屏幕上是否已有一张同一工作、同一状态的工作卡在展示这条通知的内容。 */
export declare function noticeCoveredByCard(notice: Pick<DotNotice, 'kind' | 'tone' | 'workId'> & {
    readonly key?: string;
}, doc?: Document | undefined): boolean;
