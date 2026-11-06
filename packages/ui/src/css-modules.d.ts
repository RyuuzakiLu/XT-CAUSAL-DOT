/* DOT 样式模块只暴露局部类名，避免组件依赖全局选择器。 */
declare module '*.module.css' { const classes: Record<string, string>; export default classes; export const cssText: string }
