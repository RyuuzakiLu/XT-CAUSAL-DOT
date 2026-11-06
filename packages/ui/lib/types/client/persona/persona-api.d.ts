export type PersonaGender = 'female' | 'male' | 'unset';
export interface PersonaProfile {
    name: string;
    userName: string;
    gender: PersonaGender;
    brief: string;
    expanded: string;
    expandedEdited: boolean;
    expandedAt: string | null;
    onboardedAt: string | null;
    updatedAt: string | null;
}
export interface PersonaView {
    profile: PersonaProfile;
    needsOnboarding: boolean;
    defaults: {
        name: string;
    };
    limits: {
        name: number;
        userName: number;
        brief: number;
        expanded: number;
    };
    expandError?: string | null;
}
export interface PersonaPatch {
    name?: string;
    userName?: string;
    gender?: PersonaGender;
    brief?: string;
    expanded?: string;
    expandedFromPreview?: boolean;
    expand?: boolean;
    onboarding?: boolean;
}
export declare const GENDER_OPTIONS: {
    key: PersonaGender;
    label: string;
}[];
export declare const BRIEF_PLACEHOLDER = "\u60F3\u5199\u4EC0\u4E48\u5199\u4EC0\u4E48\uFF0C\u6BD4\u5982\u5B83\u7684\u5916\u8C8C\u3001\u6027\u683C\u3001\u8BF4\u8BDD\u98CE\u683C\u3001\u600E\u4E48\u79F0\u547C\u81EA\u5DF1\u548C\u4F60\u3001\u53E3\u5934\u7985\u3001\u559C\u6B22\u4EC0\u4E48\u2026\u2026\n\n\u4F8B\uFF1A\u94F6\u8272\u77ED\u53D1\uFF0C\u603B\u522B\u7740\u4E00\u679A\u661F\u661F\u53D1\u5361\u3002\u6E29\u67D4\u7EC6\u5FC3\uFF0C\u6709\u70B9\u5C0F\u8FF7\u7CCA\u3002\u8BDD\u4E0D\u591A\uFF0C\u5F00\u5FC3\u65F6\u53E5\u5C3E\u5E26\u201C~\u201D\u3002\u5E73\u65F6\u81EA\u79F0\u201C\u6211\u201D\uFF0C\u53EB\u6211\u201C\u963F\u9F99\u201D\u3002\u559C\u6B22\u732B\uFF0C\u628A\u8BB0\u5F85\u529E\u53EB\u4F5C\u201C\u653E\u8FDB\u5C0F\u672C\u672C\u201D\u3002";
/** 写太少时的提示（不强制）。没写或写够了返回空串。 */
export declare function thinHint(brief: string): string;
/** 只扩写不保存：先给用户看一版，满意了再用 savePersona 存。 */
export declare function previewPersona(draft: {
    name: string;
    userName: string;
    gender: PersonaGender | '';
    brief: string;
}): Promise<string>;
export declare function loadPersona(): Promise<PersonaView>;
export declare function savePersona(patch: PersonaPatch): Promise<PersonaView>;
