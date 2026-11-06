/** 人物图 data URI；字段可选，按块陆续登记。 */
export type ArtSources = {
    /** 首屏头像（壳自己带，注册在这里供房间复用）。 */
    avatar?: string;
    /** 精灵停靠图。 */
    docked?: string;
    /** 精灵坐姿图（环形菜单、设置覆盖层）。 */
    seated?: string;
    /** 精灵待机图。 */
    sprite?: string;
};
/**
 * 合并登记一批图源。
 * @param patch - 只提供本次拿到的字段；没提供的保持原值
 */
export declare function mergeArtSources(patch: ArtSources): void;
/** 供非 React 代码（测试、诊断）同步读取。 */
export declare function getArtSources(): ArtSources;
/** React 侧订阅：art/头像登记变化时自动重渲染引用它的组件。 */
export declare function useArtSources(): ArtSources;
