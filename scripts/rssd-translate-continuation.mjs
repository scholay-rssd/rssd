import protocol from '../contracts/rssd-v1.cjs';
import {CenterError} from './rssd-center-client.mjs';

export const TRANSLATE_TARGET_LOCALE='en';
export const TRANSLATE_SOURCE_LOCALE='zh-CN';
export const TRANSLATE_CONTRACT={
  centerHead:'9632f4fd74659eb3a2f90fb114c147c1878a85a4',
  mcpTool:'rssd_create_demand',
  descriptionMarkers:[
    'binds the source revision and hash',
    'skips locales that already exist',
    'reuses an open task',
  ],
  // Proposed identifier. 9632f4fd overview.capabilities still only has
  // goalManagement, publicationScheduling, demandEditing, mcp. When Center
  // adds this key, it must be true before enqueue; absence is not a grant.
  overviewCapability:'translateContinuation',
};
const OPEN=new Set(['queued','claimed','blocked']);
function fail(message,code='invalid_request',status=400){throw new CenterError(message,{status,code});}
function mcpTools(value){return value?.result?.tools||value?.tools||[];}

export function translateDemandId({workId,revision,targetLocale=TRANSLATE_TARGET_LOCALE}){
  return 'tr-'+protocol.hash({workId,locale:TRANSLATE_SOURCE_LOCALE,revision,targetLocale}).slice(0,40);
}

export function boundTranslateSource(work,{revision,targetLocale=TRANSLATE_TARGET_LOCALE}={}){
  if(!work||work.id==null||!work.workspaceId||!work.sectionId||!Array.isArray(work.editions))fail('Work identity is incomplete','invalid_work');
  protocol.id(work.id,'workId');protocol.id(work.workspaceId,'workspaceId');protocol.id(work.sectionId,'sectionId');
  if(targetLocale!==TRANSLATE_TARGET_LOCALE)fail('Existing-work continuation is limited to English');
  const source=work.editions.find(edition=>edition.locale===TRANSLATE_SOURCE_LOCALE);
  if(!source||!Number.isSafeInteger(source.revision)||source.revision<1||!/^[a-f0-9]{64}$/.test(source.hash||''))fail('Chinese source revision or hash is missing','source_unavailable',404);
  if(revision!=null&&protocol.integer(revision,'source.revision',1)!==source.revision)fail('Requested Chinese revision is not the current head; the old edition was left unchanged','source_conflict',409);
  return {
    workId:work.id,workspaceId:work.workspaceId,sectionId:work.sectionId,title:source.payload?.title||source.title||'',
    source:{workId:work.id,locale:TRANSLATE_SOURCE_LOCALE,revision:source.revision},sourceHash:source.hash,
    present:[...new Set(work.editions.map(edition=>edition.locale))],skip:work.editions.some(edition=>edition.locale===TRANSLATE_TARGET_LOCALE),
  };
}

export function requireTranslateClaim(claim){
  const source=claim?.payload?.source,locales=claim?.payload?.requiredLocales;
  if(claim?.kind!=='translate'||!source?.workId||source.locale!==TRANSLATE_SOURCE_LOCALE||!Number.isSafeInteger(source.revision)||source.revision<1)fail('Translate claim is missing a Chinese source bind','source_unavailable',409);
  if(!Array.isArray(locales)||!locales.length||locales.includes(source.locale)||protocol.canonical([...locales].sort())!==protocol.canonical([TRANSLATE_TARGET_LOCALE]))fail('Translate claim must require only English','source_conflict',409);
  if(claim.payload.sourceHash&&!/^[a-f0-9]{64}$/.test(claim.payload.sourceHash))fail('Translate claim source hash is invalid','source_conflict',409);
  return source;
}

export function requireTranslatePacket(packet,claim){
  const source=requireTranslateClaim(claim);
  if(packet?.workId!==source.workId||packet.workspaceId!==claim.workspaceId||packet.sectionId!==claim.sectionId||packet.demandId!==claim.id||packet.claimToken!==claim.claimToken)fail('Translate packet must keep the original work and claim','identity_conflict',409);
  if(!Array.isArray(packet.editions)||packet.editions.length!==1||packet.editions[0].locale!==TRANSLATE_TARGET_LOCALE)fail('Translate packet must submit only English','source_conflict',409);
  if(protocol.canonical(packet.editions[0].translationOf)!==protocol.canonical(source))fail('Translate packet must identify the bound Chinese revision','source_conflict',409);
}

export function assertBoundSourceCurrent(claim,work,edition){
  const source=requireTranslateClaim(claim);
  if(!edition||edition.locale!==source.locale||edition.revision!==source.revision)fail('Translation source revision not found','source_conflict',409);
  if(claim.payload.sourceHash&&edition.hash!==claim.payload.sourceHash)fail('Translation source fingerprint changed','source_conflict',409);
  const head=(work?.editions||[]).find(row=>row.locale===source.locale);
  if(head&&head.revision!==source.revision)fail('Translation source has a newer revision','source_conflict',409);
}

