import { ContextBudget } from "./context-page.js";
/* ================================================================
   DOT 工作插件 · 模型可见工具

   ▍这是什么
   ① 干什么：给 ASTRA 四个工具——登记工作、查询进度、补充说明、取消/重试。
      工具与界面调**同一个** DotWorkService，不各写一套规则。
   ② 技术栈：`defineTool` + 原生 `ctx.tools.register`；输出按官方 schema/render 给。
   ③ 依赖：ctx.tools（注册表）与 dotWork（本包服务）。作用域由挂载它的 preset 决定。
   ④ 给谁看：改工具措辞的人（模型行为受描述影响）、加工具的人（照着这个形状加）。

   ▍结构
   WORK_TOOLS            —— 工具定义数组（名字/描述/schema/执行）
   registerWorkTools()   —— 在 apply 里注册并返回 disposer

   ▍修改铁律
   1. 【不】在工具里复制业务规则：只做参数校验并转调服务；服务才是事实所有者。
   2. 【不】把"已登记"说成"已完成"：工具结果必须如实带 status/stage。
   3. operationId 由模型生成；重发同一 operationId【不】新建第二件工作（服务侧保证）。
   4. 【不】在工具结果里塞成果正文：正文按需另取，否则每次查进度都在搬附件。

   ▍更新记录
   2026-10-23 · 建立：work_create / work_query / work_supplement / work_cancel 四个工具。
   ================================================================ */
import { randomUUID } from 'node:crypto';
import { defineTool } from '@deepseek-ai/dsh-tools';
/**
 * 把工具输出快照压成模型能读懂的一行摘要（不夹带正文）。
 * ⚠️ 入参必须是 {@link ProjectedSnapshot}——即 render 真正拿到的东西。
 * 曾经写成 WorkSnapshot 再双重 cast，结果 `artifacts.length` 在运行时是 undefined，
 * 工具一成功 render 就抛 TypeError；这类"用 cast 掩盖形状不一致"是必须避免的。
 * @param work - 工具输出里的快照投影
 * @returns 一行摘要
 */
