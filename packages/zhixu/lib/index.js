/* ================================================================
   DOT · 知序事务工具 · 总导游图

   ▍这是什么
   ① 干什么：把用户的待办、日程、提醒交给云端知序，模型通过这 8 个工具读写。
   ② 技术栈：纯 ESM，无构建步骤；只发本机 HTTP。
   ③ 依赖：@deepseek-ai/dsh-tools 的 defineTool；知序本身不在这里。
   ④ 给谁看：云端 ASTRA 预设、排障与验收。

   ▍结构
   身份读取 → 工具定义表 → HTTP 调用 → 注册 8 个工具

   ▍修改铁律
   1. 【不】给参数加 actor/userId：账号只能从 ALS 工牌取，模型传不了。
   2. 【不】在这里存长期记忆；记忆走 XTMEM，待办走知序，两边不互相代写。
   3. 服务不可达要报明确错误，【不】回空列表冒充"没有待办"。

   ▍更新记录
   *更新：2026-10-27 · 新建：把 DOT 事务接到云端知序（按账号分库）。
   *更新：2026-10-27 · 每轮把 ZHIXU-GUIDE.md（知序使用规范）注入系统提示；进度更新写法写进工具说明。
   ================================================================ */
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { feishuTools } from './feishu.js' // feishu-2026-10-27：飞书绑定工具
import { callZhixu } from './client.js'

/* 知序使用规范：跟 AGENTS.md 一样是一份 MD 文件，每轮按修改时间重读，改了不用重启。 */
const GUIDE_FILE = fileURLToPath(new URL('../ZHIXU-GUIDE.md', import.meta.url))
const GUIDE_SECTION = 'dot-zhixu-guide'
let guideCache = { mtimeMs: -1, text: '' }
function guideText() {
  try {
    const { mtimeMs } = statSync(GUIDE_FILE)
    if (mtimeMs !== guideCache.mtimeMs) guideCache = { mtimeMs, text: readFileSync(GUIDE_FILE, 'utf8').trim() }
  } catch { /* 文件缺失时沿用上次内容；从未读到则不注入 */ }
  return guideCache.text
}

export const name = 'dot-zhixu'
export const inject = ['tools']

/** 统一包装：成功给出结构化数据，界面与模型看到同一份事实。 */
function defineZhixuTool(spec) {
  return defineTool({
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    output: {
      schema: {
        type: 'object',
        properties: { data: { type: 'object', required: true, additionalProperties: true } },
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value.data) }],
    },
    timeoutMs: 30_000,
    async execute(args) {
      return { data: await callZhixu(spec.name, args) }
    },
  })
}

const str = description => ({ type: 'string', description })
const num = description => ({ type: 'number', description })

