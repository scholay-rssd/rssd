import {randomUUID} from 'node:crypto';
import protocol from '../../contracts/rssd-v1.cjs';
import {CenterError} from '../../scripts/rssd-center-client.mjs';

export const CLAIM_TTL_MS=24*60*60*1000;
const fail=(message,status=400,code='invalid_request')=>{throw new CenterError(message,{status,code});};
const localeKey=list=>[...list].sort().join(',');
const clone=value=>structuredClone(value);
function publicDemand(row){if(!row)return null;const {claimToken,...rest}=row;return clone(rest);}

export function createTranslateCenterFixture({now=()=>Date.now()}={}){
  const works=new Map(),history=new Map(),demands=new Map(),submissions=new Map(),workers=new Map();
  const key=workId=>workId;
  const revisions=(workId,locale)=>(history.get(key(workId))||[]).filter(row=>row.locale===locale).sort((a,b)=>b.revision-a.revision);
  const head=(workId,locale)=>revisions(workId,locale)[0]||null;
  const editionAt=(workId,locale,revision)=>(history.get(key(workId))||[]).find(row=>row.locale===locale&&row.revision===revision)||null;
  function putEdition(work,{locale,revision,payload,hash}){
    const item={locale,revision,payload,hash:hash||protocol.hash(payload),createdAt:new Date(now()).toISOString()};
    const list=history.get(work.id)||[];list.push(item);history.set(work.id,list);
    const latest=new Map((works.get(work.id)?.editions||[]).map(row=>[row.locale,row]));latest.set(locale,item);
    works.set(work.id,{...work,editions:[...latest.values()],updatedAt:item.createdAt});
  }
  function addWork({id=randomUUID(),workspaceId='enter',sectionId='forums',title='中文标题',body='完整的中文正文。',locales=['zh-CN']}={}){
    const work={id,workspaceId,sectionId,createdAt:new Date(now()).toISOString(),updatedAt:new Date(now()).toISOString(),editions:[]};
    works.set(id,work);history.set(id,[]);
    for(const locale of locales){
      const payload={locale,title:locale==='en'?'English title':title,bodyMarkdown:locale==='en'?'Complete English body.':body,summary:'',sources:[],media:[],metadata:{},translationOf:locale==='en'?{workId:id,locale:'zh-CN',revision:1}:null};
      putEdition(work,{locale,revision:1,payload});
    }
    return clone(works.get(id));
  }
  function bumpChinese(workId,body){
    const work=works.get(workId);if(!work)fail('Work not found',404,'not_found');
    const current=head(workId,'zh-CN');if(!current)fail('Chinese source missing',404,'not_found');
    putEdition(work,{locale:'zh-CN',revision:current.revision+1,payload:{...current.payload,bodyMarkdown:body||(current.payload.bodyMarkdown+' 更新')}});
    return clone(works.get(workId));
  }
  function expireStale(){
    for(const demand of demands.values()){
      if(!['claimed','blocked'].includes(demand.state)||!demand.payload.claimExpiresAt||Date.parse(demand.payload.claimExpiresAt)>=now())continue;
      demand.state='queued';demand.workerId=null;demand.claimToken=null;demand.generation+=1;
      const {claimExpiresAt,...payload}=demand.payload;demand.payload={...payload,lastError:'claim_expired'};demand.updatedAt=new Date(now()).toISOString();
    }
  }
  function createDemand(input){
    const value=protocol.demand(input);const work=works.get(value.source?.workId);
    if(!value.source)fail('Fixture demands require a source',400);
    if(!work)fail('Work not found',404,'not_found');
    if(work.workspaceId!==value.workspaceId)fail('Source workspace differs');
    if(work.sectionId!==value.sectionId)fail('Source section differs');
    const edition=editionAt(value.source.workId,value.source.locale,value.source.revision);
    if(!edition)fail('Source revision not found',404,'not_found');
    let requiredLocales=value.requiredLocales;
    if(value.kind==='translate'){
      requiredLocales=[...new Set(value.requiredLocales.filter(locale=>locale!==value.source.locale))];
      if(!requiredLocales.length)fail('Translation demand needs a target locale');
    }
    const present=[...new Set((history.get(value.source.workId)||[]).map(row=>row.locale))];
    if(value.kind==='translate'&&requiredLocales.every(locale=>present.includes(locale)))return {status:'skipped',reason:'locale_present',workId:value.source.workId,workspaceId:value.workspaceId,requiredLocales,existingLocales:present};
    const payload={...value,requiredLocales,sourceHash:edition.hash};
    const open=[...demands.values()].filter(row=>row.kind===value.kind&&row.workspaceId===value.workspaceId&&['queued','claimed','blocked'].includes(row.state)&&row.payload.source?.workId===value.source.workId);
    const existing=open.find(row=>row.payload.source?.locale===value.source.locale&&row.payload.source?.revision===value.source.revision&&row.payload.sourceHash===edition.hash&&localeKey(row.payload.requiredLocales||[])===localeKey(requiredLocales));
    if(existing)return {...publicDemand(existing),status:'existing'};
    if(demands.has(value.id)){
      const old=demands.get(value.id);
      if(old.kind===value.kind&&old.payload.source?.workId===value.source.workId)return {...publicDemand(old),status:'existing'};
      fail('Demand identity already exists',409,'identity_conflict');
    }
    const row={id:value.id,workspaceId:value.workspaceId,sectionId:value.sectionId,kind:value.kind,title:value.title,state:'queued',generation:0,priority:value.priority,payload,workerId:null,claimToken:null,createdAt:new Date(now()).toISOString(),updatedAt:new Date(now()).toISOString()};
    demands.set(row.id,row);return {...publicDemand(row),status:'created'};
  }
  function claim(workerId,input={}){
    expireStale();
    if([...demands.values()].some(row=>row.workerId===workerId&&['claimed','blocked'].includes(row.state)))fail('Finish, resume or release the current demand first',409,'worker_busy');
    const workspaceIds=input.workspaceIds||[...new Set([...works.values()].map(work=>work.workspaceId))];
    const sectionIds=input.sectionIds||[];
    const queued=[...demands.values()].filter(row=>row.state==='queued'&&workspaceIds.includes(row.workspaceId)&&(!sectionIds.length||sectionIds.includes(row.sectionId))&&(!input.demandId||row.id===input.demandId)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
    const demand=queued[0];
    if(!demand){
      if(input.demandId){const held=demands.get(input.demandId);if(held&&['claimed','blocked'].includes(held.state))fail('Demand is claimed by another device',409,'claim_conflict');}
      return null;
    }
    demand.state='claimed';demand.workerId=workerId;demand.claimToken=randomUUID();demand.generation+=1;
    demand.payload={...demand.payload,policy:{version:1,targets:demand.payload.requiredLocales.map(locale=>({destinationId:'site-'+demand.workspaceId,locale}))},claimExpiresAt:new Date(now()+CLAIM_TTL_MS).toISOString()};
    demand.updatedAt=new Date(now()).toISOString();
    return clone(demand);
  }
  function activeClaim(workerId){expireStale();return clone([...demands.values()].find(row=>row.workerId===workerId&&['claimed','blocked'].includes(row.state))||null);}
  function changeDemand(workerId,id,input){
    const demand=demands.get(id);if(!demand)fail('Demand not found',404,'not_found');
    if(demand.workerId!==workerId||demand.claimToken!==input.claimToken)fail('Claim no longer belongs to this device',409,'claim_revoked');
    if(['completed','cancelled'].includes(demand.state))fail('Demand is already closed',409);
    const clear=['release','cancel'].includes(input.action);
    demand.state={release:'queued',cancel:'cancelled',blocked:'blocked',resume:'claimed'}[input.action];
    demand.payload={...demand.payload,lastError:input.action==='blocked'?String(input.message||'').slice(0,2000):null};
    if(clear){demand.workerId=null;demand.claimToken=null;demand.generation+=1;const {claimExpiresAt,...payload}=demand.payload;demand.payload=payload;}
    demand.updatedAt=new Date(now()).toISOString();return publicDemand(demand);
  }
  function submit(workerId,input){
    const value=protocol.submission(input);expireStale();
    const fingerprint=protocol.hash({publish:true,value});
    const previous=submissions.get(value.requestId);
    if(previous){if(previous.payloadHash!==fingerprint)fail('Request identity was reused with different content',409,'request_conflict');return clone(previous.result);}
    const demand=value.demandId?demands.get(value.demandId):null;
    if(value.demandId){
      if(!demand||!['claimed','blocked'].includes(demand.state)||demand.workerId!==workerId||demand.claimToken!==value.claimToken)fail('Claim no longer belongs to this device',409,'claim_revoked');
      if(demand.workspaceId!==value.workspaceId||demand.sectionId!==value.sectionId)fail('Submission does not match the claimed demand',409);
      if(demand.payload.source&&demand.payload.source.workId!==value.workId)fail('Update or translation must retain the source work identity',409);
      if(demand.kind==='translate'){
        if(value.editions.some(edition=>edition.locale===demand.payload.source.locale))fail('Translation must not rewrite the source edition',409,'source_conflict');
        const bound=demand.payload.source,sourceEdition=editionAt(bound.workId,bound.locale,bound.revision);
        if(!sourceEdition)fail('Translation source revision not found',409,'source_conflict');
        if(demand.payload.sourceHash&&sourceEdition.hash!==demand.payload.sourceHash)fail('Translation source fingerprint changed',409,'source_conflict');
        if((head(bound.workId,bound.locale)?.revision||0)!==bound.revision)fail('Translation source has a newer revision',409,'source_conflict');
      }
    }
    const work=works.get(value.workId)||{id:value.workId,workspaceId:value.workspaceId,sectionId:value.sectionId,editions:[],createdAt:new Date(now()).toISOString()};
    if(work.workspaceId!==value.workspaceId||work.sectionId!==value.sectionId)fail('Work belongs to a different workspace or section',409,'identity_conflict');
    const result={requestId:value.requestId,workId:value.workId,workspaceId:value.workspaceId,status:'accepted',editions:[],publicationIds:[]};
    for(const edition of value.editions){
      if(demand?.kind==='translate'&&(!edition.translationOf||protocol.hash(edition.translationOf)!==protocol.hash(demand.payload.source)))fail('Translation must identify the requested source revision',409,'source_conflict');
      const current=head(value.workId,edition.locale);
      if((current?.revision||0)!==value.baseRevisions[edition.locale])fail('Edition changed; keep local changes and reload',409,'revision_conflict');
      if(edition.translationOf){
        if(edition.translationOf.workId!==value.workId||edition.translationOf.locale===edition.locale)fail('Invalid translation source');
        if(!editionAt(value.workId,edition.translationOf.locale,edition.translationOf.revision))fail('Translation source revision not found',409,'source_conflict');
      }
      const next={locale:edition.locale,revision:(current?.revision||0)+1,hash:protocol.hash(edition)};
      putEdition(work,{locale:edition.locale,revision:next.revision,payload:edition,hash:next.hash});
      result.editions.push(next);result.publicationIds.push('publication-'+next.locale);
    }
    if(demand){
      const submitted=new Set([...(demand.payload.submittedLocales||[]),...value.editions.map(edition=>edition.locale)]);
      const completed=demand.payload.requiredLocales.every(locale=>submitted.has(locale));
      demand.payload={...demand.payload,submittedLocales:[...submitted],workId:value.workId};demand.state=completed?'completed':'claimed';
      if(completed){demand.workerId=null;demand.claimToken=null;}
      result.demandState=demand.state;
    }
    submissions.set(value.requestId,{payloadHash:fingerprint,result});return clone(result);
  }
  function client(workerId='worker-a'){
    workers.set(workerId,{id:workerId});
    const origin='https://center.example';
    return {
      origin,workerId,
      request:async(path,{method='GET',body}={})=>{
        if(path==='/mcp'&&method==='POST'&&body?.method==='tools/list')return {jsonrpc:'2.0',id:body.id,result:{tools:[{name:'rssd_create_demand'},{name:'rssd_claim'},{name:'rssd_submit'},{name:'rssd_receipt'}]}};
        const edition=path.match(/^\/works\/([^/]+)\/editions\/([^/]+)\/(\d+)$/);
        if(edition){const row=editionAt(decodeURIComponent(edition[1]),decodeURIComponent(edition[2]),Number(edition[3]));if(!row)fail('Edition revision not found',404,'not_found');return clone(row);}
        fail('Unknown fixture path',404,'not_found');
      },
      work:async id=>{const work=works.get(id);if(!work)fail('Work not found',404,'not_found');return clone(work);},
      demands:async({workspaceId,limit=100,offset=0}={})=>[...demands.values()].filter(row=>!workspaceId||row.workspaceId===workspaceId).slice(offset,offset+limit).map(publicDemand),
      createDemand:async body=>createDemand(body),
      claim:async body=>claim(workerId,body),
      activeClaim:async()=>activeClaim(workerId),
      heartbeat:async()=>({ok:true}),
      changeDemand:async(id,body)=>changeDemand(workerId,id,body),
      submit:async packet=>submit(workerId,packet),
      submission:async id=>{const row=submissions.get(id);if(!row)fail('Submission not found',404,'not_found');return clone(row.result);},
    };
  }
  return {addWork,bumpChinese,putEdition,createDemand,claim,client,demands,works,submissions,now};
}
