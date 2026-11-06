/* ================================================================
   DOT 工作插件 · 持久域声明

   ▍这是什么
   ① 干什么：用 DSH 原生 `storage-domain` 声明 DOT 自己的持久域 `dot_work`，
      四张表：works（工作事实）/ artifacts（成果正文）/ plans（计划镜像）/ operations（幂等索引）。
   ② 技术栈：zod 记录 schema + `defineDomain`/`domainTable`；不碰任何存储后端 API。
   ③ 依赖：`@deepseek-ai/dsh-storage-domain`（域数据形式）与 `zod`。
      落哪个后端由部署配置决定（现在是 json），本包不选介质。
   ④ 给谁看：改记录字段的人（先改 schema 再改 types）、排查"重启后打不开域"的人。

   ▍结构
   标量 schema        —— 复用的时间/状态/ID 校验
   works/artifacts/plans/operations 四张表
   dotWorkDomain      —— 域声明本体（name/version/tables）

   ▍修改铁律
   1. 【不】让 schema 接受 `null`：域层用 `null` 当"从未写入"的哨兵，接受了就分不清缺席与空值。
   2. 改字段形状必须同时升 `version`，否则老记录会让整个域打开失败（官方规定行为是拒绝打开，
      不是静默丢弃）。升版要配一次显式迁移，不在这里偷偷补默认值。
   3. 【不】把成果正文塞进 works 表：查进度会变成搬附件；正文单独一张表按 id 读。
   4. 记录里【不】存 key 之外的重复身份：表 key 就是 workId/artifactId/scheduleId。

   ▍更新记录
   2026-10-23 · 建立：works/artifacts/plans/operations 四表与域声明。
   *更新：2026-10-28 · blocked.action 可选入口（kind/label/url/requestId），老记录仍合法，不升 version。
   ================================================================ */
import { z } from 'zod';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
/** 四位数年份的 ISO-8601 即时时间；拒绝 0000 前缀（与官方 schedule 的判定一致）。 */
const instant = z.iso.datetime({ precision: 3 }).refine(value => !value.startsWith('0000-'), {
    message: 'Expected a canonical four-digit-year ISO-8601 instant',
});
const workStatus = z.enum([
    'queued', 'running', 'waiting-input', 'waiting-approval',
    'succeeded', 'failed', 'cancelled', 'interrupted', 'unknown',
]);
const externalReach = z.enum(['none-observed', 'observed-may-have-happened']);
const stepSchema = z.object({
    index: z.number().int().min(1),
    label: z.string().min(1),
    status: z.enum(['pending', 'running', 'done', 'failed']),
    startedAt: instant.optional(),
    finishedAt: instant.optional(),
    error: z.string().optional(),
}).strict();
const artifactRefSchema = z.object({
    id: z.string().min(1),
    workId: z.string().min(1),
    kind: z.enum(['text', 'file']),
    title: z.string(),
    createdAt: instant,
    mimeType: z.string().optional(),
    byteLength: z.number().int().min(0).optional(),
    charLength: z.number().int().min(0).optional(),
}).strict();
/* 等用户处理时给一个可点入口（保密表单 / 第三方授权页）。
   ⚠️【不】往这里加任何密钥、令牌或请求头字段：这条记录会进快照、进界面、进模型上下文，
   秘密只能留在保密服务（scripts/dot-cloud-secret-broker.mjs）里。
   只加**可选**字段、不升 version：老记录没有 action 仍然合法，新记录才带。 */
