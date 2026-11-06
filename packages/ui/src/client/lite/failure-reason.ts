/* 任务详情（设计稿 09b）：把后台工作的原始报错翻成一句人话。
   原始文本（常是「400: {json…}」）不丢，详情页收进「查看原始信息」里，用灰色等宽字显示。
   只认常见几类：超时、工具缺失、模型拒绝、HTTP 400/401/403/429/5xx、网络不通；认不出给一句通用话。 */

export interface FailureReason {
  /** 给人看的一句话。 */
  sentence: string
  /** 原始信息；原文本身已经是一句短中文时为空（不再重复折叠一份）。 */
  raw: string
  /** 命中的类别，测试和埋点用。 */
  kind: FailureKind
}

export type FailureKind = 'timeout' | 'tool-missing' | 'auth' | 'forbidden' | 'rate-limit' | 'server' | 'too-long' | 'model-rejected' | 'bad-request' | 'network' | 'plain' | 'generic'

export const GENERIC_FAILURE = '这次没做成，出了点意外。可以点「重试」再做一次。'

const SENTENCES: Record<Exclude<FailureKind, 'plain'>, string> = {
  timeout: '等了太久没有回应，超时了。可以点「重试」再做一次。',
  'tool-missing': '它要用的工具这次没装上，做不下去。',
  auth: '模型服务的密钥无效或过期了（401），需要重新配置。',
  forbidden: '模型服务拒绝访问，没有这项权限（403）。',
  'rate-limit': '请求太频繁或额度用完了（429），模型服务暂时不接，稍后再试。',
  server: '模型服务那边出了故障（服务器错误），稍后重试一般就好。',
  'too-long': '这次内容太长，超出了模型一次能处理的量。',
  'model-rejected': '模型服务拒绝了这次请求，没做下去。可以点「重试」再做一次。',
  'bad-request': '模型服务不接受这次请求（400），没做下去。',
  network: '连不上模型服务，网络或服务暂时不通。',
  generic: GENERIC_FAILURE,
}

/** 找报错里的 HTTP 状态码：开头「400:」「HTTP 429」「status 503」「[401]」「status_code: 500」。 */
export function statusCodeOf(text: string): number | null {
  const patterns = [
    /^\s*(\d{3})\s*[:：\s]/,
    /\bHTTP(?:\/\d(?:\.\d)?)?\s*[: ]?\s*(\d{3})\b/i,
    /\bstatus(?:[ _]?code)?["']?\s*[:=]?\s*(\d{3})\b/i,
    /\[(\d{3})\]/,
  ]
  for (const pattern of patterns) {
    const hit = text.match(pattern)
    if (hit) { const code = Number(hit[1]); if (code >= 400 && code <= 599) return code }
  }
  return null
}

function classify(text: string): Exclude<FailureKind, 'plain'> {
  const code = statusCodeOf(text)
  /* 上游明确说「拦截 / 风控 / 内容策略」时最可信，先认，免得被提示文字里的「超时」「额度」带偏。 */
  if (/unapproved channel|request blocked|拦截|风控|content[_ ]?(policy|filter)/i.test(text)) return 'model-rejected'
  if (/time[d\s-]*out|ETIMEDOUT|ESOCKETTIMEDOUT|deadline exceeded|超时/i.test(text) || code === 408 || code === 504) return 'timeout'
  if (/(tool|工具)[^\n]{0,40}(not found|not available|not registered|unavailable|missing|不存在|缺失|未注册|没有装|未安装|不可用)|unknown tool|no such tool|command not found/i.test(text)) return 'tool-missing'
  if (code === 401 || /\bunauthori[sz]ed\b|invalid[_ ]api[_ ]key|incorrect api key/i.test(text)) return 'auth'
  if (code === 429 || /rate[_ -]?limit|too many requests|insufficient[_ ]quota|quota exceeded|额度/i.test(text)) return 'rate-limit'
  if (code === 403 || /\bforbidden\b/i.test(text)) return 'forbidden'
  if ((code !== null && code >= 500) || /overloaded|internal server error|bad gateway|service unavailable/i.test(text)) return 'server'
  if (/context[_ ]length|maximum context|too many tokens|prompt is too long|上下文.{0,6}(超|过长)/i.test(text)) return 'too-long'
  if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|network error|socket hang up/i.test(text)) return 'network'
  if (/invalid_request_error|\bsafety\b|\brefus(?:ed|al|es)\b/i.test(text)) return 'model-rejected'
  if (code === 400) return 'bad-request'
  return 'generic'
}

/** 原文已是一句短的人话（短、单行、有中文、不像 JSON/堆栈）就直接用。 */
function isPlainSentence(text: string): boolean {
  return text.length <= 80 && !/[\n{}\[\]<>]/.test(text) && /[\u4e00-\u9fff]/.test(text) && statusCodeOf(text) === null && !/Error\b|at \S+:\d+/.test(text)
}

export function explainFailure(input: unknown): FailureReason | null {
  const raw = typeof input === 'string' ? input.trim() : input == null ? '' : String(input).trim()
  if (!raw) return null
  const kind = classify(raw)
  if (kind === 'generic' && isPlainSentence(raw)) return { sentence: raw, raw: '', kind: 'plain' }
  return { sentence: SENTENCES[kind], raw, kind }
}
