/* ================================================================
   DOT 记忆 · 模型可见工具

   ▍这是什么
   四个工具：`dot_memory_search` / `dot_memory_store` / `dot_memory_correct` /
   `dot_memory_forget`。参数里**没有** namespace、cross、库路径——身份与域由插件配置给定。

   ▍为什么要给模型"纠正"和"删除"两个独立工具
   产品要求（SPEC F09）明确：纠正必须落到引擎支持的版本/替代操作，删除必须能说出删的是哪条。
   把两者合并成一个"改记忆"会让模型在"我说错了"和"这条不该留"之间含糊，删错了没法解释。
   —— 像档案室：改错页和撕掉一页是两张不同的申请单。

   ▍修改铁律
   1. 【不】在工具参数里加 namespace / cross / dbPath / actor；那是提权口子。
   2. 工具输出必须是规范 JSON 值；面向人的说明放 render，不塞进 status 字段。
   3. 删除工具默认只预览；模型必须显式 confirmed=true 才真删（与引擎确认闸同口径）。
   4. 失败原样抛（Remote/工具层折成错误），不许 catch 后返回"成功但没做"。
   ================================================================ */
import { defineTool } from '@deepseek-ai/dsh-tools';
/** 工具名常量（供能力目录/文档引用，避免各处手写字符串）。 */
export const MEMORY_TOOL_NAMES = {
    search: 'dot_memory_search',
    store: 'dot_memory_store',
    correct: 'dot_memory_correct',
    forget: 'dot_memory_forget',
};
/** 一条命中在工具结果里的紧凑形状（模型看得懂即可，界面另有完整形状）。 */
function compact(hit) {
    return {
        id: hit.id,
        text: hit.text,
        ...(hit.updatedAt === undefined ? {} : { updatedAt: hit.updatedAt }),
        ...(hit.tier === undefined ? {} : { tier: hit.tier }),
    };
}
/**
 * 注册全部记忆工具。
 * @param tools - 工具注册表
 * @param service - 记忆服务
 * @returns 一个总的注销函数（各 register 也各自返回 disposer，这里合并）
 */
