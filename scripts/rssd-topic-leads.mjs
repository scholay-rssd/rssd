// Topic leads from the hot boards the Center collects (the labels ledger, read as "signals").
// A lead is a term people are searching or talking about. It suggests a topic and nothing more:
// it is not a fact, not a source, and never enters an article's references. This module only
// reads; it creates no demand.
import protocol from '../contracts/rssd-v1.cjs';
import {loadSignals} from '../desktop/scripts/agent/resources/signals.mjs';

const clean=value=>typeof value==='string'?value.normalize('NFKC').replace(/\s+/g,' ').trim():'';
const https=value=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}};

/**
 * Flatten loaded signals into leads, newest observation first and by rank within one observation.
 * `platformId` keeps one platform; `query` keeps terms that contain it; a term is listed once per
 * platform. Each lead has the shape a demand records: {provider, platformId, term, observedAt, url?},
 * plus `rank` for whoever chooses among them.
 */
export function signalLeads(loaded,{platformId,query,limit=50}={}){
 if(!loaded?.configured)throw Object.assign(Error(loaded?.reason||'热榜未配置'),{code:'signals_unavailable'});
 if(!Number.isSafeInteger(limit)||limit<1||limit>500)throw Error('Lead limit must be between 1 and 500');
 const wanted=clean(query).toLowerCase(),seen=new Set(),leads=[];
 const items=[...(Array.isArray(loaded.items)?loaded.items:[])].filter(item=>item&&Number.isFinite(Date.parse(item.observedAt||''))).sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt));
 for(const item of items){
  if(platformId&&item.platformId!==platformId)continue;
  const rows=Array.isArray(item.rows)&&item.rows.length?item.rows:[{term:item.term,rank:1}];
  for(const row of [...rows].sort((a,b)=>(a.rank??Infinity)-(b.rank??Infinity))){
   const term=clean(row.term).slice(0,200),key=item.platformId+'\0'+term.toLowerCase();
   if(!term||seen.has(key)||wanted&&!term.toLowerCase().includes(wanted))continue;
   seen.add(key);const url=https(row.url);
   // The same checks a demand applies, so a lead that is listed can always be recorded.
   let lead;try{lead=protocol.demand({workspaceId:'x',sectionId:'x',title:'x',lead:{provider:item.provider||'tikhub',platformId:item.platformId,term,observedAt:item.observedAt,...(url?{url}:{})}}).lead;}catch{continue;}
   leads.push({...lead,...(Number.isSafeInteger(row.rank)?{rank:row.rank}:{})});
   if(leads.length>=limit)return leads;
  }
 }
 return leads;
}

/** Read the configured hot boards and return leads; `load` is injected in tests. */
export async function fetchSignalLeads(options={},{load=loadSignals}={}){
 return signalLeads(await load(),options);
}
