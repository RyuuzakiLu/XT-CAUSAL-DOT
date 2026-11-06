/* ================================================================
   DOT模型切换 · 总导游图
   ▍这是什么
   把能力页的选择交给原生session.selectModel，确认回执才更新显示，不发送模型消息。
   ▍修改铁律
   运行中的会话不偷偷换模型；只允许目录里实际存在的provider/model组合。
   ▍更新记录
   *更新：2026-10-26 · 独立可验证的模型选择接头*
   ================================================================ */
import type { ProviderRow } from './model.ts'
export type ModelSelectionPort = {
  rows(): ProviderRow[]
  busy(): boolean
  session(): Promise<string>
  select(input:{sessionId:string;provider:string;model:string}):Promise<{ok:true;value:{selected:{provider:string;model:string}}}|{ok:false;error:{message:string}}>
  selected(provider:string,model:string):void
}
/* 服务签收的是哪个模型必须核对，不能只收到ok就标为选中。 */
export async function selectDotModel(port:ModelSelectionPort, provider:string, model:string):Promise<string> {
  const route=port.rows().find(row=>row.id===provider)
  const entry=route?.models.find(row=>row.id===model)
  if(!entry||!route?.active)throw new Error('模型不在当前可用目录，请重新读取')
  if(port.busy())throw new Error('ASTRA正在处理当前对话，请结束后再切换模型')
  const result=await port.select({sessionId:await port.session(),provider,model})
  if(!result.ok)throw new Error(result.error.message)
  if(result.value.selected.provider!==provider||result.value.selected.model!==model)throw new Error('服务未确认切换到所选模型')
  port.selected(provider,model)
  return entry.name
}