export function registerMemoryTools(tools, service) {
    const disposers = [];
    disposers.push(tools.register(defineTool({
        name: MEMORY_TOOL_NAMES.search,
        description: '检索长期记忆（独立 XTMEM 库）。涉及"以前说过/做过/决定过"时先查这里；返回带 id，可在回复中用 [m:<id>] 标注引用。',
        parameters: {
            query: { type: 'string', required: true, description: '自然语言查询' },
            top: { type: 'number', description: '返回条数，默认 5' },
            project: { type: 'string', description: '限定项目（可选）' },
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    count: { type: 'number', required: true },
                    hits: {
                        type: 'array',
                        required: true,
                        items: {
                            type: 'object',
                            properties: {
                                id: { type: 'string', required: true },
                                text: { type: 'string', required: true },
                                updatedAt: { type: 'number' },
                                tier: { type: 'string' },
                            },
                            additionalProperties: false,
                        },
                    },
                    mode: { type: 'string' },
                },
                additionalProperties: false,
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: value.hits.length === 0
                        ? '没有检索到相关记忆。'
                        : [`检索到 ${value.count} 条记忆（检索模式：${value.mode ?? 'unknown'}）：`,
                            ...value.hits.map(hit => `- [${hit.id}] ${hit.text}`),
                            '',
                            '引用时请在正文用 [m:<条目id>] 标注来源。'].join('\n'),
                }],
            // 2026-10-27：对话里的记忆卡片只认这份元数据（meta.dot === 'memory' && kind === 'memory-search'），
            // 不解析上面的中文。只带卡片要画的字段，正文截到 400 字，最多 8 条。
            presentationMeta: (args, value) => ({
                dot: 'memory',
                kind: 'memory-search',
                query: args.query,
                mode: value.mode ?? null,
                count: value.count,
                hits: value.hits.slice(0, 8).map(hit => ({
                    id: hit.id,
                    text: hit.text.length > 400 ? `${hit.text.slice(0, 400)}…` : hit.text,
                    ...(hit.updatedAt === undefined ? {} : { updatedAt: hit.updatedAt }),
                    ...(hit.tier === undefined ? {} : { tier: hit.tier }),
                })),
            }),
        },
        timeoutMs: 180_000,
        async execute(args) {
            const result = await service.search(args.query, {
                top: args.top ?? service.defaultTop,
                ...(args.project === undefined ? {} : { project: args.project }),
            });
            return {
                count: result.hits.length,
                hits: result.hits.map(compact),
                mode: result.mode,
            };
        },
    })));
    disposers.push(tools.register(defineTool({
        name: MEMORY_TOOL_NAMES.store,
        description: '把一条值得长期记住的事实写进记忆库（完整引擎管线：去重/演化/全文索引）。同一件事重复写请复用同一个 operationId。',
        parameters: {
            text: { type: 'string', required: true, description: '要记住的一句话事实' },
            operationId: { type: 'string', required: true, description: '本次写入的稳定标识（重放同一值不会产生第二条）' },
            project: { type: 'string', description: '项目名（可选）' },
            importance: { type: 'number', description: '重要度 0..1，默认 0.5' },
            tags: { type: 'string', description: '逗号分隔标签（可选）' },
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    action: { type: 'string', required: true },
                    id: { type: 'string' },
                    reason: { type: 'string' },
                },
                additionalProperties: false,
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: value.action === 'rejected'
                        ? `写入被拒绝：${value.reason ?? '未知原因'}`
                        : `已写入记忆 ${value.id ?? ''}（${value.action}）`,
                }],
        },
        timeoutMs: 180_000,
        async execute(args) {
            const result = await service.store({
                text: args.text,
                operationId: args.operationId,
                ...(args.project === undefined ? {} : { project: args.project }),
                ...(args.importance === undefined ? {} : { importance: args.importance }),
                ...(args.tags === undefined || args.tags === ''
                    ? {}
                    : { tags: args.tags.split(',').map(tag => tag.trim()).filter(tag => tag !== '') }),
            });
            return {
                action: result.action,
                ...(result.id === undefined ? {} : { id: result.id }),
                ...(result.reason === undefined ? {} : { reason: result.reason }),
            };
        },
    })));
    disposers.push(tools.register(defineTool({
        name: MEMORY_TOOL_NAMES.correct,
        description: '纠正一条记错的记忆：写入正确版本并把旧条目退役（引擎真指针 superseded_by）。只改你确认错的那条，不要用它整篇重写。',
        parameters: {
            id: { type: 'string', required: true, description: '要纠正的记忆 id（mem-xxxxxxxx）' },
            text: { type: 'string', required: true, description: '纠正后的正确事实' },
            operationId: { type: 'string', required: true, description: '本次纠正的稳定标识' },
            reason: { type: 'string', description: '为什么纠正（可选，写入审计）' },
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    id: { type: 'string', required: true },
                    supersededId: { type: 'string', required: true },
                    action: { type: 'string', required: true },
                },
                additionalProperties: false,
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: `已纠正：新条目 ${value.id} 取代旧条目 ${value.supersededId}`,
                }],
        },
        timeoutMs: 180_000,
        async execute(args) {
            const result = await service.correct({
                id: args.id,
                text: args.text,
                operationId: args.operationId,
                ...(args.reason === undefined ? {} : { reason: args.reason }),
            });
            return { id: result.id, supersededId: result.supersededId, action: result.action };
        },
    })));
    disposers.push(tools.register(defineTool({
        name: MEMORY_TOOL_NAMES.forget,
        description: '删除一条记忆。默认只预览将被删除的条目（零副作用）；确认后才真正退役归档。删除后不应再被召回。',
        parameters: {
            id: { type: 'string', required: true, description: '要删除的记忆 id' },
            confirmed: { type: 'boolean', description: 'true=执行删除；省略或 false=只预览' },
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    removed: { type: 'number', required: true },
                    confirmed: { type: 'boolean', required: true },
                    pending: { type: 'number' },
                    preview: { type: 'array', items: { type: 'string' } },
                    tombstoneRegistered: { type: 'boolean' },
                },
                additionalProperties: false,
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: value.confirmed
                        ? `已删除 ${value.removed} 条记忆${value.tombstoneRegistered === true ? '（已登记遗忘存根，不会被重放复活）' : ''}。`
                        : `尚未删除。将命中 ${value.pending ?? 0} 条：${(value.preview ?? []).join(', ') || '(无)'}。确认请再调用一次并传 confirmed=true。`,
                }],
        },
        timeoutMs: 180_000,
        async execute(args) {
            const result = await service.forget({
                id: args.id,
                confirmed: args.confirmed === true,
            });
            return {
                removed: result.removed,
                confirmed: args.confirmed === true,
                ...(result.pending === undefined ? {} : { pending: result.pending }),
                ...(result.preview === undefined ? {} : { preview: [...result.preview] }),
                ...(result.tombstoneRegistered === undefined ? {} : { tombstoneRegistered: result.tombstoneRegistered }),
            };
        },
    })));
    return () => { for (const dispose of disposers.splice(0))
        dispose(); };
}
