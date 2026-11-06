'use strict';
const crypto=require('node:crypto');
const {instant}=require('./data.cjs');
const {retrieve}=require('./documents.cjs');
const newsAdmin=require('./news-admin.cjs');
const specs=[
 ['list_tasks','读取真实任务与标识',{query:{type:'string'}},[]],
 ['today_agenda','读取今天的真实待办和日程',{},[]],
 ['search_notes','查找已保存的笔记和偏好',{query:{type:'string'}},['query']],
 ['create_task','保存用户交代的待办；截止时间与提醒时间分别保存',{title:{type:'string'},dueAt:{type:'string'},remindAt:{type:'string'},repeat:{type:'string',enum:['none','daily','weekly']},priority:{type:'string',enum:['normal','important']}},['title']],
 ['update_task','更新已经存在的任务，使用读取结果的真实标识',{id:{type:'string'},title:{type:'string'},status:{type:'string',enum:['pending','in_progress','done','canceled']},dueAt:{type:'string'},remindAt:{type:'string'}},['id']],
 ['save_note','保存用户明确要求的笔记或偏好',{title:{type:'string'},body:{type:'string'},kind:{type:'string',enum:['note','preference']}},['title','body']],
 ['create_event','保存开始和结束时间明确的日程；可带提前提醒（reminderOffsetMinutes=提前分钟数，如 1440=提前一天）',{title:{type:'string'},start:{type:'string'},end:{type:'string'},location:{type:'string'},reminderOffsetMinutes:{type:'integer'}},['title','start','end']],
 ['search_documents','查找资料原文，返回文件标识与页段位置',{query:{type:'string'}},['query']],
 /* ---- 每日推送订阅管理（下一轮 N01–N10）：统一调一期真实订阅服务，不另建聊天里的假计划 ---- */
 ['list_news_subscriptions','读取当前真实的每日推送订阅（含内容范围、时间、渠道、状态与下一次执行）',{},[]],
 ['create_news_subscription','创建每日推送订阅并保存；用户明确交代时可以启用',{name:{type:'string'},topics:{type:'array',items:{type:'string'}},keywords:{type:'array',items:{type:'string'}},excludeTopics:{type:'array',items:{type:'string'}},summaryStyle:{type:'string',enum:['concise','standard','detailed']},searchServerId:{type:'string'},searchToolName:{type:'string'},sendTime:{type:'string'},timeZone:{type:'string'},newsCount:{type:'integer'},channels:{type:'array',items:{type:'string',enum:['desktop','feishu','weixin']}},enabled:{type:'boolean'}},['topics']],
 ['update_news_subscription','修改已经存在的每日推送订阅，只提交用户改动的字段；channels 配合 channelMode 区分「只发到/也发到/不用推了」',{subscriptionId:{type:'string'},expectedVersion:{type:'integer'},name:{type:'string'},topics:{type:'array',items:{type:'string'}},keywords:{type:'array',items:{type:'string'}},excludeTopics:{type:'array',items:{type:'string'}},summaryStyle:{type:'string',enum:['concise','standard','detailed']},sendTime:{type:'string'},timeZone:{type:'string'},newsCount:{type:'integer'},channels:{type:'array',items:{type:'string',enum:['desktop','feishu','weixin']}},channelMode:{type:'string',enum:['replace','add','remove']},enabled:{type:'boolean'}},[]],
 ['set_news_subscription_enabled','暂停或恢复每日推送订阅（保留配置与历史）；恢复后重算下一次执行',{subscriptionId:{type:'string'},enabled:{type:'boolean'}},['enabled']],
 ['delete_news_subscription','删除每日推送订阅（软删，历史保留，取消未发投递）',{subscriptionId:{type:'string'}},[]]
];
const schemas=specs.map(([name,description,properties,required])=>({name:'zhixu_'+name,description,parameters:{type:'object',properties,required,additionalProperties:false}}));
function writeRecord(store,kind,data,operationId){const id=data.id||crypto.randomUUID(),current=store.get(kind,id);const result=store.patch({operationId,changes:[{kind,id,beforeVersion:current?.version||0,data:{...data,id}}]});if(!result.ok)throw new Error('记录已经更新，请重新读取后修改');return result.state[kind].find(x=>x.id===id);}
/* 只读工具：不需要「明确要求保存或修改事务」的写授权 */
const READ_TOOLS=['list_tasks','search_documents','today_agenda','search_notes','list_news_subscriptions'];
/* 每日推送订阅的写工具：与事务一样走 allowWrite 闸门，且统一调 news-admin（一期真实订阅服务） */
const NEWS_TOOLS=['create_news_subscription','update_news_subscription','set_news_subscription_enabled','delete_news_subscription'];
/* newsExec()：契约
   入参：store、工具名、args、context{operationId,sessionKey,deps}
   返回：动作结果对象（来自 news-admin）
   副作用：写 news_subscriptions / news_targets / 收据；可能取消未发投递
   谁调用：execute（对话工具的出口）
   改动影响：把所有订阅动作收口到 news-admin，保证「对话」与「界面」操作同一条数据（spec 下一轮 §3）。
     ⚠️ ctx.taskOrigin 是越权闸门的依据：群消息带它 → news-admin.assertOwner 直接拒绝（N09）。 */
