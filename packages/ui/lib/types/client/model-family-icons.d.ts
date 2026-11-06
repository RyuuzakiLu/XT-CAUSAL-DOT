import type { ModelFamily } from './model-identity.ts';
/** 一条家族图标：单一颜色 + 一到多个路径（Kimi 是两个形状拼合）。 */
export interface FamilyIcon {
    /** 品牌色；单色版本身无填充，颜色在这里给，才能跟随主题深浅。 */
    readonly color: string;
    readonly paths: readonly string[];
}
/** 只有被明确识别的家族才有图标；'其他模型' 故意缺席。 */
export declare const FAMILY_ICONS: Readonly<Partial<Record<ModelFamily, FamilyIcon>>>;
/**
 * 取一个家族的图标。
 * @param family - 名称识别结果
 * @returns 图标；未识别家族返回 undefined，调用方回退通用图形
 */
export declare function familyIcon(family: ModelFamily): FamilyIcon | undefined;
