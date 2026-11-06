export interface FailureReason {
    /** 给人看的一句话。 */
    sentence: string;
    /** 原始信息；原文本身已经是一句短中文时为空（不再重复折叠一份）。 */
    raw: string;
    /** 命中的类别，测试和埋点用。 */
    kind: FailureKind;
}
export type FailureKind = 'timeout' | 'tool-missing' | 'auth' | 'forbidden' | 'rate-limit' | 'server' | 'too-long' | 'model-rejected' | 'bad-request' | 'network' | 'plain' | 'generic';
export declare const GENERIC_FAILURE = "\u8FD9\u6B21\u6CA1\u505A\u6210\uFF0C\u51FA\u4E86\u70B9\u610F\u5916\u3002\u53EF\u4EE5\u70B9\u300C\u91CD\u8BD5\u300D\u518D\u505A\u4E00\u6B21\u3002";
/** 找报错里的 HTTP 状态码：开头「400:」「HTTP 429」「status 503」「[401]」「status_code: 500」。 */
export declare function statusCodeOf(text: string): number | null;
export declare function explainFailure(input: unknown): FailureReason | null;
