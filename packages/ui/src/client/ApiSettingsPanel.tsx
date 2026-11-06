/* ================================================================
   DOT API设置面板 · 总导游图
   ▍这是什么
   普通CSS自有表单：当前API、地址、Key更新、模型获取；插件配置另走原生入口。
   ▍修改铁律
   Key永不回显，退出即清草稿；获取列表不会自动覆盖配置，必须明确采纳并保存。
   ▍更新记录
   *更新：2026-10-26 · 首版自有API表单，不依赖新增美术*
   ================================================================ */
import { useEffect, useState } from 'react'
import type { ApiDraft, ApiSettingsPort, ApiModelRow } from './api-settings.ts'
const css = `
[data-dot-api]{color:#efe7d6;display:grid;gap:14px;font-size:15px;line-height:1.5}
[data-dot-api] label{display:grid;gap:6px}[data-dot-api] input,[data-dot-api] select,[data-dot-api] textarea{box-sizing:border-box;width:100%;padding:10px;border:1px solid #d9bc7c66;border-radius:10px;background:#101b2b;color:#efe7d6;font:inherit}
[data-dot-api] button{padding:10px 14px;background:#d9bc7c20;color:#ecd3a0;border:1px solid #d9bc7c70;border-radius:10px;cursor:pointer}[data-dot-api] button:disabled{opacity:.5;cursor:default}
[data-dot-api] small{color:#b7b0a4}[data-dot-api] [role=alert]{color:#ffb9a9}[data-dot-api] .apiActions{display:flex;gap:10px;flex-wrap:wrap}
`
/* 显式用户动作才读目录、保存或请求模型列表，不偷偷探测远端API。 */
export function ApiSettingsPanel({port}:{port?:ApiSettingsPort | undefined}) {
  const [rows,setRows]=useState<ApiDraft[]>([]),[selected,setSelected]=useState(''),[url,setUrl]=useState(''),[api,setApi]=useState(''),[key,setKey]=useState(''),[modelText,setModelText]=useState(''),[dirtyModels,setDirtyModels]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [discovered,setDiscovered]=useState<ApiModelRow[]>([])
  const draft=rows.find(x=>x.provider===selected)
  const choose=(row:ApiDraft)=>{setSelected(row.provider);setUrl(row.baseURL);setApi(row.api);setKey('');setModelText(row.models.map(x=>x.id).join('\n'));setDirtyModels(false);setDiscovered([]);setNotice('');setError('')}
  const load=async(prefer=selected)=>{
    if(!port)throw new Error('API配置服务还没就绪')
    const next=await port.load();setRows(next)
    const row=next.find(x=>x.provider===prefer)??next[0];if(row)choose(row)
  }
  useEffect(()=>{let live=true;if(port)void port.load().then(next=>{if(!live)return;setRows(next);if(next[0])choose(next[0])}).catch(cause=>{if(live)setError(String(cause))});return()=>{live=false}},[port])
  const run=async(task:()=>Promise<void>)=>{setBusy(true);setError('');setNotice('');try{await task()}catch(cause){setError(cause instanceof Error?cause.message:String(cause))}finally{setBusy(false)}}
  return <section data-dot-api="" aria-label="API连接设置"><style>{css}</style>
    <p>API地址与密钥仍由当前DOT服务保存，这里不另建一份。留空密钥表示不修改。</p>
    <label>API连接<select aria-label="API连接" disabled={busy} value={selected} onChange={event=>{const row=rows.find(x=>x.provider===event.target.value);if(row)choose(row)}}>{rows.map(x=><option key={x.provider} value={x.provider}>{x.name} · {x.provider}</option>)}</select></label>
    <button disabled={busy||!port} onClick={()=>void run(async()=>{const id=prompt('自定义API连接标识（例如 my-provider）');if(!id)return;const row=await port!.create(id.trim());setRows(old=>[...old,row]);choose(row)})}>添加API连接</button>
    {!rows.length&&<p>还没有读到API连接。可以重新读取已安装适配器。</p>}
    {draft&&<><label>服务地址<input aria-label="API服务地址" value={url} disabled={busy} onChange={e=>setUrl(e.target.value)} autoComplete="off"/></label>
      <label>调用协议<select aria-label="API调用协议" value={api} disabled={busy||draft.settingsNs!=='llm-pi-ai'} onChange={e=>setApi(e.target.value)}><option value="">沿用当前适配器</option><option value="openai-completions">OpenAI Chat兼容</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic Messages</option></select></label>
      <small>协议由服务商接口决定；模型名称只用于显示识别，不替你改协议。</small>
      <label>更新API密钥<input aria-label="更新API密钥" type="password" value={key} autoComplete="new-password" disabled={busy} placeholder="留空保持已有密钥" onChange={e=>setKey(e.target.value)}/></label>
      <label>模型请求名称（每行一个）<textarea aria-label="模型请求名称" rows={5} value={modelText} disabled={busy} onChange={e=>{setModelText(e.target.value);setDirtyModels(true)}}/></label>
      <div className="apiActions"><button disabled={busy||!port} onClick={()=>void run(async()=>{const found=await port!.discover({draft,baseURL:url,api,key});setDiscovered(found);setModelText(found.map(x=>x.id).join('\n'));setDirtyModels(true);setNotice(`获取到${found.length}个模型，核对后点击保存才会采纳。`)})}>获取模型列表</button>
      <button disabled={busy||!port||!draft.writable} onClick={()=>void run(async()=>{const models=modelText.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(dirtyModels&&(!models.length||new Set(models).size!==models.length))throw new Error('模型列表不能为空，也不能重复');await port!.save({draft,baseURL:url,api,key,...dirtyModels?{models:models.map(id=>discovered.find(row=>row.id===id)??{id})}:{}});setKey('');await load(draft.provider);setNotice('API配置已保存；尚未发起模型对话测试。')})}>保存API配置</button></div>
    </>}
    <button disabled={busy||!port} onClick={()=>void run(()=>load())}>重新读取API配置</button>
    {busy&&<p role="status">正在处理API设置…</p>}{notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
  </section>
}