const blockedActionSchema = z.object({
    kind: z.literal('open-url'),
    label: z.string().min(1),
    url: z.string().min(1),
    requestId: z.string().min(1).optional(),
}).strict();
const blockedSchema = z.object({
    kind: z.enum(['input', 'approval']),
    message: z.string().min(1),
    code: z.string().min(1),
    risk: z.string().optional(),
    action: blockedActionSchema.optional(),
}).strict();
/** 最近一次凭据续办的投递痕迹（R2）：重启后靠它区分"送没送到"。 */
const credentialResumeSchema = z.object({
    requestId: z.string().min(1),
    attempt: z.enum(['sending', 'sent', 'undelivered', 'unknown']),
    at: instant,
    error: z.string().optional(),
}).strict();
/** 一件工作的权威记录。缺字段即拒绝打开：宁可启动失败，也不要把"半条工作"当成事实喂给界面。 */
const workSchema = z.object({
    id: z.string().min(1),
    operationId: z.string().min(1),
    goal: z.string().min(1),
    title: z.string().min(1),
    status: workStatus,
    stage: z.string(),
    progress: z.number().min(0).max(1).optional(),
    origin: z.enum(['conversation', 'schedule', 'derived']),
    createdAt: instant,
    updatedAt: instant,
    revision: z.number().int().min(1),
    sessionId: z.string().min(1).optional(),
    steps: z.array(stepSchema),
    artifacts: z.array(artifactRefSchema),
    blocked: blockedSchema.optional(),
    credentialResume: credentialResumeSchema.optional(),
    error: z.string().optional(),
    queuedReason: z.string().optional(),
    followupOf: z.string().min(1).optional(),
    retryOf: z.string().min(1).optional(),
    planId: z.string().min(1).optional(),
    /** 云端：工作所属账号（DOT 云端补丁，见 cloud.ts）。 */
    owner: z.string().min(1).optional(),
    /** 云端：派活的前台会话，结果回到这里。 */
    originSessionId: z.string().min(1).optional(),
    /** 2026-10-31：观察到的工具名（被打断自动重做判据）。可选、不升 version，老记录照旧合法。 */
    toolsUsed: z.array(z.string().min(1)).optional(),
    /** 2026-10-31：请过用户确认/回答。可选、不升 version。 */
    askedUser: z.boolean().optional(),
    externalActions: externalReach,
}).strict().refine(record => record.status === 'failed' ? record.error !== undefined : record.error === undefined, {
    message: 'error must be present exactly when the work failed',
});
/** 成果正文。文字成果内联正文，文件成果只记路径——不进快照、不进模型上下文。 */
const artifactSchema = z.object({
    id: z.string().min(1),
    workId: z.string().min(1),
    kind: z.enum(['text', 'file']),
    title: z.string().min(1),
    createdAt: instant,
    mimeType: z.string().min(1),
    text: z.string().optional(),
    path: z.string().min(1).optional(),
    byteLength: z.number().int().min(0).optional(),
}).strict().refine(record => record.kind === 'text'
    ? record.text !== undefined && record.path === undefined
    : record.path !== undefined && record.text === undefined, {
    message: 'a text artifact carries text only; a file artifact carries a path only',
});
const timingSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('at'), at: instant }).strict(),
    z.object({ kind: z.literal('every'), everySeconds: z.number().int().min(60) }).strict(),
    z.object({ kind: z.literal('daily'), time: z.string().min(1), timeZone: z.string().min(1) }).strict(),
    z.object({
        kind: z.literal('weekly'), time: z.string().min(1), timeZone: z.string().min(1),
        weekdays: z.array(z.number().int().min(1).max(7)).min(1),
    }).strict(),
    z.object({
        kind: z.literal('cron'), expression: z.string().min(1), timeZone: z.string().min(1),
    }).strict(),
]);
/** DOT 计划记录：原生 schedule 的镜像 + 本插件持有的暂停态。 */
const planSchema = z.object({
    planId: z.string().min(1),
    scheduleId: z.string().min(1),
    title: z.string().min(1),
    goal: z.string().min(1),
    timing: timingSchema,
    paused: z.boolean(),
    cancelled: z.boolean(),
    sessionId: z.string().min(1).optional(),
    lastWorkId: z.string().min(1).optional(),
    createdAt: instant,
    updatedAt: instant,
    revision: z.number().int().min(1),
}).strict();
/** 幂等索引：operationId 只能指向一个结果，重复提交据此返回同一份事实。 */
const operationSchema = z.object({
    operationId: z.string().min(1),
    kind: z.enum(['create', 'retry', 'supplement', 'plan-create', 'plan-update', 'plan-pause', 'plan-cancel']),
    target: z.string().min(1),
    createdAt: instant,
}).strict();
/** 工作域：四张表，单一版本。任何一条记录不合 schema 都会拒绝整个域的打开（官方行为）。 */
export const dotWorkDomain = defineDomain({
    name: 'dot_work',
    version: 1,
    tables: {
        // ⚠️ 这里的 `as never` 是**已知的边界转换**，不是偷懒：仓库里同时存在两份 zod
        // （storage-domain 依赖 4.4.3，本包当前链接到 4.6.7），两份 zod 的 ZodType 在类型上
        // 互不兼容，但运行时行为一致。等装配侧统一 zod 版本后应删掉这层转换，恢复直接传 schema。
        works: domainTable(workSchema),
        artifacts: domainTable(artifactSchema),
        plans: domainTable(planSchema),
        operations: domainTable(operationSchema),
    },
});