function summarize(work) {
    const parts = [
        `id=${work.id}`,
        `status=${work.status}`,
        `stage=${work.stage}`,
        `goal=${process.env.DOT_WORK_CONTEXT_READ === '1' ? work.goal.slice(0, 200) : work.goal}`,
    ];
    if (work.step !== undefined)
        parts.push(`step=${work.step.current}/${work.step.total} ${work.step.label}`);
    if (work.progress !== undefined)
        parts.push(`progress=${Math.round(work.progress * 100)}%`);
    if (work.blocked !== undefined)
        parts.push(`blocked=${work.blocked.message}`);
    if (work.blocked?.action !== undefined)
        parts.push(`entry=${work.blocked.action.label} ${work.blocked.action.url}`);
    if (work.error !== undefined)
        parts.push(`error=${work.error}`);
    parts.push(`artifacts=${work.artifactIds.length}`);
    if (work.artifactIds.length > 0)
        parts.push(`artifactIds=${work.artifactIds.join(',')}`);
    if (process.env.DOT_WORK_CONTEXT_READ === '1')
        parts.push('readRef=work/' + work.id);
    return parts.join(' ');
}
/** 工具输出 schema 复用的快照字段（只暴露模型需要判断的部分）。 */
const SNAPSHOT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        id: { type: 'string', required: true },
        goal: { type: 'string', required: true },
        status: { type: 'string', required: true },
        stage: { type: 'string', required: true },
        progress: { type: 'number' },
        step: {
            type: 'object',
            additionalProperties: false,
            properties: {
                current: { type: 'number', required: true },
                total: { type: 'number', required: true },
                label: { type: 'string', required: true },
            },
        },
        updatedAt: { type: 'string', required: true },
        blocked: {
            type: 'object',
            additionalProperties: false,
            properties: {
                kind: { type: 'string', required: true },
                message: { type: 'string', required: true },
                code: { type: 'string', required: true },
                /* 等你处理时的可点入口：给用户本人浏览器打开，不含任何秘密。 */
                action: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        kind: { type: 'string', required: true },
                        label: { type: 'string', required: true },
                        url: { type: 'string', required: true },
                        requestId: { type: 'string' },
                    },
                },
            },
        },
        error: { type: 'string' },
        artifactIds: { type: 'array', required: true, items: { type: 'string' } },
    },
};
/** 从真实步骤推“当前第几步”：在跑的 > 失败的 > 已完成数 + 1。 */
function currentStep(snapshot) {
    const steps = snapshot.steps;
    if (steps.length === 0)
        return undefined;
    const total = steps.length;
    let at = steps.findIndex(step => step.status === 'running');
    if (at < 0)
        at = steps.findIndex(step => step.status === 'failed');
    if (at < 0) {
        const done = steps.filter(step => step.status === 'done').length;
        at = Math.min(total - 1, snapshot.status === 'succeeded' ? total - 1 : done);
    }
    return { current: at + 1, total, label: steps[at].label };
}
/** 把快照投影成工具输出（与 {@link SNAPSHOT_SCHEMA} 对齐）。 */
function projectSnapshot(snapshot) {
    return {
        id: snapshot.id,
        goal: snapshot.goal,
        status: snapshot.status,
        stage: snapshot.stage,
        updatedAt: snapshot.updatedAt,
        artifactIds: snapshot.artifacts.map(artifact => artifact.id),
        ...(snapshot.progress === undefined ? {} : { progress: snapshot.progress }),
        ...(currentStep(snapshot) === undefined ? {} : { step: currentStep(snapshot) }),
        ...(snapshot.blocked === undefined
            ? {}
            : { blocked: {
                    kind: snapshot.blocked.kind,
                    message: snapshot.blocked.message,
                    code: snapshot.blocked.code,
                    /* 入口原样带出：模型需要知道"用户还有个入口可以去点"，界面也据此画按钮。 */
                    ...(snapshot.blocked.action === undefined ? {} : { action: { ...snapshot.blocked.action } }),
                } }),
        ...(snapshot.error === undefined ? {} : { error: snapshot.error }),
    };
}
/**
 * 工具结果的**机器可读**标记：给 UI 开临时卡用，不靠解析中文正文。
 * 为什么必须单独给：原生 `tool/result.meta` 会随会话日志持久化，界面在重放时也能读到；
 * 如果界面从中文 text 里正则抠 workId，文案一改就全断。
 * ⚠️ 只放**引用 + 画卡必需的最小字段**（id/status/stage/是否有可靠进度/更新时间），
 * 不放正文、不放步骤明细——那些仍由 `dotWork.get` / `dotWork.artifacts` 按需取，
 * 否则每次问进度都在会话日志里塞一整份快照。
 * @param kind - 这张卡该渲染成什么
 * @param works - 涉及工作的画卡字段
 * @returns 可无损持久化的 JSON 值
 */
function cardMeta(kind, works, candidates = []) {
    return {
        dot: 'work',
        kind,
        works: works.map(cardRow),
        // 有歧义时的候选：对话里画成一组可点的小条，模型同时反问用户是哪一项。
        ...(candidates.length ? { candidates: candidates.map(cardRow) } : {}),
    };
}
/** 一行画卡字段。goal 截到 60 字，只作卡片标题（重放旧会话时全量快照可能已经不在）。 */
function cardRow(work) {
    const row = { workId: work.id, status: work.status };
    if (work.goal !== undefined)
        row['goal'] = [...work.goal].length > 60 ? `${[...work.goal].slice(0, 59).join('')}…` : work.goal;
    if (work.stage !== undefined)
        row['stage'] = work.stage;
    if (work.updatedAt !== undefined)
        row['updatedAt'] = work.updatedAt;
    // progress 只在**有可靠依据**时才出现；缺省意味着"算不出百分比"，
    // 界面必须显示 stage 文字，不能画成 0%。
    if (work.progress !== undefined)
        row['progress'] = work.progress;
    if (work.artifactIds !== undefined)
        row['artifactCount'] = work.artifactIds.length;
    return row;
}
/* feishu-group-boundary-2026-11-03：飞书群里非主人不能派、改、停后台工作（硬锁，不靠提示词）。
   发言人行「〔群成员：…，本群主人|只读成员〕」由飞书桥按发送者 open_id 写入；桥会把正文里的〔〕换成【】，所以正文伪造不了这一行。
   私聊、网页没有这一行，照常放行。 */
