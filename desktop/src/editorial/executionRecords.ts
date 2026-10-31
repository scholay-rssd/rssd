import { trKey } from "../trKey";
type Entry={id:string;role:string;text:string;turnId?:string;finished?:boolean;status?:string;stageLabel?:string;tool?:{status?:string;title?:string};entries?:{status:string;content?:string}[]};
export type RunTone='running'|'ok'|'error'|'stopped';
export function executionRecords<T extends Entry>(history:T[],busy:boolean,currentTurnId?:string){
 const groups:{id:string;label:string;messages:T[];active:boolean;status:string;tone:RunTone;tools:number;changes:number;preview:string}[]=[],byId=new Map<string,typeof groups[number]>();
 let current:typeof groups[number]|undefined;
 for(const m of history){
  const id=m.turnId||(m.role==='user'?m.id:current?.id)||'history';
  let group=byId.get(id);
  if(!group){group={id,label:m.stageLabel||(m.role==='user'?m.text.split('\n')[0]:trKey('执行记录')),messages:[],active:false,status:'',tone:'ok',tools:0,changes:0,preview:''};groups.push(group);byId.set(id,group);}
  current=group;group.messages.push(m);
 }
 for(const group of groups){
  const end=[...group.messages].reverse().find(m=>m.role==='turn');
  group.active=!end&&busy&&(currentTurnId?group.id===currentTurnId:group===groups.at(-1)&&group.messages.some(m=>!m.finished));
  group.status=group.active?trKey('执行中'):end?.status||trKey('已中断');
  group.tone=group.active?'running':/失败|异常|错误|超时/.test(group.status)?'error':/停止|中断/.test(group.status)?'stopped':'ok';
  group.tools=group.messages.filter(m=>m.role==='tool').length;group.changes=group.messages.filter(m=>m.role==='change').length;
  group.preview=([...group.messages].reverse().find(m=>m.role==='assistant'&&m.text.trim())?.text.split('\n').map(l=>l.replace(/^[#>*\-\s]+/,'').trim()).find(Boolean)||'').slice(0,70);
  if(!group.active)group.messages=group.messages.map(m=>({...m,finished:true,...(m.tool&&(!m.tool.status||['pending','in_progress'].includes(m.tool.status))?{tool:{...m.tool,status:group.status==='已停止'?'cancelled':'interrupted'}}:{}),...(m.entries?{entries:m.entries.map(e=>e.status==='completed'?e:{...e,status:'interrupted'})}:{})}));
 }
 return groups;
}

/** Progress of the latest run: the agent's own plan when it has one, otherwise a count of finished tool steps. */
export function agentProgress<T extends Entry>(history:T[],busy:boolean,currentTurnId?:string){
 const groups=executionRecords(history,busy,currentTurnId),group=groups.find(g=>g.active)||groups.at(-1);
 if(!group)return {done:0,total:0,determinate:false,label:''};
 const plan=[...group.messages].reverse().find(m=>m.role==='plan'&&m.entries?.length);
 if(plan?.entries){const total=plan.entries.length,done=plan.entries.filter(e=>e.status==='completed').length;return {done,total,determinate:true,label:plan.entries.find(e=>e.status==='in_progress')?.content||''};}
 const tools=group.messages.filter(m=>m.role==='tool');
 return {done:tools.filter(t=>t.tool?.status==='completed').length,total:0,determinate:false,label:tools.find(t=>t.tool?.status==='in_progress')?.tool?.title||''};
}
