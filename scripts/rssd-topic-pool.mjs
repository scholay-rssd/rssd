// Fill the topic pool: queue many write demands whose topics were chosen ahead of time. A pool topic is
// a title and a brief, with no sources yet; whoever claims it does the sourcing when writing. The
// Center decides whether a topic repeats a work or an open demand of its section, so this module sends
// each topic once and reports what the Center said. It keeps no local state: a topic's identity comes
// from its section and title, so sending the same list again creates nothing new.
import protocol from '../contracts/rssd-v1.cjs';
import {normalizeTitle} from '../contracts/topic-repeat.mjs';
import {sectionWorkPolicy} from '../contracts/work-types.mjs';
import {sectionsForSite} from '../contracts/site-sections.mjs';

export const MAX_POOL_BATCH=1000;
const KEYS=['title','brief','workType','topicKey','lead','priority','requiredLocales','adaptedFrom','voice'];

/** What a section takes, from the site profiles: {workTypes, defaultType, articleCards}. */
export function poolSectionPolicy(profiles,workspaceId,sectionId){
 const site=(Array.isArray(profiles)?profiles:[]).find(s=>s?.spaceId===workspaceId);
 if(!site)throw Error('Unknown workspace: '+workspaceId);
 const section=sectionsForSite(site).find(s=>s?.id===sectionId);
 if(!section)throw Error('Unknown section: '+workspaceId+'/'+sectionId);
 if(section.enabled===false||section.writable===false)throw Error('Section does not take new works: '+workspaceId+'/'+sectionId);
 return sectionWorkPolicy(section);
}

/** The demand of one pool topic. Its identity is its section and normalized title. Without `requiredLocales`
 * it asks for the protocol's default editions, Chinese and English. */
export function poolDemand(topic,{workspaceId,sectionId,policy,requiredLocales}){
 if(!topic||typeof topic!=='object'||Array.isArray(topic))throw Error('A pool topic is an object');
 const unknown=Object.keys(topic).filter(key=>!KEYS.includes(key));if(unknown.length)throw Error('Unknown pool topic field: '+unknown.join(', '));
 if(typeof topic.title!=='string'||!normalizeTitle(topic.title))throw Error('A pool topic needs a title');
 if(typeof topic.brief!=='string'||!topic.brief.trim())throw Error('A pool topic needs a brief');
 if(topic.workType!=null&&policy&&!policy.workTypes.includes(topic.workType))throw Error('This section does not take '+topic.workType+' works');
 const id='pool-'+protocol.hash([workspaceId,sectionId,normalizeTitle(topic.title)]).slice(0,40);
 return protocol.demand({id,workspaceId,sectionId,kind:'write',title:topic.title.trim(),brief:topic.brief.trim(),requiredLocales:topic.requiredLocales||requiredLocales,
  priority:topic.priority??0,...(topic.workType!=null?{workType:topic.workType}:{}),...(topic.adaptedFrom!=null?{adaptedFrom:topic.adaptedFrom}:{}),
  ...(topic.topicKey!=null?{topicKey:topic.topicKey}:{}),...(topic.lead!=null?{lead:topic.lead}:{}),...(topic.voice!=null?{voice:topic.voice}:{})});
}

const sameDemand=(row,demand)=>{try{return protocol.canonical(protocol.demand(row.payload))===protocol.canonical(demand);}catch{return false;}};

/**
 * Queue `topics` in one section. Returns one result per topic, in order:
 * created, existing (the same topic was queued before), repeat (the Center refused it and says what it
 * repeats), conflict (the identity exists with other content), invalid (never sent) or planned (dry run).
 * A failure that is none of these stops the batch: what was reported before it stands, and the same list
 * can be sent again.
 */
export async function fillTopicPool({client,workspaceId,sectionId,topics,policy,requiredLocales,dryRun=false}){
 protocol.id(workspaceId,'workspaceId');protocol.id(sectionId,'sectionId');
 if(!Array.isArray(topics)||!topics.length||topics.length>MAX_POOL_BATCH)throw Error('A pool batch has 1 to '+MAX_POOL_BATCH+' topics');
 if(!dryRun&&(!client||typeof client.createDemand!=='function'||typeof client.demands!=='function'))throw Error('A Center client is required');
 const results=[],sent=new Set();
 for(const topic of topics){
  let demand;
  try{demand=poolDemand(topic,{workspaceId,sectionId,policy,requiredLocales});}
  catch(error){results.push({state:'invalid',title:typeof topic?.title==='string'?topic.title:null,reason:error.message});continue;}
  const entry={id:demand.id,title:demand.title};
  if(sent.has(demand.id)){results.push({...entry,state:'existing',reason:'listed twice in this batch'});continue;}
  sent.add(demand.id);
  if(dryRun){results.push({...entry,state:'planned',demand});continue;}
  try{await client.createDemand(demand);results.push({...entry,state:'created'});}
  catch(error){
   if(error?.status!==409)throw error;
   if(error.code==='topic_repeat'){results.push({...entry,state:'repeat',reason:String(error.message||'').slice(0,500)});continue;}
   if(error.code!=='identity_conflict')throw error;
   // The identity exists: the same topic sent before, or another title that normalizes to it.
   const found=(await client.demands({workspaceId,sectionId,search:demand.title,limit:200})).find(row=>row.id===demand.id);
   results.push(found&&sameDemand(found,demand)?{...entry,state:'existing',demandState:found.state}:{...entry,state:'conflict',reason:'This identity is already queued with other content'});
  }
 }
 return results;
}

/** Counts per state, for a one-line summary. */
export function poolSummary(results){
 const summary={};for(const result of results)summary[result.state]=(summary[result.state]||0)+1;return summary;
}
