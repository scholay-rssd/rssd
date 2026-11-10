// Durable scheduling primitives only: no daemon, credentials, source
// discovery, publication, site cutover or enabled production configuration.
import {mkdir,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import protocol from '../contracts/rssd-v1.cjs';
import {centerOrigin,writeCenterJson} from './rssd-center-client.mjs';
import {withFileLock} from './editorial-lock.mjs';

const ZONE='Asia/Shanghai',timePattern=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
const read=async path=>{try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
const key=(site,section)=>`${site}/${section}`;
const same=(a,b)=>protocol.canonical(a)===protocol.canonical(b);
const millis=value=>{const n=new Date(value).getTime();if(!Number.isFinite(n))throw Error('Invalid scheduler clock');return n;};
// Only recognize bounded operational failures before any demand POST.
// Authentication, bad configuration, malformed evidence and rejected content
// remain blocked for review; do not guess from an arbitrary exception.
function retryablePreparationError(error){
 const code=String(error?.code||'').toUpperCase(),status=Number(error?.status),message=String(error?.message||'');
 return ['NETWORK_ERROR','ECONNRESET','ECONNREFUSED','ETIMEDOUT','EHOSTUNREACH','ENETUNREACH','ENOTFOUND','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT'].includes(code)||status===408||status===429||status>=500&&status<=599||/^(?:DNS resolution timed out|Public source timed out|History collection timed out|Codex topic generation timed out|Codex topic generator could not start|Codex topic generation failed|Writer proof timed out|Writer proof unavailable|Writer proof rejected|No readable original sources|No scoped source leads|Center pagination changed or escaped its workspace|Center inventory changed during collection|Site or Center inventory changed during topic selection|Archive changed during collection|Public history changed during collection)$/.test(message);
}
function localDate(now){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;}
// The verified production plan is modern Asia/Shanghai (UTC+08:00). The
// offset is rechecked through Intl, so a future rule change fails closed.
function localSlot(date,time){const epoch=Date.parse(`${date}T${time}:00+08:00`),p=new Intl.DateTimeFormat('en-GB',{timeZone:ZONE,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(epoch));if(localDate(epoch)!==date||p!==time)throw Error('Shanghai timezone offset changed');return epoch;}
const configHash=c=>protocol.hash({siteId:c.siteId,workspaceId:c.workspaceId,sectionId:c.sectionId,destinationId:c.destinationId,requiredLocales:c.requiredLocales,maxPerDay:c.maxPerDay,maxDelayMinutes:c.maxDelayMinutes,contentMode:c.contentMode,requireFlow:c.requireFlow,editorialRules:c.editorialRules,units:c.units});
function validateEditorialRules(source){
 if(!Array.isArray(source)||source.length>20||source.some(rule=>typeof rule!=='string'||!rule.trim()||rule.length>2000))throw Error('Invalid site editorial rules');
 return source.map(rule=>rule.trim());
}
const siteRules=(snapshot,siteId)=>validateEditorialRules(snapshot.crossSiteEditorialRules?.additionalBySite?.[siteId]??[]);

/** Convert a captured frozen-plan inventory without enabling any section. */
export function normalizeFrozenSchedule(snapshot,{newRules}={}){
 if(snapshot?.version!==1||snapshot.timezone!==ZONE||!Array.isArray(snapshot.sites))throw Error('Invalid frozen schedule inventory');
 const normalized={version:1,timezone:ZONE,sites:snapshot.sites.map(site=>({siteId:protocol.id(site.siteId,'siteId'),sections:(site.sections||[]).map(section=>{
  const sectionId=protocol.id(section.sectionId,'sectionId'),source=section.legacyScheduleFile;
  if(!source||source.scopeBeforeGlobalHold!=='active')return {sectionId,verified:false,editorialRules:siteRules(snapshot,site.siteId)};
  const count=protocol.integer(source.countPerDay,'countPerDay',1,1000),times=protocol.array(source.produceAtLocalAll,'produceAtLocalAll',1000);
  if(times.length!==count||times.some(t=>typeof t!=='string'||!timePattern.test(t))||typeof source.requireEnglish!=='boolean'||typeof source.requireFlow!=='boolean')throw Error('Incomplete active frozen schedule');
  const groups=new Map();for(const time of times)groups.set(time,(groups.get(time)||0)+1);
  return {sectionId,verified:true,dailyLimit:count,contentMode:protocol.id(source.mode,'contentMode'),requireFlow:source.requireFlow,editorialRules:siteRules(snapshot,site.siteId),requiredLocales:source.requireEnglish?['zh-CN','en']:['zh-CN'],slots:[...groups].map(([time,units])=>({id:'time-'+time.replace(':',''),time,count:units}))};
 })}))};
 // Owner-authorized additions are a separate provenance class. They may fill
 // inactive placeholders, never rewrite a previously active legacy schedule.
 if(newRules!==undefined){
  if(newRules?.version!==1||newRules.timezone!==ZONE||!Array.isArray(newRules.sites))throw Error('Invalid new schedule rules');
  const seen=new Set();
  for(const site of newRules.sites){
   const siteId=protocol.id(site.siteId,'siteId'),target=normalized.sites.find(x=>x.siteId===siteId);
   if(!target||!Array.isArray(site.sections))throw Error('New rule site is absent from frozen inventory');
   for(const rule of site.sections){
    const sectionId=protocol.id(rule.sectionId,'sectionId'),k=key(siteId,sectionId),entry=target.sections.find(x=>x.sectionId===sectionId);
    if(seen.has(k)||!entry||entry.verified)throw Error('New rule must uniquely target an inactive section');seen.add(k);
    if(rule.provenance?.kind!=='owner-authorized-new-rule'||typeof rule.provenance.note!=='string'||rule.provenance.note.trim().length<10)throw Error('New rule needs explicit owner authorization provenance');
    const dailyLimit=protocol.integer(rule.dailyLimit,'dailyLimit',1,1000),contentMode=protocol.id(rule.contentMode,'contentMode');
    if(typeof rule.requireFlow!=='boolean')throw Error('New rule needs an explicit flow policy');
    const requiredLocales=protocol.array(rule.requiredLocales,'requiredLocales',2).map(protocol.locale);
    if(!requiredLocales.length||new Set(requiredLocales).size!==requiredLocales.length)throw Error('New rule needs explicit unique languages');
    const slots=protocol.array(rule.slots,'slots',1000),ids=new Set();let units=0;
    for(const item of slots){const id=protocol.id(item?.id,'slotId');if(ids.has(id)||typeof item.time!=='string'||!timePattern.test(item.time))throw Error('Invalid new schedule slot');ids.add(id);units+=protocol.integer(item.count,'slot count',1,1000);}
    if(!slots.length||units!==dailyLimit)throw Error('New rule slot units do not equal daily limit');
    Object.assign(entry,{verified:true,provenance:{kind:'owner-authorized-new-rule',note:rule.provenance.note.trim()},dailyLimit,contentMode,requireFlow:rule.requireFlow,requiredLocales,slots:structuredClone(slots)});
   }
  }
 }
 return normalized;
}

/**
 * Input is a normalized, source-verified plan: each section has
 * {sectionId,verified,dailyLimit,slots:[{id,time,count}]}. Slot counts are
 * expanded into individual work units. Profiles map actual site IDs to Center
 * workspace IDs. Sections are disabled unless independently configured.
 */
export function compileSchedule(plan,configs=[],profiles=[]){
 if(plan?.version!==1||plan.timezone!==ZONE||!Array.isArray(plan.sites)||!Array.isArray(configs)||!Array.isArray(profiles))throw Error('Invalid schedule plan');
 const profileMap=new Map();for(const p of profiles){const id=protocol.id(p.id,'siteId'),space=protocol.id(p.spaceId,'workspaceId');if(profileMap.has(id))throw Error('Duplicate site profile');profileMap.set(id,space);}
 const sections=new Map();
 for(const site of plan.sites){
  const siteId=protocol.id(site.siteId,'siteId');if(!Array.isArray(site.sections))throw Error('Invalid plan sections');
  for(const section of site.sections){
   const sectionId=protocol.id(section.sectionId,'sectionId'),k=key(siteId,sectionId);if(sections.has(k))throw Error('Duplicate plan section');
   sections.set(k,{siteId,sectionId,source:section});
  }
 }
 const result=[],seen=new Set();
 for(const raw of configs){
  if(!raw||typeof raw!=='object'||typeof raw.enabled!=='boolean')throw Error('Invalid section configuration');
  const siteId=protocol.id(raw.siteId,'siteId'),sectionId=protocol.id(raw.sectionId,'sectionId'),k=key(siteId,sectionId),entry=sections.get(k);
  if(seen.has(k))throw Error('Duplicate configured section');seen.add(k);if(!entry)throw Error('Configured section is absent from plan');if(!raw.enabled)continue;
  const source=entry.source;if(raw.verified!==true||source.verified!==true)throw Error('Enabled section lacks verified plan');
  const workspaceId=protocol.id(raw.workspaceId,'workspaceId'),destinationId=protocol.id(raw.destinationId,'destinationId');if(profileMap.get(siteId)!==workspaceId)throw Error('Workspace does not match canonical site profile');
  const requiredLocales=protocol.array(raw.requiredLocales,'requiredLocales',2).map(protocol.locale);if(!requiredLocales.length||new Set(requiredLocales).size!==requiredLocales.length)throw Error('Explicit unique languages are required');
  if(source.requiredLocales!==undefined&&!same([...requiredLocales].sort(),[...protocol.array(source.requiredLocales,'source requiredLocales',2).map(protocol.locale)].sort()))throw Error('Languages differ from verified original schedule');
  const contentMode=source.contentMode===undefined?null:protocol.id(source.contentMode,'contentMode');if(source.requireFlow!==undefined&&typeof source.requireFlow!=='boolean')throw Error('Invalid flow policy');const requireFlow=source.requireFlow??null,editorialRules=validateEditorialRules(source.editorialRules??[]);
  const dailyLimit=protocol.integer(source.dailyLimit,'dailyLimit',1,1000),maxPerDay=protocol.integer(raw.maxPerDay??dailyLimit,'maxPerDay',1,dailyLimit),maxDelayMinutes=protocol.integer(raw.maxDelayMinutes??120,'maxDelayMinutes',1,720);
  if(!Array.isArray(source.slots)||!source.slots.length||source.slots.length>1000)throw Error('Section requires explicit slots');
  const ids=new Set(),units=[];
  for(const item of source.slots){const id=protocol.id(item?.id,'slotId');if(ids.has(id)||typeof item.time!=='string'||!timePattern.test(item.time))throw Error('Invalid or duplicate slot');ids.add(id);const count=protocol.integer(item.count,'slot count',1,1000);for(let index=0;index<count;index++)units.push({sourceSlotId:id,time:item.time,index});}
  if(units.length!==dailyLimit)throw Error('Slot units do not equal verified daily limit');
  units.sort((a,b)=>a.time.localeCompare(b.time)||a.sourceSlotId.localeCompare(b.sourceSlotId)||a.index-b.index);
  const c={siteId,workspaceId,sectionId,destinationId,requiredLocales,maxPerDay,maxDelayMinutes,contentMode,requireFlow,editorialRules,units:units.slice(0,maxPerDay)};result.push({...c,configHash:configHash(c)});
 }
 return result;
}

export function slotsForDay(plan,configs,{profiles=[],now=Date.now()}={}){
 const time=millis(now),date=localDate(time),slots=[];
 for(const section of compileSchedule(plan,configs,profiles))for(const unit of section.units){
  const id='slot-'+protocol.hash([section.siteId,section.sectionId,unit.sourceSlotId,date,unit.index]).slice(0,40);
  slots.push({id,siteId:section.siteId,workspaceId:section.workspaceId,sectionId:section.sectionId,destinationId:section.destinationId,sourceSlotId:unit.sourceSlotId,unit:unit.index,date,time:unit.time,timezone:ZONE,scheduledAt:new Date(localSlot(date,unit.time)).toISOString(),requiredLocales:section.requiredLocales,maxDelayMinutes:section.maxDelayMinutes,contentMode:section.contentMode,requireFlow:section.requireFlow,editorialRules:section.editorialRules,configHash:section.configHash});
 }
 return slots.sort((a,b)=>a.scheduledAt.localeCompare(b.scheduledAt)||a.siteId.localeCompare(b.siteId)||a.sectionId.localeCompare(b.sectionId)||a.unit-b.unit);
}
function validReceipt(row,demand){if(!row||row.id!==demand.id||!row.payload||row.payload.id!==demand.id)return false;try{return same(protocol.demand(row.payload),demand);}catch{return false;}}
function validPublications(slot,value){return Array.isArray(value)&&value.length===slot.requiredLocales.length&&value.every(x=>x&&typeof x.id==='string'&&typeof x.requestId==='string'&&slot.requiredLocales.includes(x.locale)&&Number.isSafeInteger(x.revision)&&x.revision>0&&/^[a-f0-9]{64}$/.test(x.contentHash||''))&&new Set(value.map(x=>x.locale)).size===slot.requiredLocales.length&&new Set(value.map(x=>x.id)).size===value.length;}
function fresh(slot,now){return localDate(now)===slot.date&&now>=Date.parse(slot.scheduledAt)&&now-Date.parse(slot.scheduledAt)<=slot.maxDelayMinutes*60000;}
function validateState(state,binding){
 if(state.version!==1||!same(state.binding,binding)||!Array.isArray(state.entries))throw Error('Scheduler state belongs to another center or device');
 if(state.lastCapturedAt&&!Number.isFinite(Date.parse(state.lastCapturedAt)))throw Error('Invalid scheduler clock state');
 if(state.lastPlanHash!==undefined&&!/^[a-f0-9]{64}$/.test(state.lastPlanHash))throw Error('Invalid schedule observation hash');
 if(state.captureGaps!==undefined&&(!Array.isArray(state.captureGaps)||state.captureGaps.some(g=>!g||!Number.isFinite(Date.parse(g.from))||!Number.isFinite(Date.parse(g.to))||Date.parse(g.from)>=Date.parse(g.to)||!['initial_history_unknown','configuration_history_unknown','offline_interval'].includes(g.kind)||g.previousPlanHash!==null&&!/^[a-f0-9]{64}$/.test(g.previousPlanHash||'')||!/^[a-f0-9]{64}$/.test(g.currentPlanHash||'')||g.potentialUncaptured!==null&&(!Number.isSafeInteger(g.potentialUncaptured)||g.potentialUncaptured<0||!Array.isArray(g.potentialSlots)||g.potentialSlots.length!==g.potentialUncaptured||g.potentialSlots.length>10000)||g.potentialUncaptured!==null&&g.estimateCondition!=='if_plan_remained_enabled_and_unchanged')))throw Error('Invalid capture gap audit');
 for(const g of state.captureGaps||[]){if(g.timezone!==ZONE||g.potentialUncaptured===null&&g.potentialSlots!==undefined)throw Error('Invalid capture gap audit');for(const s of g.potentialSlots||[]){protocol.id(s.siteId);protocol.id(s.sectionId);if(!/^slot-[a-f0-9]{40}$/.test(s.id||'')||!/^[a-f0-9]{64}$/.test(s.configHash||'')||!Number.isFinite(Date.parse(s.scheduledAt))||Date.parse(s.scheduledAt)<=Date.parse(g.from)||Date.parse(s.scheduledAt)>=Date.parse(g.to))throw Error('Invalid potential missed slot');}}
 if(new Set(state.entries.map(e=>e?.slot?.id)).size!==state.entries.length)throw Error('Duplicate saved slot');
 for(const e of state.entries){
  const s=e?.slot;if(!['scheduled','preparing','pending','demand_created','missed','blocked'].includes(e?.status)||!s)throw Error('Invalid saved slot');
  for(const value of [s.siteId,s.workspaceId,s.sectionId,s.destinationId,s.sourceSlotId])protocol.id(value);
  if(typeof s.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s.date)||typeof s.time!=='string'||!timePattern.test(s.time)||s.timezone!==ZONE||!Number.isSafeInteger(s.unit)||s.unit<0||s.unit>999||s.id!=='slot-'+protocol.hash([s.siteId,s.sectionId,s.sourceSlotId,s.date,s.unit]).slice(0,40)||s.scheduledAt!==new Date(localSlot(s.date,s.time)).toISOString()||!/^([a-f0-9]{64})$/.test(s.configHash||''))throw Error('Saved schedule identity changed');
  protocol.integer(s.maxDelayMinutes,'maxDelayMinutes',1,720);const locales=protocol.array(s.requiredLocales,'requiredLocales',2).map(protocol.locale);if(!locales.length||new Set(locales).size!==locales.length)throw Error('Invalid saved languages');
  if(s.contentMode!==null)protocol.id(s.contentMode,'contentMode');if(s.requireFlow!==null&&typeof s.requireFlow!=='boolean')throw Error('Invalid saved flow policy');
  validateEditorialRules(s.editorialRules??[]);
  if(e.lease&&(!['preparing','pending'].includes(e.status)||typeof e.lease.token!=='string'||!e.lease.token||!Number.isFinite(Date.parse(e.lease.until))))throw Error('Invalid saved lease');
  if(e.demand){const d=protocol.demand(e.demand);if(protocol.hash(e.demand)!==e.payloadHash||d.id!==s.id||d.workspaceId!==s.workspaceId||d.sectionId!==s.sectionId||d.kind!=='write'||!same(d.requiredLocales,s.requiredLocales))throw Error('Saved demand identity or payload changed');}
  if(['pending','demand_created'].includes(e.status)&&!e.demand)throw Error('Saved demand is missing');
  if(['scheduled','preparing'].includes(e.status)&&e.demand)throw Error('Unexpected saved demand');
  if(e.work&&(!['running','submitted','blocked','uncertain','expired'].includes(e.work.state)||typeof e.work.token!=='string'||!e.work.token||e.status!=='demand_created'))throw Error('Invalid scheduled work state');
 }
}
async function context({home,connection}){
 if(typeof home!=='string'||!home)throw Error('Private scheduler directory is required');
 const binding={origin:centerOrigin(connection?.origin),orgId:protocol.id(connection?.orgId,'orgId'),workerId:protocol.id(connection?.workerId,'workerId')};
 await mkdir(home,{recursive:true,mode:0o700});return {binding,path:join(home,'multisite-scheduler.json'),lock:join(home,'multisite-scheduler.lock')};
}
async function locked(ctx,fn){return withFileLock(ctx.lock,async()=>{const state=await read(ctx.path)||{version:1,binding:ctx.binding,entries:[],lastCapturedAt:null};validateState(state,ctx.binding);return fn(state,()=>writeCenterJson(ctx.path,state));},{timeout:5000});}

// A last observed plan is not proof that it remained enabled while the process
// was offline. A bounded estimate is explicitly conditional, never a demand,
// and unknown/changed/old configurations are recorded without inferred slots.
function auditGap({from,to,previousPlanHash,currentPlanHash,plan,configs,profiles,entries,kind}){
 const gap={kind,from:new Date(from).toISOString(),to:new Date(to).toISOString(),timezone:ZONE,previousPlanHash:previousPlanHash||null,currentPlanHash,potentialUncaptured:null};
 if(kind!=='offline_interval'||previousPlanHash!==currentPlanHash)return gap;
 const first=localSlot(localDate(from),'00:00'),last=localSlot(localDate(to-1),'00:00'),days=Math.floor((last-first)/86400000)+1;
 if(days>31)return gap;
 const seen=new Set(entries.map(e=>e.slot.id)),potentialSlots=[];let examined=0;
 for(let day=0;day<days;day++){
  const slots=slotsForDay(plan,configs,{profiles,now:first+day*86400000});examined+=slots.length;
  if(examined>10000)return gap;
  for(const slot of slots){const when=millis(slot.scheduledAt);if(when>from&&when<to&&!seen.has(slot.id))potentialSlots.push({id:slot.id,siteId:slot.siteId,sectionId:slot.sectionId,scheduledAt:slot.scheduledAt,configHash:slot.configHash});}
 }
 gap.potentialUncaptured=potentialSlots.length;gap.potentialSlots=potentialSlots;gap.estimateCondition='if_plan_remained_enabled_and_unchanged';return gap;
}

/** Quick independent tick: persist slot metadata only; never calls a model. */
export async function captureScheduleTick({plan,configs=[],profiles=[],connection,home,clock=Date.now,captureWindowMinutes=15,signal}){
 if(typeof clock!=='function'||!Number.isSafeInteger(captureWindowMinutes)||captureWindowMinutes<1||captureWindowMinutes>60)throw Error('Invalid capture window');
 if(signal?.aborted)return {state:'cancelled',captured:[],missed:[]};
 const now=millis(clock()),compiled=compileSchedule(plan,configs,profiles),currentPlanHash=protocol.hash(compiled.map(c=>({siteId:c.siteId,sectionId:c.sectionId,configHash:c.configHash})).sort((a,b)=>key(a.siteId,a.sectionId).localeCompare(key(b.siteId,b.sectionId)))),slots=slotsForDay(plan,configs,{profiles,now}),ctx=await context({home,connection});
 return locked(ctx,async(state,save)=>{
  if(state.lastCapturedAt&&now<millis(state.lastCapturedAt))throw Error('Scheduler clock moved backwards');
  const result={captured:[],missed:[],gaps:[]},previous=state.lastCapturedAt?millis(state.lastCapturedAt):null,dayStart=localSlot(localDate(now),'00:00'),unverifiedHistory=previous===null||!state.lastPlanHash||state.lastPlanHash!==currentPlanHash;
  // Cross-midnight slots are never replayable even within the grace window.
  const coveredFrom=unverifiedHistory?now:Math.max(dayStart,now-captureWindowMinutes*60000),from=previous??dayStart;
  if(from<coveredFrom){
   const kind=previous===null?'initial_history_unknown':!state.lastPlanHash||state.lastPlanHash!==currentPlanHash?'configuration_history_unknown':'offline_interval';
   const gap=auditGap({from,to:coveredFrom,previousPlanHash:state.lastPlanHash,currentPlanHash,plan,configs,profiles,entries:state.entries,kind});
   (state.captureGaps??=[]).push(gap);result.gaps.push(gap);
  }
  for(const entry of state.entries){
   if(['scheduled','preparing'].includes(entry.status)&&!fresh(entry.slot,now)){entry.status='missed';entry.reason='expired';delete entry.lease;entry.updatedAt=new Date(now).toISOString();result.missed.push(entry.slot.id);}
   else if(entry.status==='preparing'&&entry.lease&&now>=millis(entry.lease.until)){entry.status='scheduled';delete entry.lease;}
  }
  for(const slot of slots){
   if(Date.parse(slot.scheduledAt)>now||state.entries.some(e=>e.slot.id===slot.id))continue;
   // Do not invent individual missed orders for times before the current
   // observation window: the enabled configuration then is not provable.
   if(Date.parse(slot.scheduledAt)<coveredFrom)continue;
   const eligible=now-Date.parse(slot.scheduledAt)<=captureWindowMinutes*60000&&fresh(slot,now);
   state.entries.push({slot,status:eligible?'scheduled':'missed',...(eligible?{}:{reason:'capture_window_expired'}),createdAt:new Date(now).toISOString()});
   result[eligible?'captured':'missed'].push(slot.id);
  }
  state.lastPlanHash=currentPlanHash;state.lastCapturedAt=new Date(now).toISOString();await save();return result;
 });
}

/**
 * Claim one durable slot under a local lease; expensive model work runs
 * outside the lock so independent capture ticks continue. lookup must return
 * {state:'found',demand} or {state:'missing',complete:true}. ready must verify
 * current binding, exclusivity, writable workspace, destination and locale.
 */
export async function dispatchScheduledSlot({plan,configs=[],profiles=[],connection,home,lookup,enqueue,prepare,ready,clock=Date.now,leaseMs=1800000,retryMs=60000,signal}){
 if(![lookup,enqueue,prepare,ready,clock].every(x=>typeof x==='function'))throw Error('Scheduler dependencies are required');
 if(signal?.aborted)return {state:'cancelled'};
 protocol.integer(leaseMs,'leaseMs',1000,3600000);protocol.integer(retryMs,'retryMs',1000,3600000);
 const ctx=await context({home,connection}),configsByKey=new Map(compileSchedule(plan,configs,profiles).map(c=>[key(c.siteId,c.sectionId),c])),start=millis(clock()),token=randomUUID();
 const reservation=await locked(ctx,async(state,save)=>{
  if(state.lastCapturedAt&&start<millis(state.lastCapturedAt))throw Error('Scheduler clock moved backwards');
  for(const e of state.entries){if(e.status==='preparing'&&e.lease&&start>=millis(e.lease.until)){e.status=fresh(e.slot,start)?'scheduled':'missed';e.reason=e.status==='missed'?'expired':undefined;delete e.lease;}}
  const candidates=state.entries.filter(e=>['pending','scheduled'].includes(e.status)&&(!e.lease||start>=millis(e.lease.until))&&(!e.retryAt||start>=millis(e.retryAt))&&(e.status==='pending'||!state.entries.some(other=>other!==e&&['pending','preparing','blocked'].includes(other.status)&&key(other.slot.siteId,other.slot.sectionId)===key(e.slot.siteId,e.slot.sectionId)))).sort((a,b)=>(a.status==='pending'?0:1)-(b.status==='pending'?0:1)||a.slot.scheduledAt.localeCompare(b.slot.scheduledAt));
  const entry=candidates[0];if(!entry){await save();return null;}
  if(entry.status==='scheduled'&&!fresh(entry.slot,start)){entry.status='missed';entry.reason='expired';entry.updatedAt=new Date(start).toISOString();await save();return {terminal:'missed',id:entry.slot.id};}
  if(entry.status==='scheduled')entry.status='preparing';entry.lease={token,until:new Date(start+leaseMs).toISOString()};delete entry.retryAt;await save();return structuredClone(entry);
 });
 if(!reservation)return {state:'idle'};if(reservation.terminal)return {state:reservation.terminal,id:reservation.id};
 const slot=reservation.slot,config=configsByKey.get(key(slot.siteId,slot.sectionId));
 const mutate=async fn=>locked(ctx,async(state,save)=>{const e=state.entries.find(x=>x.slot.id===slot.id);if(!e||e.lease?.token!==token)return false;if(await fn(e)===false)return false;await save();return true;});
 const finish=async(status,reason)=>{const now=millis(clock());const ok=await mutate(e=>{e.status=status;e.reason=reason;e.updatedAt=new Date(now).toISOString();delete e.lease;});return {state:ok?status:'lease_lost',id:slot.id,...(reason?{reason}:{})};};
 const defer=async reason=>{const now=millis(clock());const ok=await mutate(e=>{e.status='pending';e.reason=reason;e.retryAt=new Date(now+retryMs).toISOString();delete e.lease;});return {state:ok?'pending':'lease_lost',id:slot.id,reason};};
 const retryPreparation=async reason=>{const now=millis(clock());const current=fresh(slot,now);const ok=await mutate(e=>{if(e.demand)return false;e.status=current?'scheduled':'missed';e.reason=current?reason:'expired';e.updatedAt=new Date(now).toISOString();if(current)e.retryAt=new Date(now+retryMs).toISOString();else delete e.retryAt;delete e.lease;});return {state:ok?(current?'scheduled':'missed'):'lease_lost',id:slot.id,reason:current?reason:'expired'};};
 const sameConfiguration=()=>Boolean(config&&config.configHash===slot.configHash&&config.siteId===slot.siteId&&config.workspaceId===slot.workspaceId&&config.sectionId===slot.sectionId&&config.destinationId===slot.destinationId&&config.maxDelayMinutes===slot.maxDelayMinutes&&config.contentMode===slot.contentMode&&config.requireFlow===slot.requireFlow&&same(config.editorialRules,slot.editorialRules??[])&&same(config.requiredLocales,slot.requiredLocales));
 const readyNow=async()=>sameConfiguration()&&(await ready({slot,config,signal}))?.ready===true;
 let demand=reservation.demand;
 if(!demand){
  try{
   if(signal?.aborted)return finish('scheduled','cancelled');
   if(!fresh(slot,millis(clock())))return finish('missed','expired');
   if(!sameConfiguration())return finish('blocked','configuration_changed');
   if(!await readyNow())return retryPreparation('not_ready');
   const raw=await prepare({slot,config,signal});if(signal?.aborted)return finish('scheduled','cancelled');if(raw?.id!==slot.id)throw Error('Wrong scheduled ID');demand=protocol.demand(raw);
   if(demand.id!==slot.id||demand.workspaceId!==slot.workspaceId||demand.sectionId!==slot.sectionId||demand.kind!=='write'||!same(demand.requiredLocales,slot.requiredLocales))throw Error('Demand is outside authorized slot');
   const staged=await mutate(e=>{if(e.status!=='preparing'||millis(clock())>=millis(e.lease.until))return false;e.demand=demand;e.payloadHash=protocol.hash(demand);e.status='pending';});
   if(!staged)return {state:'lease_lost',id:slot.id};
  }catch(error){return signal?.aborted?finish('scheduled','cancelled'):retryablePreparationError(error)?retryPreparation('prepare_temporarily_unavailable'):finish('blocked','prepare_failed');}
 }
 if(signal?.aborted)return defer('cancelled');
 let found;
 try{found=await lookup(demand.id,{slot,signal});}catch{return defer(signal?.aborted?'cancelled':'lookup_unavailable');}
 if(found?.state==='found')return validReceipt(found.demand,demand)?finish('demand_created','original_found'):finish('blocked','identity_conflict');
 if(found?.state!=='missing'||found.complete!==true)return defer('lookup_uncertain');
 if(!fresh(slot,millis(clock())))return finish('missed','expired_before_submission');
 if(signal?.aborted)return defer('cancelled');
 if(!sameConfiguration())return finish('blocked','configuration_changed');
 try{if(!await readyNow())return defer('not_ready');}catch(error){return retryablePreparationError(error)?defer('readiness_temporarily_unavailable'):finish('blocked','readiness_unavailable');}
 if(!fresh(slot,millis(clock())))return finish('missed','expired_before_submission');
 // Recheck ownership immediately before the side effect. Even if a lease
 // expires at the HTTP boundary, all contenders use the identical durable ID
 // and packet; any conflict is reconciled through lookup on the next attempt.
 const owned=await locked(ctx,async state=>{const e=state.entries.find(x=>x.slot.id===slot.id);return Boolean(e?.lease?.token===token&&millis(clock())<millis(e.lease.until));});
 if(!owned)return {state:'lease_lost',id:slot.id};
 if(signal?.aborted)return defer('cancelled');
 let receipt;try{receipt=await enqueue(demand,{slot,signal});}catch{return defer('submission_uncertain');}
 return validReceipt(receipt,demand)?finish('demand_created','submitted'):finish('blocked','receipt_mismatch');
}

/** Explicitly return a blocked slot to its original identity, never a new one. */
export async function resumeBlockedSlot({plan,configs=[],profiles=[],connection,home,id,clock=Date.now}){
 protocol.id(id,'slotId');if(typeof clock!=='function')throw Error('Scheduler clock is required');
 const ctx=await context({home,connection}),configsByKey=new Map(compileSchedule(plan,configs,profiles).map(c=>[key(c.siteId,c.sectionId),c])),now=millis(clock());
 return locked(ctx,async(state,save)=>{
  if(state.lastCapturedAt&&now<millis(state.lastCapturedAt))throw Error('Scheduler clock moved backwards');
  const e=state.entries.find(x=>x.slot.id===id);if(!e||e.status!=='blocked')throw Error('Slot is not blocked');
  const c=configsByKey.get(key(e.slot.siteId,e.slot.sectionId));if(!c||c.configHash!==e.slot.configHash||c.workspaceId!==e.slot.workspaceId)throw Error('Blocked slot configuration changed or is disabled');
  // A durable pending request remains eligible only for original-ID lookup;
  // dispatch will not submit it if the slot is no longer fresh.
  e.status=e.demand?'pending':fresh(e.slot,now)?'scheduled':'missed';e.reason=e.status==='missed'?'expired':'explicit_resume';e.updatedAt=new Date(now).toISOString();delete e.lease;delete e.retryAt;await save();return {id,state:e.status};
 });
}

/**
 * Execute exactly one Center demand through an injected guarded work-mode
 * runner. A crash leaves `running` for explicit reconciliation; it is never
 * interpreted as successful writing or automatically replaced by a new ID.
 */
export async function runNextScheduledWork({connection,home,runWork,clock=Date.now,signal,workSignal}){
 if(typeof runWork!=='function'||typeof clock!=='function')throw Error('A guarded work-mode runner is required');
 if(signal?.aborted)return {state:'cancelled'};
 const ctx=await context({home,connection}),now=millis(clock()),token=randomUUID();
 const reservation=await locked(ctx,async(state,save)=>{
  if(state.entries.some(e=>e.work&&['running','blocked','uncertain'].includes(e.work.state)))return {busy:true};
  const e=state.entries.filter(x=>x.status==='demand_created'&&!x.work).sort((a,b)=>a.slot.scheduledAt.localeCompare(b.slot.scheduledAt))[0];
  if(!e)return null;
  // Nothing has attempted this local slot's claim yet. Retain the original
  // remote demand for inspection, but do not globally stall other sites.
  if(!fresh(e.slot,now)){e.work={state:'expired',token,reason:'original_work_expired',updatedAt:new Date(now).toISOString()};await save();return {expired:true,id:e.slot.id};}
  e.work={state:'running',token,startedAt:new Date(now).toISOString()};await save();return {slot:structuredClone(e.slot)};
 });
 if(!reservation)return {state:'idle'};if(reservation.busy)return {state:'blocked',reason:'previous_work_needs_reconciliation'};if(reservation.expired)return {state:'expired',id:reservation.id,reason:'original_work_expired'};
 const slot=reservation.slot;
 const finish=async(stateName,reason,extra={})=>locked(ctx,async(state,save)=>{const e=state.entries.find(x=>x.slot.id===slot.id);if(!e||e.work?.token!==token)return {state:'lease_lost',id:slot.id};e.work={...e.work,state:stateName,reason,updatedAt:new Date(millis(clock())).toISOString(),...extra};await save();return {state:stateName,id:slot.id,...(reason?{reason}:{})};});
 if(signal?.aborted)return locked(ctx,async(state,save)=>{const e=state.entries.find(x=>x.slot.id===slot.id);if(e?.work?.token===token){delete e.work;await save();}return {state:'cancelled',id:slot.id};});
 let result;try{result=await runWork({slot,signal:workSignal||signal,stopSignal:signal});}catch{return finish('uncertain',signal?.aborted?'stopped_before_confirmation':'work_interrupted');}
 if(result?.state==='submitted'&&result.demandId===slot.id&&typeof result.workId==='string'&&validPublications(slot,result.publications))return finish('submitted','center_received',{workId:result.workId,requestIds:result.publications.map(x=>x.requestId),publicationIds:result.publications.map(x=>x.id),publications:result.publications,publicationCheck:{state:'pending',reason:'awaiting_receiver_and_public_readback'}});
 return finish(result?.state==='blocked'?'blocked':'uncertain',result?.state==='blocked'?'work_blocked':'work_unconfirmed');
}

// Only a process-crash marker is eligible for automatic reconciliation.
// Explicitly blocked/uncertain work requires operator review. Inspect must
// read the original Center demand and local outbox under the daemon lock.
export async function reconcileScheduledWork({connection,home,inspect,clock=Date.now,signal}){
 if(typeof inspect!=='function')throw Error('Work reconciliation requires an inspector');
 if(signal?.aborted)return {state:'cancelled'};
 const ctx=await context({home,connection});
 const previous=await locked(ctx,async state=>{const e=state.entries.find(x=>x.work?.state==='running');return e?{slot:structuredClone(e.slot),demand:structuredClone(e.demand),token:e.work.token}:null;});
 if(!previous)return {state:'idle'};
 let result;try{result=await inspect({...previous,signal});}catch{return {state:'blocked',id:previous.slot.id,reason:'reconciliation_unavailable'};}
 return locked(ctx,async(state,save)=>{
  const e=state.entries.find(x=>x.slot.id===previous.slot.id);if(e?.work?.state!=='running'||e.work.token!==previous.token)return {state:'changed',id:previous.slot.id};
  if(result?.state==='submitted'&&result.demandId===e.slot.id&&typeof result.workId==='string'&&validPublications(e.slot,result.publications)){
   e.work={...e.work,state:'submitted',reason:'original_receipt_reconciled',updatedAt:new Date(millis(clock())).toISOString(),workId:result.workId,requestIds:result.publications.map(x=>x.requestId),publicationIds:result.publications.map(x=>x.id),publications:result.publications,publicationCheck:{state:'pending',reason:'awaiting_receiver_and_public_readback'}};await save();return {state:'submitted',id:e.slot.id};
  }
  if(result?.state==='retry'&&result.demandId===e.slot.id&&fresh(e.slot,millis(clock()))){delete e.work;await save();return {state:'retry',id:e.slot.id};}
  e.work={...e.work,state:'blocked',reason:'original_work_needs_review',updatedAt:new Date(millis(clock())).toISOString()};await save();return {state:'blocked',id:e.slot.id,reason:'original_work_needs_review'};
 });
}

// Read-only reconciliation of the exact publication identities generated by
// the original submission receipts. Never re-submits content or retries a
// receiver action. Each checked locale must independently pass public readback.
export async function checkScheduledPublication({connection,home,inspect,clock=Date.now,signal}){
 if(typeof inspect!=='function')throw Error('Publication inspector required');if(signal?.aborted)return {state:'cancelled'};
 const ctx=await context({home,connection}),item=await locked(ctx,async state=>{
  const e=state.entries.filter(x=>x.work?.state==='submitted'&&x.work.publicationCheck?.state==='pending').sort((a,b)=>(a.work.publicationCheck.checkedAt||'').localeCompare(b.work.publicationCheck.checkedAt||''))[0];return e?{slot:structuredClone(e.slot),work:structuredClone(e.work)}:null;
 });
 if(!item)return {state:'idle'};let result;
 try{result=await inspect({...item,signal});}catch{result={state:'pending',reason:'readback_unavailable'};}
 return locked(ctx,async(state,save)=>{
  const e=state.entries.find(x=>x.slot.id===item.slot.id);if(e?.work?.token!==item.work.token||!same(e.work.publications,item.work.publications))return {state:'changed',id:item.slot.id};
  if(!['pending','blocked','verified'].includes(result?.state))throw Error('Invalid publication verification');
  e.work.publicationCheck={state:result.state,reason:result.reason||null,checkedAt:new Date(millis(clock())).toISOString(),...(result.state==='verified'?{urls:result.urls,...(result.communityUrl?{communityUrl:result.communityUrl}:{})}:result.publicUrls?{publicUrls:result.publicUrls}:{})};await save();return {id:item.slot.id,state:result.state,reason:result.reason||null};
 });
}