function newsExec(store,name,args,context={}){
 const ctx={sessionId:context.sessionKey||'desktop',requestId:context.operationId||'',taskOrigin:context.taskOrigin};
 const deps=context.deps||{};
 if(name==='list_news_subscriptions')return newsAdmin.adminQuery(store,{},ctx);
 if(name==='create_news_subscription')return newsAdmin.adminCreate(store,args,ctx,deps);
 if(name==='update_news_subscription')return newsAdmin.adminUpdate(store,args,ctx,deps);
 if(name==='set_news_subscription_enabled')return newsAdmin.adminSetEnabled(store,args,ctx);
 if(name==='delete_news_subscription')return newsAdmin.adminDelete(store,args,ctx);
 throw new Error('未知的订阅工具：'+name);
}
function execute(store,name,args,{operationId,allowWrite,taskOrigin,sessionKey,deps}={}){
 name=name.replace(/^zhixu_/,'');const spec=specs.find(s=>s[0]===name);if(!spec||!args||typeof args!=='object'||Object.keys(args).some(k=>!Object.hasOwn(spec[2],k)))throw new Error('工具参数无效');
 if(!READ_TOOLS.includes(name)&&!allowWrite)throw new Error('请明确要求保存或修改事务');
 if(NEWS_TOOLS.includes(name)||name==='list_news_subscriptions')return newsExec(store,name,args,{operationId,sessionKey,taskOrigin,deps});
 if(name==='list_tasks')return store.snapshot().tasks.filter(t=>!args.query||t.title.includes(args.query));
 if(name==='today_agenda'){const s=store.snapshot(),day=new Date().toDateString();return {tasks:s.tasks.filter(t=>!['done','canceled'].includes(t.status)&&((t.dueAt&&new Date(t.dueAt).toDateString()===day)||(t.remindAt&&new Date(t.remindAt).toDateString()===day))),events:s.events.filter(e=>new Date(e.start).toDateString()===day)};}
 if(name==='search_notes'){const q=String(args.query||'');return store.snapshot().notes.filter(n=>n.title.includes(q)||n.body.includes(q)).slice(0,50);}
 if(name==='search_documents')return retrieve(store.snapshot(),String(args.query||''));
 if(name==='create_task'){if(args.remindAt&&new Date(instant(args.remindAt))<=new Date())throw new Error('提醒时间需在未来');return writeRecord(store,'tasks',{status:'pending',priority:'normal',dueAt:'',remindAt:'',repeat:'none',...args,...(taskOrigin?{taskOrigin}:{}),createdAt:new Date().toISOString()},operationId);}
 if(name==='update_task'){const task=store.get('tasks',args.id)?.data;if(!task)throw new Error('任务不存在');return writeRecord(store,'tasks',{...task,...args},operationId);}
 if(name==='save_note')return writeRecord(store,'notes',{kind:'note',...args,updatedAt:new Date().toISOString()},operationId);
 if(name==='create_event'){
  /* 对话建日程：带 reminderOffsetMinutes 时，日程与「关联提醒任务」必须在【同一次 patch】
     里落库——分成两次写会出现「日程存了、提醒没建」或反过来（提醒指向不存在的日程）的半截状态。
     提醒任务形状与外部 Agent 建的完全一致（event.reminderTaskId ↔ task.eventId），
     所以桌面通知/桌宠/提醒收件箱会自动一起生效，不用另写提醒逻辑。 */
  const offset=args.reminderOffsetMinutes;
  if(offset!==undefined&&(!Number.isInteger(offset)||offset<0||offset>10080))throw new Error('提前提醒时间无效（0–10080 分钟）');
  const start=instant(args.start);
  const eventId=crypto.randomUUID();
  const data={location:'',...args,id:eventId};
  delete data.reminderOffsetMinutes;
  const changes=[{kind:'events',id:eventId,beforeVersion:0,data}];
  if(offset!==undefined){
   const remindAt=new Date(new Date(start).getTime()-offset*60000).toISOString();
   if(new Date(remindAt)<=new Date())throw new Error('提醒时间需在未来');
   const taskId=crypto.randomUUID();
   data.reminderOffsetMinutes=offset;data.reminderTaskId=taskId;data.timeZone=data.timeZone||Intl.DateTimeFormat().resolvedOptions().timeZone;
   changes.push({kind:'tasks',id:taskId,beforeVersion:0,data:{id:taskId,title:data.title,status:'pending',priority:'normal',dueAt:'',remindAt,repeat:'none',timeZone:data.timeZone,description:'',eventId,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}});
  }
  const result=store.patch({operationId,changes});if(!result.ok)throw new Error('记录已经更新，请重新读取后修改');
  return result.state.events.find(x=>x.id===eventId);
 }
}
module.exports={schemas,writeRecord,execute};
