/**
 * 挂一块的样式（幂等）。
 * @param key - 稳定身份（块 id），用于去重与清理定位
 * @param cssText - 块内 CSS Module 的编译后文本
 */
export declare function ensureChunkStyle(key: string, cssText: string | undefined): void;
/** 插件卸载时清掉所有分块样式（房间没打开的块本来就没有标签）。 */
export declare function releaseChunkStyles(): void;
