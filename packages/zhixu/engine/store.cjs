'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const {emptyState,validate,validId,hash,diffStates} = require('./data.cjs');
const {ensureAgentSchema}=require('./agent-schema.cjs');
class Store extends EventEmitter {
  constructor(filename){
    super();if(filename!==':memory:')fs.mkdirSync(path.dirname(filename),{recursive:true});this.db=new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS records(key TEXT PRIMARY KEY,kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT,version INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,digest TEXT NOT NULL,result TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS notices(id TEXT PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,task_id TEXT,at INTEGER NOT NULL,state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,name TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,last_seen TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS pair_codes(digest TEXT PRIMARY KEY,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,filename TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS gateway_inbox(id TEXT PRIMARY KEY,scope TEXT NOT NULL,sender_id TEXT NOT NULL,chat_id TEXT NOT NULL,text TEXT NOT NULL,state TEXT NOT NULL,request_id TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS gateway_outbox(id TEXT PRIMARY KEY,scope TEXT NOT NULL,owner_id TEXT NOT NULL,chat_id TEXT NOT NULL,kind TEXT NOT NULL,task_id TEXT,content TEXT NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,error TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS gateway_outbox_pending ON gateway_outbox(scope,state,next_at);
      CREATE INDEX IF NOT EXISTS records_kind ON records(kind,deleted);`);
    if(!this.db.prepare('SELECT value FROM metadata WHERE key=?').get('sequence'))this.db.prepare('INSERT INTO metadata VALUES(?,?)').run('sequence','0');
    // 增量建表：Agent 接口 / 工具连接 / 每日新闻（幂等，老库只加不删，spec §12）
    ensureAgentSchema(this.db);
    if(!this.db.prepare('SELECT key FROM records WHERE key=?').get('settings:shared'))this.db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?,?)').run('settings:shared','settings','shared',JSON.stringify(emptyState().settings),1,0,new Date().toISOString());
    const previous=this.snapshot();
    if(previous.settings.model?.engine==='hermes'||previous.settings.model?.rootPath!==undefined){
      const next=structuredClone(previous);next.settings.model=emptyState().settings.model;
      this.save(previous,next,'migration:standalone-model-v2');
    }
    this.db.prepare('DELETE FROM metadata WHERE key=?').run('hermesHistory');
  }
  snapshot(){const state=emptyState();state.sequence=Number(this.db.prepare('SELECT value FROM metadata WHERE key=?').get('sequence').value);for(const row of this.db.prepare('SELECT * FROM records ORDER BY updated_at,key').all()){state._versions[row.key]=row.version;if(row.deleted)continue;const data=JSON.parse(row.data);if(row.kind==='settings'){delete data.id;state.settings={...state.settings,...data};}else state[row.kind].push(data);}return state;}
  /* patch()：契约
     入参：request{operationId,changes[]}、可选 onCommit()（在 COMMIT 之前、记录写入之后执行）
     返回：{ok:true,state} 或 {ok:false,conflicts,state}
     副作用：写 records + operations + sequence，单个 BEGIN IMMEDIATE 事务；emit('change')
     谁调用：save()、桌面 store:commit、agent-service.writeRecords()
     改动影响：onCommit 是给「对外 Agent 写入收据」用的——收据必须和记录同事务提交，
       否则进程在提交边界退出会出现「记录写了但收据没写」的半截状态（spec §6.4）。
       ⚠️ onCommit 抛错会整体 ROLLBACK，这是刻意的：收据写不进去就不该落记录。 */
  patch(request,onCommit){
    if(!validId(request.operationId)||!Array.isArray(request.changes)||request.changes.length>10000)throw new Error('同步请求无效或过大');
    const digest=hash(JSON.stringify(request.changes)),previous=this.db.prepare('SELECT * FROM operations WHERE id=?').get(request.operationId);
    if(previous){if(previous.digest!==digest)throw new Error('同一请求标识不能用于不同修改');return {ok:true,replayed:true,state:this.snapshot()};}
    const keys=new Set(),validated=[];
    for(const c of request.changes){const key=`${c.kind}:${c.id}`;if(keys.has(key)||!validId(c.id)||!Number.isInteger(c.beforeVersion)||c.beforeVersion<0)throw new Error('修改记录或版本无效');keys.add(key);if(c.kind==='settings'&&c.data===null)throw new Error('设置不可删除');if(c.data===null&&!['tasks','events','notes','docs','messages'].includes(c.kind))throw new Error('记录类型无效');validated.push({...c,key,data:c.data===null?null:validate(c.kind,c.id,c.data)});}
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const conflicts=[];
      for(const c of validated){const current=this.db.prepare('SELECT * FROM records WHERE key=?').get(c.key);if((current?.version||0)!==c.beforeVersion)conflicts.push({kind:c.kind,id:c.id,version:current?.version||0,data:current&&!current.deleted?JSON.parse(current.data):null,local:c.data});}
      if(conflicts.length){this.db.exec('ROLLBACK');return {ok:false,conflicts,state:this.snapshot()};}
      const upsert=this.db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data,version=excluded.version,deleted=excluded.deleted,updated_at=excluded.updated_at');
      const now=new Date().toISOString();for(const c of validated)upsert.run(c.key,c.kind,c.id,c.data===null?null:JSON.stringify(c.data),c.beforeVersion+1,c.data===null?1:0,now);
      const sequence=Number(this.db.prepare('SELECT value FROM metadata WHERE key=?').get('sequence').value)+1;
      this.db.prepare('UPDATE metadata SET value=? WHERE key=?').run(String(sequence),'sequence');
      this.db.prepare('INSERT INTO operations VALUES(?,?,?,?)').run(request.operationId,digest,JSON.stringify({sequence}),now);if(onCommit)onCommit();this.db.exec('COMMIT');
      const state=this.snapshot();this.emit('change',state);return {ok:true,state};
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  save(before,after,operationId){return this.patch({operationId,changes:diffStates(before,after)});}
  get(kind,id){const row=this.db.prepare('SELECT * FROM records WHERE key=? AND deleted=0').get(`${kind}:${id}`);return row?{data:JSON.parse(row.data),version:row.version}:null;}
  schedulingState(){const state={tasks:[],events:[],settings:emptyState().settings};for(const row of this.db.prepare("SELECT kind,data FROM records WHERE deleted=0 AND kind IN ('tasks','events','settings')").all()){const data=JSON.parse(row.data);if(row.kind==='settings')state.settings={...state.settings,...data};else state[row.kind].push(data);}return state;}
  notices(){return this.db.prepare('SELECT id,title,body,task_id AS taskId,at,state FROM notices ORDER BY at DESC LIMIT 100').all();}
  notice(id,title,body,taskId,at){return this.db.prepare('INSERT OR IGNORE INTO notices VALUES(?,?,?,?,?,?)').run(id,title,body,taskId||null,at,'new').changes>0;}
  acknowledge(id){this.db.prepare('UPDATE notices SET state=? WHERE id=?').run('read',id);}
  /* 删除收件箱记录：只删送达记录本身（硬删，通知是日志不是账本，无软删机制）；
     任务/日程本体与未来的重复提醒一概不碰——0.7.4 收件箱删除按钮用 */
  deleteNotice(id){return this.db.prepare('DELETE FROM notices WHERE id=?').run(id).changes>0;}
  close(){this.db.close();}
}
module.exports={Store};
