'use strict';
const crypto=require('node:crypto');
const {defaultReminderTemplate}=require('./feishu-names.cjs');
const defaultFeishu=()=>({appId:'',domain:'feishu',reminderTemplate:defaultReminderTemplate,autoConnect:true,forwardReminders:true,respectProxyEnv:false});
const defaultWeixin=()=>({autoConnect:true,forwardReminders:true});
function normalizeWeixin(input={}){const d=defaultWeixin();for(const key of Object.keys(d))if(input[key]!==undefined){if(typeof input[key]!=='boolean')throw new Error('微信选项格式无效');d[key]=input[key];}return d;}
function normalizeFeishu(input={}){
 const d=defaultFeishu();for(const key of Object.keys(d))if(input[key]!==undefined)d[key]=input[key];
 if(typeof d.appId!=='string'||d.appId.length>100||d.appId&&!/^cli_[A-Za-z0-9_-]+$/.test(d.appId.trim()))throw new Error('App ID 通常以 cli_ 开头，请从飞书应用的凭证页面复制');
 d.appId=d.appId.trim();if(!['feishu','lark'].includes(d.domain))throw new Error('请选择飞书或 Lark');
 if(typeof d.reminderTemplate!=='string'||d.reminderTemplate.length>500||!d.reminderTemplate.includes('{称呼}')||!d.reminderTemplate.includes('{事项}'))throw new Error('提醒用语需包含 {称呼} 和 {事项}，最多 500 字');
 for(const key of ['autoConnect','forwardReminders','respectProxyEnv'])if(typeof d[key]!=='boolean')throw new Error('飞书选项格式无效');
 return d;
}
const scopeOf=config=>crypto.createHash('sha256').update(config.domain+':'+config.appId).digest('hex');
module.exports={defaultFeishu,normalizeFeishu,scopeOf,defaultWeixin,normalizeWeixin};
