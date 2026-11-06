import { type ReactElement } from 'react';
import { type DotNotice } from './notices.ts';
import type { SpriteBubbleQueue } from './sprite-bubbles.ts';
export interface SpriteBubbleActions {
    /** 跳到工作空间对应的工作卡。 */
    openWork(workId: string): void;
    /** 打开星邮匣里的这封提醒。 */
    openPostbox(postboxId?: string): void;
    /** 这条要确认的通知现在能不能直接答。 */
    canDecide(notice: DotNotice): boolean;
    /** 答复；返回 false 表示没答成（请求已不在）。 */
    decide(notice: DotNotice, decision: 'allow' | 'reject'): boolean;
    /** canDecide 的结果会变时，用它通知重画。 */
    subscribeDecidable?(listener: () => void): () => void;
    decidableVersion?(): number;
    /** 用户点了这条气泡（打开、确认、拒绝、去填写、知道了）；点 × 自己收起的不算。星邮匣据此记投递回执。 */
    acknowledge?(notice: DotNotice): void;
}
export interface SpriteBubblesProps {
    readonly queue: SpriteBubbleQueue;
    readonly actions: SpriteBubbleActions;
    /** 找到当前露在外面的精灵元素。 */
    readonly findSprite: () => Element | null;
    readonly reducedMotion?: boolean;
}
export declare function SpriteBubbles({ queue, actions, findSprite, reducedMotion }: SpriteBubblesProps): ReactElement | null;
