export declare const POSTBOX_SEEN_KEY = "dot.postbox.seenAt";
export declare const POSTBOX_SEEN_EVENT = "dot:postbox-seen";
/** 上次打开星邮匣的时间（ms）；没有记录就是 0。 */
export declare function readPostboxSeenAt(): number;
/** 记下“看过了”；只往后推，不往回拨。 */
export declare function markPostboxSeen(at: number): void;
/** 角标数：没归档、没读、而且在上次打开星邮匣之后才有新动态的条数。 */
export declare function unseenLetterCount(letters: readonly {
    read: boolean;
    archived: boolean;
    at?: number | undefined;
}[], seenAt: number): number;
/** 订阅水位：本页或别的标签页打开星邮匣后立刻刷新。 */
export declare function usePostboxSeenAt(): number;