const GROUP_SPEAKER = /^〔群成员：[^〔〕\n]*，(本群主人|只读成员)〕$/m;
/** 本轮是不是飞书群里只读成员发的。 */
export function feishuGroupGuestTurn(exec) {
    const session = exec?.agent?.session;
    const events = typeof session?.snapshotEvents === 'function' ? session.snapshotEvents() : undefined;
    if (!Array.isArray(events))
        return false;
    const event = events.findLast((e) => e?.type === 'user/message' && e?.data?.source?.kind === 'user');
    const blocks = event?.data?.content;
    if (!Array.isArray(blocks))
        return false;
    const text = blocks.filter((p) => p?.type === 'text' && typeof p.text === 'string').map((p) => p.text).join('');
    if (!text.startsWith('〔飞书〕'))
        return false;
    return GROUP_SPEAKER.exec(text)?.[1] === '只读成员';
}
/* 用户 2026-11-03：群里非主人只能派两类后台活——查资料、审计代码（只读）。 */
export const GUEST_WORK_SCOPES = ['research', 'code-audit'];
const GUEST_SCOPE_NOTE = {
    research: '查资料：联网搜索、调研、核实信息',
    'code-audit': '审计代码：只读，只指出问题和给建议',
};
/** 只读成员派活：scope 必须是两类之一；goal 前面钉上只读约束，交给后台 worker。 */
export function guestWorkGoal(goal, scope) {
    if (!scope || !GUEST_WORK_SCOPES.includes(scope))
        throw new Error('feishu-group-readonly：群里非主人只能派「查资料」(scope=research) 或「审计代码」(scope=code-audit) 两类后台活，其余请礼貌告诉对方去找主人。');
    return `〔飞书群只读成员委托，仅限${GUEST_SCOPE_NOTE[scope]}。不得改写任何文件、不写记忆或待办、不改配置、不对外发消息、不动账号、不花钱；不得在结果里写服务器路径、密钥、内网地址或主人的私人信息。〕\n${goal}`;
}
function assertNotGroupGuest(exec) {
    if (feishuGroupGuestTurn(exec))
        throw new Error('feishu-group-readonly：飞书群里只有本群主人能派、改、停后台工作。请礼貌告诉对方这件事要找主人。');
}
/**
 * 注册 DOT 工作工具。
 * @param ctx - 挂载作用域（preset 决定哪些 Agent 拿到这些工具）
 * @param work - 本包业务服务
 * @returns 注册 disposer（由 ctx.tools 自带，无需手管）
 */
