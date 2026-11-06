/* ================================================================
   飞书绑定工具（2026-10-27）

   对方在飞书给 XTCAUSAL DOT 机器人发第一句话，会拿到一个 6 位绑定码；
   回到 DOT 对 ASTRA 说“绑定飞书 123456”，ASTRA 调 feishu_bind 把码交给本机飞书服务
   （127.0.0.1:3925 /internal/claim），飞书服务把这个飞书账号和当前 DOT 账号绑在一起。
   账号只认运行时上下文里的登录账号（currentActor），模型不能指定别的账号。
   未配置 DOT_FEISHU_BRIDGE_URL / DOT_FEISHU_BRIDGE_KEY 时不注册。
   ================================================================ */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { currentActor } from './client.js'

async function callBridge(path, payload, timeoutMs = 20_000) {
  /* 2026-10-30：桥地址可能带前缀（经钥匙代理时是 http://127.0.0.1:3928/feishu），
     new URL('/internal/x', base) 会把前缀吃掉，所以按"base 后面拼相对路径"来。 */
  const base = String(process.env.DOT_FEISHU_BRIDGE_URL).replace(/\/+$/, '') + '/'
  const res = await fetch(new URL(path.replace(/^\/+/, ''), base), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dot-bridge-key': process.env.DOT_FEISHU_BRIDGE_KEY },
    body: JSON.stringify({ ...payload, actor: currentActor() }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ? `飞书服务：${json.error}` : `飞书服务 HTTP ${res.status}`)
  return json
}

const OUTPUT = {
  schema: { type: 'object', properties: { data: { type: 'object', required: true, additionalProperties: true } }, additionalProperties: false },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value.data) }],
}

/* feishu-send-file-2026-11-05：群聊轮次里桥会写〔本群记录ID：xxxxxx〕，带给桥用来定位是哪个群。 */
function groupPinOf(exec) {
  try {
    const events = exec?.agent?.session?.snapshotEvents?.()
    if (!Array.isArray(events)) return ''
    const ev = events.findLast(e => e?.type === 'user/message' && e?.data?.source?.kind === 'user')
    const text = (ev?.data?.content ?? []).filter(b => b?.type === 'text').map(b => b.text).join('')
    if (!/^〔群成员：[^〔〕\n]*〕$/m.test(text)) return ''
    return /^〔本群记录ID：([A-Za-z0-9_-]{2,12})〕$/m.exec(text)?.[1] ?? ''
  } catch { return '' }
}

export function feishuTools() {
  if (!process.env.DOT_FEISHU_BRIDGE_URL || !process.env.DOT_FEISHU_BRIDGE_KEY) return []
  return [
    defineTool({
      name: 'feishu_bind',
      description: '把当前 DOT 账号和对方的飞书账号绑定。对方说“绑定飞书”并给出一串 6 位数字（在飞书里给 XTCAUSAL DOT 机器人发消息拿到的绑定码）时调用。绑定后飞书里的对话就是和你聊，知序提醒也会推到飞书。',
      parameters: { code: { type: 'string', required: true, description: '6 位数字绑定码' } },
      output: OUTPUT,
      timeoutMs: 30_000,
      async execute(args) {
        const code = String(args?.code ?? '').replace(/\D/g, '')
        if (code.length !== 6) return { data: { ok: false, error: '绑定码应该是 6 位数字。' } }
        return { data: await callBridge('/internal/claim', { code }) }
      },
    }),
    defineTool({
      name: 'feishu_send_file',
      description: '把工作区里的一个文件或图片发到飞书：正在飞书里聊就回复到当前这条对话（群里就发到本群），否则发到主人的飞书私聊。用户要你“把文件/图片/表格/文档发我”、或者你做好了一个产物需要交给飞书里的用户时调用。图片会以图片消息发出，其他文件以文件消息发出（上限 30MB）。',
      parameters: { path: { type: 'string', required: true, description: '文件路径，相对工作区' } },
      output: OUTPUT,
      timeoutMs: 150_000,
      async execute(args, exec) {
        const path = String(args?.path ?? '').trim()
        if (!path) return { data: { ok: false, error: '缺少 path' } }
        const groupPin = groupPinOf(exec)
        return { data: await callBridge('/internal/send_file', groupPin ? { path, groupPin } : { path }, 150_000) }
      },
    }),
    /* feishu-doc-2026-11-06：读飞书云文档/知识库链接（机器人身份）。桥里 DOT_FEISHU_DOC_READ=0 时返回已关闭。 */
    defineTool({
      name: 'feishu_read_doc',
      description: '读取一篇飞书云文档（链接含 /docx/）或知识库页面（链接含 /wiki/）的正文，用机器人身份读。用户给了飞书文档链接、要你看/总结/改写里面的内容，而消息里还没有附上〔飞书文档〕正文（或正文被截断、需要重读）时调用。读不到时返回原因：没权限就请用户在文档右上角「···」→「更多」→「添加文档应用」把本应用加进去。只能读新版云文档，表格/多维表格暂不支持。',
      parameters: {
        url: { type: 'string', required: true, description: '飞书文档或知识库链接' },
        maxChars: { type: 'number', description: '最多返回多少字，默认 20000，上限 60000' },
      },
      output: OUTPUT,
      timeoutMs: 60_000,
      async execute(args) {
        const url = String(args?.url ?? '').trim()
        if (!url) return { data: { ok: false, error: '缺少 url' } }
        return { data: await callBridge('/internal/read_doc', { url, ...(Number(args?.maxChars) > 0 ? { maxChars: Number(args.maxChars) } : {}) }, 60_000) }
      },
    }),
    defineTool({
      name: 'feishu_binding_status',
      description: '查看当前 DOT 账号有没有绑定飞书。',
      parameters: {},
      output: OUTPUT,
      timeoutMs: 30_000,
      async execute() { return { data: await callBridge('/internal/binding', {}) } },
    }),
  ]
}
