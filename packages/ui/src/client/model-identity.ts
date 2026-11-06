/* ================================================================
   模型名片 · 总导游图
   ▍这是什么
   仅按模型名称与ID展示家族，不用API地址猜测，也不据此改调用协议或能力。
   家族对应的品牌图标在 model-family-icons.ts；本文件只管"认成哪一家"。
   ▍修改铁律
   代理商可以改名；未知就保留未知，显示名片不等于验证了真实模型身份。
   ▍更新记录
   *更新：2026-10-26 · 自有模型选择页共用名称识别*
   *更新：2026-10-26 · 识别结果额外驱动家族图标*
   ================================================================ */
export type ModelFamily = 'DeepSeek' | 'Claude' | 'GPT' | 'Gemini' | 'GLM' | 'Qwen' | 'Kimi' | 'Grok' | 'Mistral' | '其他模型'
/* 名称和请求ID同时参与识别，端口与URL从接口形状上就不能传入。
   ⚠️ 顺序有讲究：先认更专有的名字。例如 'qwen' 与 'kimi' 都有中文别名，
   把通用的 'gpt' 放前面会把 'gpt-oss' 这类开源权重也算成 OpenAI 家族——这没问题，
   但 'claude' 必须先于任何含 'code' 的泛匹配，否则 Claude Code 会被归错。
   2026-10-26 追加 Grok / Mistral：这两家在代理商目录里出现频率不低，之前一律落"其他模型"。 */
export function modelFamily(model: { id: string; name: string }): ModelFamily {
  const text = `${model.name} ${model.id}`.toLowerCase()
  if (/deepseek|深度求索/.test(text)) return 'DeepSeek'
  if (/claude|克劳德/.test(text)) return 'Claude'
  if (/grok|xai|x\.ai/.test(text)) return 'Grok'
  if (/mistral|密斯特拉/.test(text)) return 'Mistral'
  if (/gemini|双子座/.test(text)) return 'Gemini'
  if (/\bglm|chatglm|智谱|zhipu/.test(text)) return 'GLM'
  if (/qwen|通义|千问/.test(text)) return 'Qwen'
  if (/kimi|moonshot|月之暗面/.test(text)) return 'Kimi'
  if (/gpt|chatgpt|(?:^|[\s/:_-])o[134](?:[\s/_.-]|$)/.test(text)) return 'GPT'
  return '其他模型'
}
