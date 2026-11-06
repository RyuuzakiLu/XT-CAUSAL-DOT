'use strict';
// API presets are app-owned. Model IDs are discovered from the selected endpoint.
const PROVIDERS = [
  {id:'custom',name:'自定义 / OpenAI 兼容',baseURL:'',noAuth:false},
  {id:'deepseek',name:'DeepSeek',baseURL:'https://api.deepseek.com',noAuth:false},
  {id:'dashscope',name:'通义千问 · 百炼（北京）',baseURL:'https://dashscope.aliyuncs.com/compatible-mode/v1',noAuth:false},
  {id:'siliconflow',name:'硅基流动',baseURL:'https://api.siliconflow.cn/v1',noAuth:false},
  {id:'openrouter',name:'OpenRouter',baseURL:'https://openrouter.ai/api/v1',noAuth:false},
  {id:'openai',name:'OpenAI',baseURL:'https://api.openai.com/v1',noAuth:false},
  {id:'ollama',name:'Ollama · 本机',baseURL:'http://localhost:11434/v1',noAuth:true},
  {id:'lmstudio',name:'LM Studio · 本机',baseURL:'http://localhost:1234/v1',noAuth:true}
];
const defaultModel = () => ({provider:'custom',baseURL:'',model:'',noAuth:false,enableTools:true,timeout:120});
function normalizeModel(input={}) {
  // v0.1 used an external runtime; none of its paths/auth settings are imported.
  if(input.engine==='hermes'||input.rootPath!==undefined)return defaultModel();
  const d=defaultModel();
  for(const k of Object.keys(d))if(input[k]!==undefined)d[k]=input[k];
  if(!PROVIDERS.some(p=>p.id===d.provider))throw new Error('请选择服务商或自定义接口');
  for(const key of ['baseURL','model']){
    if(typeof d[key]!=='string'||d[key].length>2000)throw new Error('模型配置格式无效');
    d[key]=d[key].trim();
  }
  if(d.baseURL){
    let url;try{url=new URL(d.baseURL);}catch{throw new Error('API 地址应是完整的 http 或 https 地址');}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('API 地址不能含账号、密码、查询参数或片段');
    if(/\/(chat\/completions|responses|models)\/?$/.test(url.pathname))throw new Error('请填写 API 基础地址，例如 https://服务地址/v1，不包含 /chat/completions 或 /models');
    d.baseURL=url.href.replace(/\/+$/,'');
  }
  if(/[\r\n\x00-\x1f]/.test(d.model)||d.model.length>300)throw new Error('模型 ID 无效或过长');
  if(typeof d.noAuth!=='boolean'||typeof d.enableTools!=='boolean'||!Number.isInteger(d.timeout)||d.timeout<15||d.timeout>300)throw new Error('模型选项无效；超时范围为 15–300 秒');
  return d;
}
module.exports={PROVIDERS,defaultModel,normalizeModel};
