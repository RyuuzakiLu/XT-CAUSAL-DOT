'use strict';
const { reminderOccurrence } = require('./data.cjs');
class Scheduler {
  constructor(store,notify,clock=()=>Date.now()){this.store=store;this.notify=notify;this.clock=clock;this.timer=null;}
  tick(){
    const now=this.clock(),state=this.store.schedulingState();
    for(const task of state.tasks){const at=reminderOccurrence(task,now);if(at===null)continue;const id=`task:${task.id}:${at}`;const latest=this.store.get('tasks',task.id)?.data;if(!latest||['done','canceled'].includes(latest.status)||latest.remindAt!==task.remindAt)continue;
      const body=(now-at>90_000?'错过的提醒：':'')+task.title;
      if(this.store.notice(id,'知序提醒',body,task.id,at))this.notify({id,title:'知序提醒',body,taskId:task.id,at});
    }
    if(state.settings.daily&&(!state.settings.quiet||(new Date(now).getHours()>=8&&new Date(now).getHours()<22))){const day=new Date(now),[h,m]=state.settings.briefTime.split(':').map(Number);const due=new Date(day);due.setHours(h,m,0,0);if(now>=due.getTime()){
      const key=`brief:${day.getFullYear()}-${day.getMonth()+1}-${day.getDate()}`,tasks=state.tasks.filter(t=>!['done','canceled'].includes(t.status)&&t.dueAt&&new Date(t.dueAt).toDateString()===day.toDateString()),events=state.events.filter(e=>new Date(e.start).toDateString()===day.toDateString());
      const body=`今天有 ${tasks.length} 件待办、${events.length} 项日程。`;
      if(this.store.notice(key,'今日安排',body,null,due.getTime()))this.notify({id:key,title:'今日安排',body,at:due.getTime()});
    }}
  }
  start(){this.tick();this.timer=setInterval(()=>{try{this.tick();}catch(error){this.store.emit('scheduler-error',error);}},15000);this.timer.unref();}
  stop(){clearInterval(this.timer);}
}
module.exports={Scheduler};
