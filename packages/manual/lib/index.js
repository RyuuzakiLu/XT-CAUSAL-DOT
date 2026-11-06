/*
  dot-manual · DOT 用户手册

  ① 做什么：把 ../DOT-USER-MANUAL.md（面向用户的中文使用手册）接给 DOT。
     - 注册模型工具 dot_manual：按关键词或章节查手册，返回命中的小节原文。
     - 每轮 system prompt 注入一小段用法（只含章节目录，不含全文），告诉模型何时先查手册。
  ② 手册是 MD 文件，按修改时间重读：改手册不用重启 dot-agent；只有改本文件才需要重启。
  ③ 纯本地读文件，不联网、不读写账号数据，对所有账号一样。
  2026-10-27 Miles 新建（云端 DOT 第 7 件：用户手册）。
*/
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'

const MANUAL_FILE = process.env.DOT_MANUAL_FILE || fileURLToPath(new URL('../DOT-USER-MANUAL.md', import.meta.url))
const GUIDE_SECTION = 'dot-manual-guide'
const MAX_CHARS = 7000

export const name = 'dot-manual'
export const inject = ['tools']

let cache = { mtimeMs: -1, text: '', chunks: [], chapters: [] }

/** 把手册切成小节：每个 "## " 是一章；章内有 "### " 时再按小节切，小节标题带上章名。 */
export function parseManual(text) {
  const lines = text.split(/\r?\n/)
  const chapters = []
  let cur = null
  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+?)\s*$/)
    if (h2) { cur = { title: h2[1], lines: [] }; chapters.push(cur); continue }
    if (cur) cur.lines.push(line)
  }
  const chunks = []
  for (const ch of chapters) {
    const body = ch.lines.join('\n')
    const parts = body.split(/\n(?=###\s)/)
    const intro = parts[0].startsWith('### ') ? '' : parts.shift().trim()
    if (intro) chunks.push({ chapter: ch.title, title: ch.title, text: intro })
    for (const part of parts) {
      const m = part.match(/^###\s+(.+?)\s*\n([\s\S]*)$/)
      if (!m) continue
      chunks.push({ chapter: ch.title, title: `${ch.title} › ${m[1]}`, text: m[2].trim() })
    }
    ch.full = `## ${ch.title}\n\n${body.trim()}`
  }
  return { chunks, chapters }
}

function load() {
  try {
    const { mtimeMs } = statSync(MANUAL_FILE)
    if (mtimeMs !== cache.mtimeMs) {
      const text = readFileSync(MANUAL_FILE, 'utf8')
      cache = { mtimeMs, text, ...parseManual(text) }
    }
  } catch { /* 文件缺失时沿用上次内容 */ }
  return cache
}

/** 查询切词：英文/数字按词，中文按相邻两字（单字时取单字）。 */
export function tokenize(query) {
  const q = String(query || '').toLowerCase()
  const tokens = new Set()
  for (const w of q.match(/[a-z0-9][a-z0-9._-]*/g) || []) if (w.length >= 2) tokens.add(w)
  const STOP = new Set(['怎么', '如何', '什么', '可以', '能不', '不能', '一下', '我的', '你的', '在哪', '哪里', '为什', '没有', '一个', '是不', '不是', '这个', '那个'])
  for (const run of q.match(/[\u4e00-\u9fff]+/g) || []) {
    if (run.length === 1) { tokens.add(run); continue }
    for (let i = 0; i < run.length - 1; i++) { const bi = run.slice(i, i + 2); if (!STOP.has(bi)) tokens.add(bi) }
  }
  return [...tokens]
}

function count(hay, needle) {
  let n = 0, i = 0
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length }
  return n
}

export function search(manual, query, limit = 3) {
  const tokens = tokenize(query)
  if (!tokens.length) return []
  const scored = manual.chunks.map(chunk => {
    const title = chunk.title.toLowerCase(), text = chunk.text.toLowerCase()
    let score = 0, hit = 0
    for (const t of tokens) {
      const s = count(title, t) * 4 + Math.min(count(text, t), 4)
      if (s > 0) { hit++; score += s }
    }
    /* 命中的不同词越多越靠前；常见问题小节略微优先，它们是现成答案。 */
    score = score * (hit / tokens.length + 0.5) * (chunk.chapter.includes('常见问题') ? 1.15 : 1)
    return { chunk, score }
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map(x => x.chunk)
}

function findChapter(manual, section) {
  const s = String(section || '').trim()
  if (!s) return null
  const num = s.match(/^\d+/)?.[0]
  return manual.chapters.find(ch => (num && ch.title.startsWith(`${num}.`)) || ch.title.includes(s)) || null
}

function toc(manual) {
  return manual.chapters.map(ch => ch.title).join('\n')
}

function clip(text) {
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n……（内容较长已截断，可用更具体的 query 再查）` : text
}

export function answer(manual, args = {}) {
  if (!manual.chapters.length) return '用户手册暂时读不到。'
  const chapter = findChapter(manual, args.section)
  if (chapter) return clip(chapter.full)
  const query = String(args.query || '').trim()
  if (!query) return `《DOT 用户手册》章节目录：\n${toc(manual)}\n\n用 query 传关键词查具体内容，或用 section 传章节号读整章。`
  const hits = search(manual, query)
  if (!hits.length) return `手册里没找到和“${query}”相关的内容。章节目录：\n${toc(manual)}`
  return clip(hits.map(c => `### ${c.title}\n${c.text}`).join('\n\n'))
}

function guideText(manual) {
  if (!manual.chapters.length) return ''
  return [
    '【DOT 用户手册】你有一份《DOT 用户手册》，用 dot_manual 工具查。',
    '用户问到 DOT 本身怎么用时（注册、登录、退出、简洁版侧栏和按钮、会话搜索、图片和附件、日程与待办、消息、后台工作、通话、设置或账号），先调用 dot_manual（query 填问题里的关键词）查到再回答。',
    '按手册里的步骤和界面文字回答，用口语讲清楚路径；不要凭印象编按钮、路径或功能，手册里没写的就直说不确定。',
    '手册里的 ASTRA 是默认名，用户可能已经给你改了名；回答时用你现在的名字称呼自己。用户只是要你做事（比如记待办）时直接做，不必先查手册。',
    `章节：${manual.chapters.map(ch => ch.title).join(' / ')}`,
  ].join('\n')
}

const manualTool = defineTool({
  name: 'dot_manual',
  description: '查《DOT 用户手册》：用户问 DOT 本身怎么用（注册登录、简洁版导航、对话、记忆、日程、消息、后台工作、通话、设置、账号隐私）时先查这里。不传参数返回章节目录。',
  parameters: {
    query: { type: 'string', description: '要查的问题或关键词，例如“怎么改名”“免打扰”“忘记密码”' },
    section: { type: 'string', description: '可选：章节号或章节名，读整章，例如“13”或“后台工作”' },
  },
  output: {
    schema: {
      type: 'object',
      properties: { text: { type: 'string', required: true } },
      additionalProperties: false,
    },
    render: (_args, value) => [{ type: 'text', text: value.text }],
  },
  timeoutMs: 10_000,
  async execute(args) {
    return { text: answer(load(), args || {}) }
  },
})

export function apply(ctx) {
  ctx.effect(() => ctx.tools.register(manualTool), 'dot-manual: 手册工具注册')
  ctx.effect(() => ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const result = await next()
    try {
      const text = guideText(load())
      if (text !== '') {
        result.sections = result.sections.filter(item => item.name !== GUIDE_SECTION)
        result.sections.push({ name: GUIDE_SECTION, text })
      }
    } catch (error) {
      ctx.logger('dot-manual').warn('手册用法注入跳过：%s', error instanceof Error ? error.message : String(error))
    }
    return result
  }), 'dot-manual: 用法注入')
}
