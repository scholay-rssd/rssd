import {useEffect,useRef,useState} from 'react';
import {listen} from '@tauri-apps/api/event';
import {invoke,isTauri} from '../lib/nativeCore';
import {mergeQueueJobs,queueCounts,queueState,type BackgroundJob} from '../lib/backgroundQueue';
import {useUi} from '../store';
import Icon from './Icon';
import {tr} from '../uiText';
import './background-queue.css';

export default function BackgroundQueue(){
 const [open,setOpen]=useState(false),[jobs,setJobs]=useState<BackgroundJob[]>([]),[error,setError]=useState('');
 const [selected,setSelected]=useState('');
 const [resumeAttention,setResumeAttention]=useState(0);
 const refreshRef=useRef<()=>void>(()=>{});
 const [loading,setLoading]=useState(false);
 useEffect(()=>{
  if(!isTauri())return;
  let disposed=false,polling=false,timer:ReturnType<typeof setTimeout>|undefined,debounce:ReturnType<typeof setTimeout>|undefined;const offs:(()=>void)[]=[];
  const refresh=async()=>{
   if(polling||disposed)return;polling=true;
   const result=await Promise.allSettled([
    invoke<{jobs:BackgroundJob[]}>('cursor_agent_call',{method:'queue_status',params:{}}),
    invoke<{jobs:BackgroundJob[]}>('website_publish_call',{method:'queue_status',params:{}}),
   ]);
   if(!disposed){
    const authoring=result[0].status==='fulfilled'?result[0].value.jobs:undefined;
    const publication=result[1].status==='fulfilled'?result[1].value.jobs:undefined;
    setJobs(old=>mergeQueueJobs(authoring||old.filter(job=>job.source==='authoring'),publication?.map(job=>({...job,source:job.source||'publication'}))||old.filter(job=>job.source!=='authoring')));
    setError(result.some(item=>item.status==='rejected')?tr('部分任务状态暂时无法读取，已保留上次记录。'):'');
    setLoading(false);timer=setTimeout(()=>void refresh(),30_000);
   }
   polling=false;
  };
  const schedule=()=>{clearTimeout(debounce);debounce=setTimeout(()=>{clearTimeout(timer);void refresh();},250);};
  const resume=()=>{void invoke<{started?:boolean;resumed?:number;attention?:number}>('website_publish_call',{method:'queue_resume_pending',params:{}}).then(result=>{if(!disposed){if(result.attention!==undefined)setResumeAttention(result.attention);if(result.started&&(result.resumed||0)>0)schedule();}}).catch(()=>{});};
  const focused=()=>{schedule();resume();};
  refreshRef.current=schedule;setLoading(true);void refresh();resume();
  const resumeTimer=setInterval(resume,60_000);
  for(const event of ['background-task-event','website-publication-event'])void listen(event,schedule).then(off=>{if(!disposed)offs.push(off);else off();}).catch(()=>{});
  window.addEventListener('focus',focused);window.addEventListener('scholay-background-queue-changed',schedule);
  return()=>{disposed=true;clearTimeout(timer);clearTimeout(debounce);clearInterval(resumeTimer);offs.forEach(off=>off());window.removeEventListener('focus',focused);window.removeEventListener('scholay-background-queue-changed',schedule);};
 },[]);
 // Native article webviews must yield while the drawer covers their region.
 useEffect(()=>{if(open)useUi.getState().setModalOpen(true);return()=>{if(open)useUi.getState().setModalOpen(false);};},[open]);
 useEffect(()=>{if(!open)return;const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();setOpen(false);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[open]);
 const counts=queueCounts(jobs),detail=jobs.find(job=>job.id===selected),labels={queued:tr('等待处理'),running:tr('正在处理'),attention:tr('需处理'),complete:tr('已完成')};
 return <div className={'background-queue'+(open?' is-open':'')}>
  {open&&<section id="background-task-drawer" className="background-task-drawer" aria-label={tr('后台任务队列')}>
   <header><strong>{tr('后台任务')}</strong><span>{tr('本地与云端进度')}</span><button type="button" onClick={()=>refreshRef.current()} aria-label={tr('刷新任务状态')}><Icon name="refresh" size={14}/></button><button type="button" onClick={()=>setOpen(false)} aria-label={tr('收起任务队列')}><Icon name="x" size={15}/></button></header>
   {error&&<p className="background-queue-error" role="status">{error}</p>}
   {resumeAttention>0&&<p className="background-queue-error" role="status">{tr('{{count}} 个后台任务等待可用的官网凭证或连接；原请求已保留。',{count:resumeAttention})}</p>}
   {!jobs.length?<p className="background-queue-empty">{loading?tr('正在读取任务…'):tr('暂无后台任务。生成或推送后可在这里查看进度。')}</p>:<div className="background-queue-list">
    {jobs.slice(0,60).map(job=><button type="button" key={[job.spaceId,job.source,job.id].join(':')} className={'background-queue-item'+(detail===job?' is-selected':'')} onClick={()=>setSelected(selected===job.id?'':job.id)} aria-expanded={detail===job}>
     <span className={'background-queue-dot '+queueState(job)}/><span className="background-queue-title"><strong>{job.title||tr('发布任务')}</strong><span>{job.spaceName||job.siteId||tr('当前空间')} · {job.phase||labels[queueState(job)]}</span></span><span className="background-queue-state">{labels[queueState(job)]}</span>
    </button>)}
   </div>}
   {detail&&<div className="background-queue-detail" role="status"><strong>{detail.title}</strong><p>{detail.error||detail.phase||labels[queueState(detail)]}</p>{detail.source==='authoring'&&queueState(detail)==='attention'&&<p>{tr('请回到此创作空间查看执行记录或确认卡；中断的智能体操作不会自动重复。')}</p>}{detail.requestKey&&<small>{tr('沿用原发布请求查询与恢复，避免重复发布。')}</small>}</div>}
   <footer>{tr('退出应用后本地写作暂停；云端已接收的任务继续运行。')}</footer>
  </section>}
  <button type="button" className="background-queue-toggle" aria-expanded={open} aria-controls="background-task-drawer" onClick={()=>{setOpen(value=>!value);refreshRef.current();}}>
   <Icon name="list" size={14}/><strong>{tr('后台任务')}</strong><span>{tr('{{count}} 正在处理',{count:counts.running})}</span><span>{tr('{{count}} 等待',{count:counts.queued})}</span>{counts.attention+resumeAttention>0&&<span className="background-queue-attention">{tr('{{count}} 需处理',{count:counts.attention+resumeAttention})}</span>}<span className="background-queue-toggle-end">{open?tr('收起'):tr('查看队列')}<Icon name="chevron-right" className={open?'queue-chevron-open':'queue-chevron-closed'} size={13}/></span>
  </button>
 </div>;
}
