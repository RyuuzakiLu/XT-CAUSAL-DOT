/**
 * 对话界面只显示 ASTRA 的最终回答（2026-10-27）。
 *
 * 思考、工具调用（含记忆卡片）、回答前的过程文字和“Completed in X 秒”那一行只在界面上隐藏：
 * DSH 照常把这些行渲染进 DOM，会话事件也照常记录。以后要把思考概括成几个字显示到别处，
 * 前端仍能从 [data-turn-process-member] / [data-chat-group-part="reasoning"] / [data-chat-flow-kind="tool-call"]
 * 这些行读到内容。
 */
/*
 * 消息动作区裁剪（2026-10-29，用户点名去掉四条）：每条回答下面只留
 * 「正文 / 复制 / 重试 / 停止 / 附件 / 提问卡」，去掉点赞、点踩、反馈。
 *
 * 为什么用这几条判据（都是实测出来的，别按直觉放宽）：
 *   ① 赞/踩：dsh-client-ui-message-feedback 注册进 conversation.chat.assistant-actions，
 *      那两颗按钮是整棵聊天树里**唯一**带 aria-pressed 的元素（源码 client.js 里
 *      aria-pressed: rating === "positive" / "negative"）——认它最稳，不依赖构建哈希类名。
 *   ② 反馈按 aria-label 收。
 *   ③ 只藏按钮，【不】藏 [role=status]：失败/冲突提示必须仍然看得见（错误可见是硬要求）。
 *
 * 【不】删后端 feedback 数据、不改原生宿主、不动历史：这里只是 display:none。
 * 【留】[data-chat-running] 的停止、[data-composer-card] 的发送/停止、附件槽、[data-question-key] 提问卡。
 */
export const HIDE_MESSAGE_ACTIONS = `
[data-slot="conversation.chat.assistant-actions"] button[aria-pressed],
[data-chat-flow-kind="assistant-step"] [class*="_actions"] button[aria-label*="反馈"] { display: none !important; }
`
export const ANSWER_ONLY_CSS = `
::highlight(dot-reply-pending) { color: transparent; text-shadow: none; }
/* 原生过程组的标题是独立按钮：统一隐藏操作记录入口，保留组内工作卡与交互内容。 */
[data-chat-group-key] > :has(> [data-process-activity]) { display: none !important; }

[data-dot-background-result],
[data-chat-flow-kind="turn-process"],
[data-chat-flow-kind="tool-call"],
[data-chat-flow-kind][data-chat-group-part="reasoning"],
[data-chat-flow-kind][data-turn-process-member]:not([data-turn-process-answer]) { display: none !important; }
/* Only successful GenUI tool cards escape the process hiding rules. */
:root [data-chat-flow-kind="tool-call"][data-chat-flow-kind]:has([data-dot-genui-card]),
:root [data-chat-flow-kind="turn-process"]:has([data-dot-genui-card]),
:root [data-chat-group-key]:has([data-dot-genui-card]),
:root [data-step-process-body]:has([data-dot-genui-card]) { display: block !important; content-visibility: visible !important; max-height: none !important; height: auto !important; overflow: visible !important; opacity: 1 !important; }
/* 2026-10-30 工作卡例外（用户）：工作空间那张进度卡由 work_query / work_create 插进消息流，但上面的规则把所有工具格
   连同原生折叠组一起藏了，前台永远看不到。这里只把"装着工作卡的那一格"及它所在的折叠组拉回来：
   · 每组只留最后一张卡（同一回合先 work_create 再 work_query 时不重复出两张）；
   · 折叠组的标题行（"已调用工具"）照旧不显示；组里其它工具格、思考仍按上面的规则藏着。
   特异性故意压过上面的 [data-turn-process-member]:not(...) 规则；原生 hidden="until-found" 也一并覆盖。 */
:root [data-chat-flow-kind="tool-call"][data-chat-flow-kind]:has([data-dot-work-chat-card], [data-dot-work-candidates]):not(:has(~ [data-chat-flow-kind="tool-call"] [data-dot-work-chat-card])) { display: block !important; content-visibility: visible !important; }
[data-chat-group-key]:has([data-dot-work-chat-card], [data-dot-work-candidates]),
[data-chat-group-key] [data-step-process-body]:has([data-dot-work-chat-card], [data-dot-work-candidates]) { display: block !important; content-visibility: visible !important; max-height: none !important; height: auto !important; overflow: visible !important; opacity: 1 !important; }
`

/** 回答里给记忆记账用的 [m:条目id] 标注：服务端照常读原文记账，界面上不显示。 */
const MEMORY_REF = /[ \t]*\[m:[A-Za-z0-9_.:-]+\]/g
const ANSWER_ROW = '[data-chat-flow-kind="assistant-step"]'

export function installMemoryRefScrubber(root: Document = document): () => void {
  const win = root.defaultView
  if (!win?.MutationObserver || !root.body) return () => {}
  const scrubText = (text: Node) => {
    const value = text.nodeValue
    if (!value || !value.includes('[m:')) return
    const next = value.replace(MEMORY_REF, '')
    if (next !== value) text.nodeValue = next
  }
  const scrub = (node: Node) => {
    if (node.nodeType === 3) { scrubText(node); return }
    const walker = root.createTreeWalker(node, 4 /* NodeFilter.SHOW_TEXT */)
    for (let text = walker.nextNode(); text; text = walker.nextNode()) scrubText(text)
  }
  /* 后台回传借原生 prompt 唤醒前台，仍留原始事件，但不能在界面冒充用户发言。
     只认 user 行开头的固定系统标记，用户引用正文中提到它不会误藏别的行。 */
  const markBackground = () => root.querySelectorAll('[data-chat-flow-kind="user"]').forEach(row => {
    const background = row.textContent?.trimStart().startsWith('〔后台结果·系统消息〕') === true
    if (background && !row.hasAttribute('data-dot-background-result')) row.setAttribute('data-dot-background-result', '')
  })
  const inAnswer = (node: Node) => { const el = node instanceof Element ? node : node.parentElement; return Boolean(el?.closest(ANSWER_ROW)) }
  const observer = new win.MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'characterData') { if (inAnswer(record.target)) scrub(record.target); continue }
      record.addedNodes.forEach(node => {
        if (inAnswer(node)) scrub(node)
        else if (node instanceof Element) node.querySelectorAll(ANSWER_ROW).forEach(scrub)
      })
    }
    markBackground()
  })
  observer.observe(root.body, { subtree: true, childList: true, characterData: true })
  root.querySelectorAll(ANSWER_ROW).forEach(scrub)
  markBackground()
  return () => observer.disconnect()
}