export function registerWorkTools(ctx, work) {
    const routeEnabled = process.env.DOT_WORK_ROUTE === '1' && process.env.DOT_WORK_SHADOW === '1' &&
        process.env.DOT_WORK_INPUT_REPLAY === '1' && process.env.DOT_ROLE !== 'worker';
    const adjustmentHint = routeEnabled ? ' For a change to an existing job or delivered result, use work_route_adjustment with the user’s latest message verbatim.' : '';
    if (routeEnabled) {
        ctx.tools.register(defineTool({
            name: 'work_route_adjustment',
            description: 'When the user asks to change existing work, submit their latest message verbatim. An accepted input is durable. When the result displays selectable candidates, the checkbox handles the answer. End this turn and let the user pick in the card.',
            parameters: { sourceText: { type: 'string', required: true } },
            output: {
                schema: { type: 'object', additionalProperties: false, properties: {
                        action: { type: 'string', required: true }, inputId: { type: 'string' }, targetId: { type: 'string' },
                        choices: { type: 'array', items: { type: 'string' } },
                        candidates: { type: 'array', required: true, items: SNAPSHOT_SCHEMA },
                    } },
                render: (_args, value) => {
                    let text;
                    switch (value.action) {
                        case 'accepted':
                            text = '调整已受理。目标工单：' + value.targetId;
                            break;
                        case 'clarify':
                            if (value.choices?.some(Boolean)) {
                                text = '候选卡已显示，用户直接勾选即可。结束本轮；此选择由卡片处理，无需调用问答工具。';
                                break;
                            }
                            text = value.candidates.length
                                ? '有几项工作都可能符合，请确认指的是哪一项：' + value.candidates.map(w => w.goal.slice(0, 100)).join('、')
                                : '还无法确定指的是哪项工作，请确认工作名称。';
                            break;
                        case 'existing-interaction':
                            text = '这项工作已有待处理入口，请打开原工作卡：' + value.targetId;
                            break;
                        case 'retry':
                            text = '这项工作可以重试，请沿用原重试入口：' + value.targetId;
                            break;
                        default: text = '这是一个新主题，可以按普通新工单处理。';
                    }
                    return [{ type: 'text', text }];
                },
                presentationMeta: (_args, value) => value.candidates.length ? {
                    ...cardMeta('work-candidates', [], value.candidates), choices: value.choices ?? [],
                } : null,
            },
            async execute(args, exec) {
                assertNotGroupGuest(exec);
                const result = await work.routeLatestAdjustment(String(exec.agent?.id ?? ''), args.sourceText);
                return { ...result, candidates: result.candidates.map(projectSnapshot) };
            },
        }));
    }
    if (process.env.DOT_WORK_CONTEXT_READ === '1') {
        const budget = new ContextBudget();
        ctx.tools.register(defineTool({
            name: 'work_context_read',
            description: 'Read a work summary, goal, steps, result or lineage, session/<id>/summary or memory/<id>. Continue from nextOffset using the returned revision.',
            parameters: {
                resource: { type: 'string', required: true, description: 'Use work/<workId>/result for the full delivered text, or /goal, /steps, /lineage.' }, revision: { type: 'string' },
                offset: { type: 'number' }, limit: { type: 'number' },
            },
            output: { schema: { type: 'object', additionalProperties: false, properties: { page: { type: 'string', required: true } } },
                render: (_args, value) => [{ type: 'text', text: value.page }] },
            async execute(args, exec) {
                const agent = exec.agent;
                const turn = agent?.session.snapshotEvents().findLast(event => event.type === 'turn/start')?.seq;
                if (!agent || turn === undefined)
                    throw new Error('no-active-turn');
                const page = await work.readWorkContext(String(agent.id), args);
                budget.charge(agent, turn, page.text.length);
                return { page: JSON.stringify(page) };
            },
        }));
    }
    if (process.env.DOT_WORK_SHADOW === '1' && process.env.DOT_ROLE !== 'worker') {
        ctx.tools.register(defineTool({
            name: 'work_resolve',
            description: 'Preview which work item a message could refer to. This only returns a suggestion.',
            parameters: {
                text: { type: 'string', required: true },
                sourceMessageId: { type: 'string', required: true },
                explicitWorkId: { type: 'string' },
                interactionRef: { type: 'string' },
            },
            output: {
                schema: { type: 'object', additionalProperties: false, properties: { preview: { type: 'string', required: true } } },
                render: (_args, result) => [{ type: 'text', text: result.preview }],
            },
            async execute(args, exec) {
                const preview = await work.resolveFromTool({
                    text: args.text, sourceSessionRef: String(exec.agent?.id ?? ''), sourceMessageId: args.sourceMessageId,
                    ...(args.explicitWorkId ? { explicitWorkId: args.explicitWorkId } : {}),
                    ...(args.interactionRef ? { interactionRef: args.interactionRef } : {}),
                });
                return { preview };
            },
        }));
    }
    ctx.tools.register(defineTool({
        name: 'work_create',
        description: 'Register one background job for the user and start it in its own Session. '
            + 'Use it when the user asks for something that takes a while and they should be able to keep chatting. '
            + 'Return the stable work id immediately; the job runs in the background and you can query it later. '
            + 'Reuse the same operationId when retrying a submission so the same request never creates two jobs.' + adjustmentHint,
        parameters: {
            goal: { type: 'string', required: true, description: 'What the user wants done, in their own words.' },
            operationId: { type: 'string', required: true, description: 'Idempotency key; the same value never creates a second job.' },
            title: { type: 'string', description: 'Optional short title for cards and lists.' },
            scope: { type: 'string', enum: [...GUEST_WORK_SCOPES], description: 'Only for a Feishu group read-only member: research or code-audit. Leave empty otherwise.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    created: { type: 'boolean', required: true },
                    work: { ...SNAPSHOT_SCHEMA, required: true },
                },
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: value.created
                        ? `已登记工作：${summarize(value.work)}`
                        : `这件工作之前已经登记过（同一 operationId），没有重复创建：${summarize(value.work)}`,
                }],
            // 登记成功 → 界面可以浮一张"已开始"的临时卡（引用型，不复制记录）。
            presentationMeta: (_args, value) => cardMeta('work-created', [value.work]),
        },
        async execute(args, exec) {
            const goal = feishuGroupGuestTurn(exec) ? guestWorkGoal(args.goal, args.scope) : args.goal;
            const value = await work.create({
                goal,
                operationId: args.operationId,
                // DOT 云端：记下派活的前台会话，结果回到这里。
                ...(typeof exec?.agent?.id === 'string' ? { originSessionId: exec.agent.id } : {}),
                ...(args.title === undefined ? {} : { title: args.title }),
            });
            return { created: value.created, work: projectSnapshot(value.work) };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'work_query',
        description: 'Read the current snapshot of one background job and show its live progress card in the chat. '
            + 'Use it whenever the user asks how something is going, even mid-conversation ("那个进度怎么样了"). '
            + 'Pass workId when you know which job is meant (for example from work_create earlier in this chat). '
            + 'Otherwise pass match with the words the user used to describe the job; with neither, the only running job '
            + 'is returned, or the most recent one when nothing is running. If the result lists candidates instead of a job, '
            + 'the request is ambiguous: ask the user which one they mean and query again with that workId; never guess. '
            + 'After a result, tell the user in one sentence where the job is (step, stage, what it waits for). '
            + 'A job that has no reliable percentage reports its stage text instead; do not invent a number.' + adjustmentHint,
        parameters: {
            workId: { type: 'string', description: 'Stable work id from work_create or an earlier query.' },
            match: { type: 'string', description: 'Words from the user describing which job, e.g. "季度报表". Ignored when workId is given.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    works: { type: 'array', required: true, items: SNAPSHOT_SCHEMA },
                    candidates: { type: 'array', items: SNAPSHOT_SCHEMA },
                },
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: value.works.length === 0 && value.candidates !== undefined && value.candidates.length > 0
                        ? `有 ${value.candidates.length} 项工作都可能是用户说的那一项，请先问用户指的是哪一项，再用 workId 查询：\n`
                            + value.candidates.map(summarize).join('\n')
                        : value.works.length === 0
                            ? '目前没有任何工作记录。'
                            : value.works.map(summarize).join('\n'),
                }],
            // ⚠️ F07 唯一握手点：UI 监听前台会话 tool/result，只对
            // `meta.dot === 'work' && meta.kind === 'work-progress'` 的结果浮临时卡；
            // 按 `meta.works[].workId` 走 dotWork.get + follow 取最新事实，不解析中文、不写 chat node。
            // 有歧义时改标 work-candidates：老的浮卡监听只认 work-progress，不会误弹；
            // 对话里的工具视图把候选画成可点的小条。
            presentationMeta: (_args, value) => value.works.length === 0 && value.candidates !== undefined && value.candidates.length > 0
                ? cardMeta('work-candidates', [], value.candidates)
                : cardMeta('work-progress', value.works),
        },
        async execute(args) {
            if (args.workId !== undefined && args.workId !== '') {
                const works = await work.queryFromTool(args.workId);
                return { works: works.map(projectSnapshot) };
            }
            const picked = await work.pickFromTool(args.match);
            return {
                works: picked.works.map(projectSnapshot),
                ...(picked.candidates.length ? { candidates: picked.candidates.map(projectSnapshot) } : {}),
            };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'work_supplement',
        description: 'Send one extra instruction or answer into a running job\'s own Session. '
            + 'Use it to answer a blocked question or to refine a job that is still running; it cannot revive a finished job.' + adjustmentHint,
        parameters: {
            workId: { type: 'string', required: true, description: 'The job to supplement.' },
            text: { type: 'string', required: true, description: 'The instruction or answer to send.' },
            operationId: { type: 'string', description: 'Idempotency key; omit to allow one deliberate resend.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    candidates: { type: 'array', items: SNAPSHOT_SCHEMA },
                    choices: { type: 'array', items: { type: 'string' } },
                    accepted: { type: 'boolean', required: true },
                    work: { ...SNAPSHOT_SCHEMA, required: true },
                },
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: value.accepted ? `补充说明已受理：${summarize(value.work)}` : value.choices?.some(Boolean) ? '候选卡已显示，等用户点选即可。结束本轮，无需问答工具。' : '请先确认要调整的是哪项工作。',
                }],
            presentationMeta: (_args, value) => value.candidates?.length ? {
                ...cardMeta('work-candidates', [], value.candidates), choices: value.choices ?? [],
            } : cardMeta('work-progress', [value.work]),
        },
        async execute(args, exec) {
            assertNotGroupGuest(exec);
            if (routeEnabled) {
                const current = await work.get({ workId: args.workId });
                if (current.work.status === 'running' || current.work.status === 'succeeded') {
                    const route = await work.routeLatestAdjustment(String(exec.agent?.id ?? ''), undefined, args.workId);
                    return { accepted: route.action === 'accepted', work: projectSnapshot(current.work),
                        candidates: route.candidates.map(projectSnapshot), ...(route.choices ? { choices: route.choices } : {}) };
                }
            }
            const value = await work.supplement({
                workId: args.workId,
                text: args.text,
                operationId: args.operationId ?? `supplement-${randomUUID()}`,
            });
            return { accepted: value.accepted, work: projectSnapshot(value.work) };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'work_cancel',
        description: 'Stop a running job, or retry a job that ended without success. '
            + 'Cancelling stops new actions only: anything already done externally cannot be undone, and the result says so. '
            + 'Retrying creates a NEW job that points back at the old one; it never rewrites the old record.',
        parameters: {
            workId: { type: 'string', required: true, description: 'The job to cancel or retry.' },
            action: {
                type: 'string', required: true, enum: ['cancel', 'retry'],
                description: 'cancel stops it; retry starts a fresh job from a failed/interrupted/cancelled record.',
            },
            operationId: { type: 'string', description: 'Idempotency key, required for retry.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    work: { ...SNAPSHOT_SCHEMA, required: true },
                    stoppedNewActions: { type: 'boolean' },
                    externalActions: { type: 'string' },
                    retried: { type: 'boolean' },
                },
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: value.retried === true
                        ? `已重试，新的工作：${summarize(value.work)}`
                        : `取消结果：${summarize(value.work)}`
                            + (value.externalActions === 'observed-may-have-happened'
                                ? '（注意：已经发生过外部动作，撤不回来）'
                                : '（没有观察到外部动作）'),
                }],
            presentationMeta: (_args, value) => cardMeta(value.retried === true ? 'work-created' : 'work-cancelled', [value.work]),
        },
        async execute(args, exec) {
            assertNotGroupGuest(exec);
            if (args.action === 'retry') {
                const value = await work.retry({
                    workId: args.workId,
                    operationId: args.operationId ?? `retry-${randomUUID()}`,
                });
                return { work: projectSnapshot(value.work), retried: true };
            }
            const value = await work.cancel({ workId: args.workId });
            const detail = await work.get({ workId: args.workId });
            return {
                work: projectSnapshot(detail.work),
                stoppedNewActions: value.stoppedNewActions,
                externalActions: value.externalActions,
                retried: false,
            };
        },
    }));
}
