export declare const BRIEF_FIELDS: readonly [{
    readonly key: "appearance";
    readonly label: "外貌";
    readonly placeholder: "可以写发型、衣着或你希望的形象。";
}, {
    readonly key: "personality";
    readonly label: "性格";
    readonly placeholder: "它待人做事是什么脾气？";
}, {
    readonly key: "style";
    readonly label: "说话风格";
    readonly placeholder: "喜欢简短直说，还是细致解释？";
}, {
    readonly key: "address";
    readonly label: "称呼";
    readonly placeholder: "希望它平时怎么称呼你？";
}, {
    readonly key: "self";
    readonly label: "自称";
    readonly placeholder: "它说起自己时，用什么称呼？";
}, {
    readonly key: "catchphrase";
    readonly label: "口癖";
    readonly placeholder: "有什么常说的话或表达习惯？";
}, {
    readonly key: "other";
    readonly label: "其他";
    readonly placeholder: "还想补充什么？原来写的人设也保留在这里。";
}];
export type BriefKey = typeof BRIEF_FIELDS[number]['key'];
export type BriefValues = Record<BriefKey, string>;
export declare function parseBrief(value: string): BriefValues;
export declare function serializeBrief(values: BriefValues): string;
