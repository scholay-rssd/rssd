export type QueueState='queued'|'running'|'attention'|'complete';
export type BackgroundJob={id:string;title:string;articleId?:string;taskId?:string;siteId?:string;spaceId?:string;spaceName?:string;status:string;phase?:string;error?:string;updatedAt?:string;source?:string;requestKey?:string;runId?:string};
export function queueState(job:BackgroundJob):QueueState {
 if(['needs_review','attention','failed','error'].includes(job.status))return 'attention';
 if(job.status==='running')return 'running';
 if(['complete','success','stopped'].includes(job.status))return 'complete';
 return 'queued';
}
export function mergeQueueJobs(...groups:BackgroundJob[][]):BackgroundJob[]{
 const jobs=new Map<string,BackgroundJob>();
 for(const group of groups)for(const job of group){if(!job?.id)continue;const key=[job.spaceId||job.siteId||'',job.source||'publication',job.id].join(':');const old=jobs.get(key);if(!old||(job.updatedAt||'')>=(old.updatedAt||''))jobs.set(key,job);}
 const order:Record<QueueState,number>={attention:0,running:1,queued:2,complete:3};
 return [...jobs.values()].sort((a,b)=>order[queueState(a)]-order[queueState(b)]||(b.updatedAt||'').localeCompare(a.updatedAt||''));
}
export function queueCounts(jobs:BackgroundJob[]):Record<QueueState,number>{
 return jobs.reduce((counts,job)=>{counts[queueState(job)]++;return counts;},{queued:0,running:0,attention:0,complete:0});
}
