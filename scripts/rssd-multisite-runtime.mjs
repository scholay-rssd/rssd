// Explicitly assembled runtime. Importing this module never starts a worker.
import {ARTICLE_WRITING_INSTRUCTIONS} from '../contracts/article-writing-policy.mjs';
import {fetchSectionRssLeads} from './rssd-topic-rss.mjs';
import {fetchPublicText} from './rssd-topic-public.mjs';
import {codexTopicGenerator,codexTopicJudge,codexSourceJudge} from './rssd-topic-codex.mjs';
import {createPublicHistoryAdapter} from './rssd-topic-history.mjs';
import {createMultisiteCenterAdapter,createMigrationProofAdapter} from './rssd-multisite-adapter.mjs';
import {createScopedWorkModeAdapter,createWorkRecoveryAdapter} from './rssd-multisite-work-mode.mjs';
import {createCursorGalleryImageStageFactory} from './rssd-cursor-gallery-image-stage.mjs';
import {runMultisiteSupervisor} from './rssd-multisite-supervisor.mjs';
import {createPublicationReadbackAdapter} from './rssd-publication-readback.mjs';
import {editorialContract} from './rssd-editorial-contract.mjs';
import {withFileLock} from './editorial-lock.mjs';
import {join} from 'node:path';

const stop=signal=>{if(signal?.aborted)throw Object.assign(Error('Runtime cancelled'),{name:'AbortError'});};
const plain=text=>text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();

export function createConfiguredTopicAdapters({catalog,organizations,sourceStage,requireSourceStage=false,fetchLeads=fetchSectionRssLeads,fetchPage=fetchPublicText,generateTopics=codexTopicGenerator({writingPolicy:ARTICLE_WRITING_INSTRUCTIONS}),judgeTopic=codexTopicJudge(),judgeSource=codexSourceJudge()}={}){
 if(!catalog||!organizations||![fetchLeads,fetchPage,generateTopics,judgeTopic,judgeSource].every(x=>typeof x==='function'))throw Error('Trusted RSS catalog and editorial adapters are required');
 const permitted=async(url,slot)=>{if(!requireSourceStage)return true;if(typeof sourceStage?.acceptCandidate!=='function')throw Error('Trusted source range is not configured');return (await sourceStage.acceptCandidate({url,slot}))===true;};
 const sourceLeads=async({slot,signal})=>{stop(signal);const organization=organizations[slot.siteId];if(organization?.siteId!==slot.siteId)throw Error('Site RSS organization missing');const result=await fetchLeads({catalog,organization,policy:{siteId:slot.siteId,sectionId:slot.sectionId,enabled:true}});stop(signal);if(!requireSourceStage)return result;const leads=[];for(const lead of result?.leads||[])if(await permitted(lead.url,slot))leads.push(lead);return {...result,leads};};
 const page=async(url,slot,signal)=>{stop(signal);let result;if(requireSourceStage){if(typeof sourceStage?.readForTopic!=='function')throw Error('Trusted source access verifier is not configured');result=await sourceStage.readForTopic({url,slot,signal});}else{result=await fetchPage(url,{timeoutMs:12000,maxBytes:1024*1024,maxRedirects:2});if(!result?.reachable||result.originalUrl!==url||result.finalUrl!==url)throw Error('Original source unavailable or redirected');}stop(signal);if(typeof result?.text!=='string')throw Error('Original source unavailable');const text=plain(result.text);if(text.length<100)throw Error('Original source has insufficient readable text');return {text,textSha256:result.textSha256};};
 const generate=async({slot,leads,existingTitles,signal})=>{
  const seeds=[];for(const lead of leads.slice(0,5)){try{if(!await permitted(lead.url,slot))continue;const {text}=await page(lead.url,slot,signal);seeds.push({title:lead.title,url:lead.url,excerpt:text.slice(0,4000)});}catch(error){if(signal?.aborted)throw error;}}
  if(!seeds.length)throw Error('No readable original sources');const proposals=await generateTopics({workspaceId:slot.workspaceId,sectionId:slot.sectionId,count:1,existingTitles,sourceSeeds:seeds,editorialInstructions:editorialContract(slot),signal});if(!Array.isArray(proposals)||!proposals.length)throw Error('No verified topic proposal');return proposals[0];
 };
 const judge=({candidate,existingTitles,signal})=>judgeTopic({topic:candidate,existingTitles,signal});
 const verifySource=async({slot,source,candidate,signal})=>{if(!await permitted(source.url,slot))throw Error('Source is outside trusted range');const {text,textSha256}=await page(source.url,slot,signal),verdict=await judgeSource({topic:candidate,source,pageText:text,signal});return {url:source.url,verified:verdict?.primarySource===true&&verdict?.confidence==='high',supportsTopic:verdict?.supportsTopic===true&&verdict?.confidence==='high',excerpt:text.slice(0,4000),...(requireSourceStage?{textSha256}:{})};};
 return {sourceLeads,generate,judge,verifySource};
}