/* 参数表与知序对外契约一一对应；服务端仍会再校验一次。 */
const TOOLS = [
  defineZhixuTool({
    name: 'zhixu_list_tasks',
    description: '查本人的待办清单（可按状态、日期、关键词筛选）。问"我还有什么事没做"时用它，不查长期记忆。',
    parameters: {
      query: str('关键词，可选'),
      statuses: { type: 'array', description: '状态筛选：pending/in_progress/done/canceled，可选' },
      dateFrom: str('起始日期 YYYY-MM-DD，可选'),
      dateTo: str('结束日期 YYYY-MM-DD，可选'),
      timeZone: str('IANA 时区，可选，默认本人所在时区'),
      limit: num('返回条数，可选'),
      cursor: str('翻页游标，可选'),
    },
  }),
  defineZhixuTool({
    name: 'zhixu_today_agenda',
    description: '查本人今天的待办和日程，用来回答"今天要做什么"。',
    parameters: { timeZone: str('IANA 时区，可选') },
  }),
  defineZhixuTool({
    name: 'zhixu_get_record',
    description: '按编号读取本人某条待办或日程的最新版本；修改前必须先读，拿到 expectedVersion。',
    parameters: {
      kind: { type: 'string', required: true, description: 'record 类型：task 或 event' },
      id: { type: 'string', required: true, description: '记录编号' },
    },
  }),
  defineZhixuTool({
    name: 'zhixu_create_task',
    description: '把用户要做的事、待办、提醒登记到知序（用户待办只记这里，不用 todo_write、不写长期记忆）。成功后星邮匣会自动同步一封信。用户只是随口说过的事实不要写这里。',
    parameters: {
      title: { type: 'string', required: true, description: '待办标题' },
      operationId: { type: 'string', required: true, description: '本次写入稳定标识，重试复用同一个值' },
      dueAt: str('截止时间，选填：只有用户明确说了截止才填，带时区偏移的 ISO 8601；没说就不填，不要编时间'),
      remindAt: str('提醒时间，带时区偏移的 ISO 8601，必须在将来；用户要提醒时必填，不要提醒就不填'),
      repeat: str('重复：none/daily/weekly，可选'),
      priority: str('优先级：normal/important，可选'),
      timeZone: str('IANA 时区，可选'),
      description: str('补充说明，可选'),
    },
  }),
  defineZhixuTool({
    name: 'zhixu_update_task',
    description: '更新本人待办的进度：开始做(in_progress)、完成(done)、取消(canceled)、改时间或追加进展。必须带最新 expectedVersion，冲突时先重新读取，不覆盖。追加进展时保留原 description，在末尾新起一行“MM-DD HH:mm 进展：……”。成功后星邮匣会自动同步一封信。',
    parameters: {
      id: { type: 'string', required: true, description: '待办编号' },
      expectedVersion: { type: 'number', required: true, description: '当前版本号' },
      operationId: { type: 'string', required: true, description: '本次修改稳定标识' },
      title: str('新标题，可选'),
      dueAt: str('新截止时间，可选；空串表示去掉截止时间'),
      remindAt: str('新提醒时间，可选；空串表示取消提醒'),
      repeat: str('新重复规则，可选'),
      priority: str('新优先级，可选'),
      timeZone: str('IANA 时区，可选'),
      description: str('新说明，可选；追加进展时传“原说明 + 换行 + 新进展行”的完整文本'),
      status: str('新状态：pending/in_progress/done/canceled，可选'),
    },
  }),
  defineZhixuTool({
    name: 'zhixu_list_events',
    description: '查本人在指定时间范围内的日程。',
    parameters: {
      from: { type: 'string', required: true, description: '起始时间，带时区偏移' },
      to: { type: 'string', required: true, description: '结束时间，带时区偏移' },
      timeZone: str('IANA 时区，可选'),
      includeCanceled: { type: 'boolean', description: '是否包含已取消，可选' },
      limit: num('返回条数，可选'),
      cursor: str('翻页游标，可选'),
    },
  }),
  defineZhixuTool({
    name: 'zhixu_create_event',
    description: '登记本人的日程安排，起止时间必须带时区偏移。',
    parameters: {
      title: { type: 'string', required: true, description: '日程标题' },
      start: { type: 'string', required: true, description: '开始时间，带时区偏移' },
      end: { type: 'string', required: true, description: '结束时间，带时区偏移' },
      operationId: { type: 'string', required: true, description: '本次写入稳定标识' },
      location: str('地点，可选'),
      timeZone: str('IANA 时区，可选'),
      reminderOffsetMinutes: num('提前多少分钟提醒，可选'),
      overlapPolicy: str('与已有日程重叠时的处理策略，可选'),
    },
  }),
  defineZhixuTool({
    name: 'zhixu_update_event',
    description: '修改或取消本人日程；必须带最新 expectedVersion。',
    parameters: {
      id: { type: 'string', required: true, description: '日程编号' },
      expectedVersion: { type: 'number', required: true, description: '当前版本号' },
      operationId: { type: 'string', required: true, description: '本次修改稳定标识' },
      title: str('新标题，可选'),
      start: str('新开始时间，可选'),
      end: str('新结束时间，可选'),
      location: str('新地点，可选'),
      timeZone: str('IANA 时区，可选'),
      reminderOffsetMinutes: num('新的提前提醒分钟数，可选'),
      overlapPolicy: str('重叠策略，可选'),
      status: str('日程状态：取消传 canceled，恢复传 scheduled；改期不填。'),
      expectedReminderVersion: num('关联提醒的版本号，可选'),
    },
  }),
]

/**
 * 注册知序工具。云端按账号分库，本机没有配置时不注册，避免模型误以为可以登记待办。
 * @param ctx - Host 上下文
 */
export function apply(ctx, config = {}) {
  if (!process.env.DOT_ZHIXU_URL) {
    ctx.logger('dot-zhixu').info('未配置 DOT_ZHIXU_URL，本轮不注册知序事务工具')
    return
  }
  ctx.effect(() => {
    const disposers = [...TOOLS, ...feishuTools()].map(tool => ctx.tools.register(tool))
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'dot-zhixu: 事务工具注册')
  // split-2026-10-27：规范改走 zhixu skill，默认不再每轮注入 ZHIXU-GUIDE.md；配置 injectGuide: true 可恢复。
  if (config?.injectGuide === true) ctx.effect(() => ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const result = await next()
    try {
      const text = guideText()
      if (text !== '') {
        result.sections = result.sections.filter(item => item.name !== GUIDE_SECTION)
        result.sections.push({ name: GUIDE_SECTION, text })
      }
    } catch (error) {
      ctx.logger('dot-zhixu').warn('知序使用规范注入跳过：%s', error instanceof Error ? error.message : String(error))
    }
    return result
  }), 'dot-zhixu: 使用规范注入')
}
