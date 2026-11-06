import z from '@deepseek-ai/schemastery';
import { MemoryService } from "./service.js";
import { isCloudMode } from "./deployment-mode.js";
import { MemoryRemote } from "./remote.js";
import { MemoryPromptInjector } from "./context.js";
import { registerMemoryTools } from "./tools.js";
/** Loader 诊断里显示的名字。 */
export const name = 'dot-memory';
/** 硬依赖：工具注册表、提示词装配、Remote 注册面。 */
export const inject = ['tools', 'systemPrompt', 'typert'];
/*
 * 配置 schema。
 * ⚠️ 本地（默认）模式下 dbPath / workspaceDir / actor / namespace 仍然**必填**：
 *   这里只在云端模式下放宽成空串，因为云端的 Agent 侧不直用 Python、不持库文件，
 *   身份也来自工牌而非配置；
 *   真正的"必须配好"校验放在 apply()（本地缺值仍启动失败，绝不会默默连别的库）。
 *   为什么不让 schema 硬 required：云端 launcher 不该为了过校验编一个假磁盘路径。
 */
export const Config = z.object({
    dbPath: z.string().default(''),
    workspaceDir: z.string().default(''),
    actor: z.string().default(''),
    namespace: z.string().default(''),
    python: z.string().default('python'),
    engineRoot: z.string().default(''),
    cliPath: z.string().default(''),
    timeoutMs: z.natural().min(1000).max(600000).default(120000),
    contextTop: z.natural().min(0).max(20).default(5),
    contextMaxChars: z.natural().min(80).max(4000).default(400),
    injectUsageRules: z.boolean().default(true),
});
/** 服务键。 */
export const MEMORY_SERVICE_KEY = 'dotMemory';
/*
 * 对外再导出（装配侧/测试从包根取，不摸 src/）。
 */
export { MemoryService } from "./service.js";
/*
 * ⚠️【勿删】必须从包入口静态导出 Remote owner 类。
 *   Typert 生成器靠**静态分析包入口的类型图**发现 `@Remote` 方法；只在 apply 里
 *   `ctx.plugin(MemoryRemote, …)` 动态挂载，生成器看不到这个类，`./remote` 产物就会缺方法，
 *   Client 侧 `ctx.remote.dotMemory.*` 全部落空（表现为"接口在、类型没有"）。
 */
export { MemoryRemote } from "./remote.js";
export { MemoryEngineError, createXtmemEngine } from "./engine.js";
export { MemoryPromptInjector, MEMORY_CONTEXT_SECTION, MEMORY_USAGE_SECTION, } from "./context.js";
export { registerMemoryTools, MEMORY_TOOL_NAMES } from "./tools.js";
/**
 * 装配记忆适配。
 * @param ctx - Host 上下文
 * @param config - 已由 schemastery 补齐的配置
 */
export function apply(ctx, config) {
    const cloud = isCloudMode();
    // 本地模式下"没配好就起不来"必须保住：schema 为了让云端能空着启动放宽了必填，
    // 这里把校验补回来。云端则只要求能拿到数据服务地址（身份走工牌）。
    if (!cloud) {
        const missing = ['dbPath', 'workspaceDir', 'actor', 'namespace']
            .filter((key) => config[key].trim() === '');
        if (missing.length > 0) {
            throw new Error(`dot-memory: 本地模式缺少必填配置 ${missing.join(' / ')}（拒绝回落到引擎默认库）`);
        }
    }
    const service = new MemoryService({
        dbPath: config.dbPath,
        workspaceDir: config.workspaceDir,
        actor: config.actor,
        namespace: config.namespace,
        python: config.python,
        timeoutMs: config.timeoutMs,
        // 云端模式由 DOT_CLOUD_MODE=1 决定：服务层据此改用 HTTP"电话线"，绝不回落本地 CLI。
        cloud: isCloudMode(),
        ...(config.engineRoot === '' ? {} : { engineRoot: config.engineRoot }),
        ...(config.cliPath === '' ? {} : { cliPath: config.cliPath }),
    });
    ctx.effect(() => registerMemoryTools(ctx.tools, service), 'dot-memory: 模型工具');
    if (config.contextTop > 0 || config.injectUsageRules) {
        const injector = new MemoryPromptInjector(ctx, service, {
            top: config.contextTop,
            maxCharsPerHit: config.contextMaxChars,
            injectUsageRules: config.injectUsageRules,
        });
        ctx.effect(() => () => injector.dispose(), 'dot-memory: 上下文注入');
    }
    ctx.effect(() => ctx.reflect.provide(MEMORY_SERVICE_KEY, service), 'dot-memory: 服务注册');
    ctx.plugin(MemoryRemote, service);
}
