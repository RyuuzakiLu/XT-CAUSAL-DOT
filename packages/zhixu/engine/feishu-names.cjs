'use strict';
const cleanName=value=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f<>]/g,'').trim().slice(0,50):'';
const escapeMention=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const defaultReminderTemplate='{称呼}，时间到了，你该{事项}了。';
function nicknameCommand(text){
 const match=text.match(/^\/name(?:\s+(.+))?$/i)||text.match(/^(?:叫我|称呼我|以后(?:请)?叫我|我的称呼是)\s*[:：]?\s*(.*)$/);
 if(/^(?:恢复飞书称呼|清除我的称呼|重置我的称呼)$/.test(text))return {action:'reset'};
 if(!match)return null;
 const value=(match[1]||'').trim();if(!value)return {action:'show'};
 if(/^(?:reset|默认|恢复默认)$/i.test(value))return {action:'reset'};
 if(value.length>40||/[\u0000-\u001f\u007f<>]/.test(value))return {action:'invalid'};
 return {action:'set',name:value};
}
function addressReply(name,text){return name&&!text.startsWith(name)?name+'，'+text:text;}
function reminderLine(template,name,title,missed){
 const line=template.replace(/\{称呼\}|\{事项\}/g,token=>token==='{称呼}'?(name||'你'):title);
 return (missed?'补提醒一下：':'')+line;
}
module.exports={cleanName,escapeMention,nicknameCommand,addressReply,reminderLine,defaultReminderTemplate};
