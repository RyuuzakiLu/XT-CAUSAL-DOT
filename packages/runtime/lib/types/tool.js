import { defineTool } from '@deepseek-ai/dsh-tools';
/** 工具名：带 dot_ 前缀，避免与官方工具撞名。 */
export const CAPABILITY_TOOL_NAME = 'dot_capabilities';
/**
 * 注册目录工具。
 * @param ctx - Host 上下文（提供 ctx.tools）
 * @param directory - 目录服务
 * @returns 注册的清理函数（交给 ctx.effect 持有）
 */
export function registerCapabilityTool(ctx, directory) {
    return ctx.tools.register(defineTool({
        name: CAPABILITY_TOOL_NAME,
        description: '列出**你此刻真正能调用**的工具（工具名、说明、必填参数）。回答"你能做什么"或规划步骤前必须用它，不要凭印象列举；返回的是本会话作用域的视图。',
        parameters: {},
        output: {
            schema: {
                type: 'object',
                properties: {
                    revision: { type: 'number', required: true },
                    scope: { type: 'string', required: true },
                    tools: {
                        type: 'array',
                        required: true,
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string', required: true },
                                description: { type: 'string', required: true },
                                requiredFields: { type: 'array', items: { type: 'string' }, required: true },
                            },
                            additionalProperties: false,
                        },
                    },
                },
                additionalProperties: false,
            },
            // 模型看到的是紧凑清单；界面另有自己的卡片，不走这里。
            render: (_args, value) => [{
                    type: 'text',
                    text: value.tools.length === 0
                        ? '当前没有可用工具。'
                        : [`当前可用能力（快照 ${value.revision}）：`, ...value.tools.map(tool => `- ${tool.name}：${tool.description}`)].join('\n'),
                }],
        },
        async execute(_args, exec) {
            // ⚠️ 用 `exec.agent` 作为作用域：ASTRA 的工具大多挂在 preset 层，
            // 只读全局会漏掉它们、也会算进别的会话才有的工具。官方 PTC 运行时同口径。
            const snapshot = directory.snapshotFor(exec.agent);
            return {
                revision: snapshot.revision,
                scope: snapshot.scope,
                tools: snapshot.tools.map(tool => ({
                    name: tool.name,
                    description: tool.description,
                    requiredFields: [...tool.requiredFields],
                })),
            };
        },
    }));
}
