'use strict';
const crypto = require('node:crypto');
const { Temporal } = require('@js-temporal/polyfill');
const {defaultModel,normalizeModel}=require('./model-config.cjs');
const {defaultFeishu,normalizeFeishu,defaultWeixin,normalizeWeixin}=require('./gateway-config.cjs');
const KINDS = ['tasks','events','notes','docs','messages','settings'];
const freshSettings = () => ({daily:false,briefTime:'09:00',quiet:true,sms:false,model:defaultModel(),pet:{enabled:true,always:false,size:130,opacity:1},lan:{enabled:false,port:43827},feishu:defaultFeishu(),weixin:defaultWeixin()});
const emptyState = () => ({version:1,tasks:[],events:[],notes:[],docs:[],messages:[],settings:freshSettings(),_versions:{},sequence:0});
const validId = value => typeof value==='string' && /^[A-Za-z0-9_.:-]{1,180}$/.test(value);
function text(value,max,required=false){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw new Error('内容为空或超过允许长度');return value;}
function instant(value,optional=true){if(optional&&!value)return '';if(typeof value!=='string'||!/[zZ]|[+-]\d{2}:\d{2}$/.test(value))throw new Error('时间必须包含时区');try{return Temporal.Instant.from(value).toString();}catch{throw new Error('日期或时间无效');}}
function validate(kind,id,input){
  if(!KINDS.includes(kind)||!validId(id)||!input||typeof input!=='object'||Array.isArray(input))throw new Error('记录类型或标识无效');
  const d=JSON.parse(JSON.stringify(input));delete d._version;
  if(kind==='settings'){
    const defaults=freshSettings();
    for(const key of ['daily','quiet','sms'])if(typeof d[key]!=='boolean')throw new Error('设置格式无效');
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.briefTime))throw new Error('简报时间无效');
    d.model=normalizeModel(d.model);
    d.feishu=normalizeFeishu(d.feishu);
    d.weixin=normalizeWeixin(d.weixin);
    d.pet={...defaults.pet,...d.pet};if(typeof d.pet.enabled!=='boolean'||typeof d.pet.always!=='boolean'||!Number.isFinite(d.pet.size)||d.pet.size<70||d.pet.size>220||!Number.isFinite(d.pet.opacity)||d.pet.opacity<.3||d.pet.opacity>1)throw new Error('桌宠设置无效');
    d.lan={...defaults.lan,...d.lan};if(typeof d.lan.enabled!=='boolean'||!Number.isInteger(d.lan.port)||d.lan.port<1024||d.lan.port>65535)throw new Error('同步端口无效');
    delete d.apiKey;return d;
  }
  d.id=id;
  if(kind==='tasks'){
    text(d.title,500,true);if(!['pending','in_progress','done','canceled'].includes(d.status)||!['normal','important'].includes(d.priority))throw new Error('任务状态无效');
    d.dueAt=instant(d.dueAt);d.remindAt=instant(d.remindAt);d.repeat=d.repeat||'none';if(!['none','daily','weekly'].includes(d.repeat))throw new Error('重复规则无效');
    d.timeZone=d.timeZone||Intl.DateTimeFormat().resolvedOptions().timeZone;Temporal.Now.zonedDateTimeISO(d.timeZone);if(d.description!==undefined)text(d.description,10000);
    if(d.taskOrigin){const o=d.taskOrigin;if(o.platform!=='feishu'||!/^[a-f0-9]{64}$/.test(o.scope)||!/^oc_[A-Za-z0-9_-]+$/.test(o.chatId)||!/^ou_[A-Za-z0-9_-]+$/.test(o.memberId))throw new Error('群聊提醒来源无效');if(o.memberName!==undefined)text(o.memberName,50);d.taskOrigin={platform:'feishu',scope:o.scope,chatId:o.chatId,memberId:o.memberId,...(o.memberName?{memberName:o.memberName}:{}),boundAt:instant(o.boundAt,false)};}
  }
  if(kind==='events'){text(d.title,500,true);d.start=instant(d.start,false);d.end=instant(d.end,false);if(Temporal.Instant.compare(d.start,d.end)>=0)throw new Error('结束时间需晚于开始时间');text(d.location||'',1000);
    /* 提前提醒量（分钟）：空=不提醒；0=日程开始时；数字=提前多少分钟。上限 10080（7 天），
       与外部 Agent 契约 reminderOffsetMinutes 同一口径，两边不打架。 */
    if(d.reminderOffsetMinutes!==undefined&&d.reminderOffsetMinutes!==null&&d.reminderOffsetMinutes!==''){if(!Number.isInteger(d.reminderOffsetMinutes)||d.reminderOffsetMinutes<0||d.reminderOffsetMinutes>10080)throw new Error('提前提醒时间无效');}else delete d.reminderOffsetMinutes;
  }
  if(kind==='notes'){text(d.title,500,true);text(d.body,100000,true);if(!['note','preference'].includes(d.kind))throw new Error('笔记类型无效');}
  if(kind==='docs'){text(d.name,500,true);text(d.body,2_000_000);if(d.pages!==undefined&&(!Array.isArray(d.pages)||d.pages.length>2000))throw new Error('资料页数超限');}
  if(kind==='messages'){if(!['user','assistant'].includes(d.role))throw new Error('消息角色无效');text(d.text,200000);}
  return d;
}
function diffStates(before,after){
  const changes=[];
  for(const kind of KINDS){
    const old=kind==='settings'?[{...before.settings,id:'shared'}]:before[kind]||[];
    const next=kind==='settings'?[{...after.settings,id:'shared'}]:after[kind]||[];
    const a=new Map(old.map(d=>[d.id,d])),b=new Map(next.map(d=>[d.id,d]));
    for(const id of new Set([...a.keys(),...b.keys()]))if(JSON.stringify(a.get(id))!==JSON.stringify(b.get(id)))changes.push({kind,id,beforeVersion:before._versions?.[`${kind}:${id}`]||0,data:b.get(id)||null});
  }
  return changes;
}
function reminderOccurrence(task,now=Date.now(),next=false){
  if(!task.remindAt||['done','canceled'].includes(task.status))return null;
  let z=Temporal.Instant.from(task.remindAt).toZonedDateTimeISO(task.timeZone||Intl.DateTimeFormat().resolvedOptions().timeZone);
  const step=task.repeat==='daily'?1:task.repeat==='weekly'?7:0;
  if(!step){const at=Number(z.epochMilliseconds);return next?(at>now?at:null):(at<=now?at:null);}
  const days=Math.max(0,Math.floor((now-Number(z.epochMilliseconds))/86400000/step)-1)*step;z=z.add({days});
  let last=null;
  for(let i=0;i<6;i++){const at=Number(z.epochMilliseconds);if(at>now)return next?at:last;last=at;z=z.add({days:step});}
  return next?Number(z.epochMilliseconds):last;
}
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
module.exports={KINDS,freshSettings,emptyState,validId,validate,instant,diffStates,reminderOccurrence,hash};