/** Configuration and all dependencies are supplied by the trusted caller.
 * Explicit enabled:true is required; dry/default invocation has no effects. */
export async function runConfiguredMultisite({enabled=false,client,connection,home,plan,configs,profiles,catalog,organizations,writerProof,imageRuntime,sourceStage,signal,onEvent,onLockAcquired=()=>{},overrides={}}={}){
 if(enabled!==true)return {state:'disabled'};
 if(typeof writerProof!=='function')throw Error('Fresh live writer proof executor is required');
 const topic=createConfiguredTopicAdapters({catalog,organizations,...overrides.topic,sourceStage,requireSourceStage:true});
 const adapter=createMultisiteCenterAdapter({client,connection,profiles,writerProof,migrationProof:createMigrationProofAdapter({client}),publicCatalog:overrides.publicCatalog||createPublicHistoryAdapter({concurrency:3,maxDurationMs:300000}),...topic,sourceStage,requireSourceStage:true});
 const imageStageFactory=imageRuntime?createCursorGalleryImageStageFactory({client,home,...imageRuntime}):undefined;
 const scopedWork=createScopedWorkModeAdapter({client,home,plan,configs,profiles,ready:adapter.ready,...overrides.work,...(imageStageFactory?{imageStageFactory}:{}),sourceStage,daemonLockHeld:true});
 const reconcileWork=createWorkRecoveryAdapter({client,home,lookup:adapter.lookup,daemonLockHeld:true});
 const inspectPublication=createPublicationReadbackAdapter({client,profiles,...overrides.publication});
 return withFileLock(join(home,'daemon.lock'),async()=>{
  await onLockAcquired();let heartbeatState='idle',inFlight=false;
  const emit=event=>{if(event.type==='work'&&!inFlight)heartbeatState=event.state==='blocked'||event.state==='uncertain'?'blocked':'idle';onEvent?.(event);};
  const pulse=()=>client.heartbeat({state:heartbeatState,agentId:'codex',message:inFlight?'多站文章生产中':heartbeatState==='blocked'?'原任务需要核对':'多站排程在线'}).catch(()=>emit({type:'heartbeat',state:'pending',reason:'center_unavailable'}));
  const runWork=async args=>{inFlight=true;heartbeatState='running';emit({type:'work',state:'running',id:args.slot.id});await pulse();try{return await scopedWork(args);}finally{inFlight=false;heartbeatState='idle';}};
  await pulse();const timer=setInterval(pulse,30000);timer.unref?.();
  try{return await runMultisiteSupervisor({enabled:true,client,connection,home,plan,configs,profiles,adapter,runWork,reconcileWork,inspectPublication,signal,onEvent:emit,...overrides.supervisor});}
  finally{clearInterval(timer);}
 },{timeout:100});
}