async function listOpenTranslates(client,workspaceId,workId){
  const found=[];
  for(let offset=0;;offset+=100){
    const rows=await client.demands({workspaceId,limit:100,offset});
    if(!Array.isArray(rows))fail('Demand list is unreadable','invalid_response');
    for(const row of rows)if(row.kind==='translate'&&OPEN.has(row.state)&&row.payload?.source?.workId===workId)found.push(row);
    if(rows.length<100)break;
  }
  return found;
}

function sameTranslateBind(row,source,sourceHash,requiredLocales){
  const bound=row.payload?.source||{},locales=row.payload?.requiredLocales||[];
  return bound.locale===source.locale&&bound.revision===source.revision&&row.payload.sourceHash===sourceHash&&protocol.canonical([...locales].sort())===protocol.canonical(requiredLocales);
}

async function readOverview(client){
  try{
    if(typeof client.overview==='function')return await client.overview();
    return await client.request('/coordination/overview');
  }catch(error){
    if(error instanceof CenterError&&[404,405].includes(error.status))return null;
    throw error;
  }
}

export async function requireTranslateContract(client){
  if(typeof client.request!=='function')fail('Center client cannot probe the translate contract','contract_unavailable',409);
  const listed=await client.request('/mcp',{method:'POST',body:{jsonrpc:'2.0',id:'translate-contract',method:'tools/list',params:{}}});
  const tool=mcpTools(listed).find(row=>row.name===TRANSLATE_CONTRACT.mcpTool);
  if(!tool)fail('Center has not deployed rssd_create_demand; refuse to enqueue a translate demand','contract_unavailable',409);
  const description=String(tool.description||'');
  if(!TRANSLATE_CONTRACT.descriptionMarkers.every(marker=>description.includes(marker)))fail('rssd_create_demand is present but does not advertise the bound-source translate contract; the tool name is not a contract version','contract_unavailable',409);
  const overview=await readOverview(client);
  const capabilities=overview?.capabilities;
  if(capabilities&&Object.prototype.hasOwnProperty.call(capabilities,TRANSLATE_CONTRACT.overviewCapability)&&capabilities[TRANSLATE_CONTRACT.overviewCapability]!==true)fail('Center overview does not grant translateContinuation','contract_unavailable',409);
}

export async function enqueueTranslateContinuation({client,workId,revision}={}){
  if(!client||typeof client.work!=='function'||typeof client.createDemand!=='function'||typeof client.demands!=='function')fail('Missing center work and demand client');
  await requireTranslateContract(client);
  const id=protocol.id(workId,'workId');
  const work=await client.work(id);
  if(!work||work.id!==id)fail('Work identity does not match the requested id','identity_conflict',409);
  const bound=boundTranslateSource(work,{revision});
  if(bound.skip)return {status:'skipped',reason:'locale_present',workId:bound.workId,workspaceId:bound.workspaceId,sectionId:bound.sectionId,source:bound.source,sourceHash:bound.sourceHash,existingLocales:bound.present};
  const requiredLocales=[TRANSLATE_TARGET_LOCALE];
  const demand=protocol.demand({
    id:translateDemandId({workId:bound.workId,revision:bound.source.revision}),
    workspaceId:bound.workspaceId,sectionId:bound.sectionId,kind:'translate',
    title:protocol.text(bound.title||('Translate '+bound.workId),'title',500),
    brief:'Continue existing work '+bound.workId+' from zh-CN revision '+bound.source.revision+' to en. Do not rewrite the Chinese edition.',
    requiredLocales,source:bound.source,priority:0,
  });
  const open=await listOpenTranslates(client,bound.workspaceId,bound.workId);
  if(open.some(row=>!sameTranslateBind(row,bound.source,bound.sourceHash,requiredLocales)))fail('An open translate task already exists for this work; wait for expiry, release or completion before rebinding','open_translate_conflict',409);
  const result=await client.createDemand(demand);
  if(result?.status==='skipped')return {status:'skipped',reason:result.reason||'locale_present',workId:result.workId||bound.workId,workspaceId:bound.workspaceId,sectionId:bound.sectionId,source:bound.source,sourceHash:bound.sourceHash,existingLocales:result.existingLocales||bound.present};
  const payload=result?.payload,status=result?.status==='existing'?'existing':'created';
  if(!result||!result.id||!payload)fail('Center did not accept the translate demand','invalid_response');
  if(result.id!==demand.id&&status==='created')fail('Created demand identity does not match the original request','identity_conflict',409);
  if(payload.kind&&payload.kind!=='translate'||payload.source&&protocol.canonical(payload.source)!==protocol.canonical(bound.source)||payload.requiredLocales&&protocol.canonical([...payload.requiredLocales].sort())!==protocol.canonical(requiredLocales))fail('Demand receipt changed the work or source bind','identity_conflict',409);
  if(typeof payload.sourceHash!=='string'||payload.sourceHash!==bound.sourceHash)fail('Center did not bind the current Chinese source hash','source_unbound',409);
  return {status,id:result.id,workspaceId:bound.workspaceId,sectionId:bound.sectionId,workId:bound.workId,source:bound.source,sourceHash:payload.sourceHash,demand,receipt:result};
}
