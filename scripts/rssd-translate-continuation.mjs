import protocol from '../contracts/rssd-v1.cjs';
import {CenterError} from './rssd-center-client.mjs';
import {STORE_ONLY_CONTRACT,assertStoreOnlyReceipt,requireStoreOnlyContract,storeOnlyTranslateContract,supportsStoreOnlyTranslate} from './rssd-store-only-contract.mjs';
export {STORE_ONLY_CONTRACT,assertStoreOnlyReceipt,requireStoreOnlyContract,storeOnlyTranslateContract,supportsStoreOnlyTranslate};

export const TRANSLATE_TARGET_LOCALE='en';
export const TRANSLATE_SOURCE_LOCALE='zh-CN';
export const TRANSLATE_CONTRACT={
  centerHead:'ffb0886cd18b39a007eebe784e4c08eab11188b0',
  versionKey:'translateContinuation',
  requiredVersion:1,
  guarantees:Object.freeze(['sourceHash','currentHead','uniqueOpenWork','claimLease','englishOnly','sourceChangeReject','receipt']),
};
const OPEN=new Set(['queued','claimed','blocked']);
function fail(message,code='invalid_request',status=400){throw new CenterError(message,{status,code});}
export function translateContinuationContract(){
  return {version:TRANSLATE_CONTRACT.requiredVersion,guarantees:[...TRANSLATE_CONTRACT.guarantees]};
}
export function supportsTranslateContinuation(overview){
  const row=overview?.contracts?.translateContinuation;
  if(!row||typeof row!=='object'||Array.isArray(row)||!Number.isInteger(row.version)||row.version<TRANSLATE_CONTRACT.requiredVersion||!Array.isArray(row.guarantees))return false;
  return TRANSLATE_CONTRACT.guarantees.every(token=>row.guarantees.includes(token));
}
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
    if(typeof client.request!=='function')fail('Center client cannot probe the translateContinuation contract version','contract_unavailable',409);
    return await client.request('/coordination/overview');
  }catch(error){
    if(error instanceof CenterError)fail('Center overview is unavailable; translateContinuation contract version cannot be verified','contract_unavailable',409);
    throw error;
  }
}

export async function requireTranslateContract(client){
  const overview=await readOverview(client);
  if(!supportsTranslateContinuation(overview))fail('Center did not advertise a supported translateContinuation contract; enqueue refused','contract_unavailable',409);
}
export function storeOnlyClaimBody({workspaceIds,sectionIds,demandId}={}){
  if(!demandId)fail('Store-only English requires --id <demandId> with storeOnly:true','store_only_required',403);
  return {demandId,storeOnly:true,...(workspaceIds?.length?{workspaceIds}:{}),...(sectionIds?.length?{sectionIds}:{})};
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

export async function enqueueStoreOnlyTranslate({client,workId,revision}={}){
  if(!client||typeof client.work!=='function'||typeof client.createDemand!=='function'||typeof client.demands!=='function')fail('Missing center work and demand client');
  await requireStoreOnlyContract(client);
  const id=protocol.id(workId,'workId');
  const work=await client.work(id);
  if(!work||work.id!==id)fail('Work identity does not match the requested id','identity_conflict',409);
  const bound=boundTranslateSource(work,{revision});
  if(bound.skip)return {status:'skipped',reason:'locale_present',workId:bound.workId,workspaceId:bound.workspaceId,sectionId:bound.sectionId,source:bound.source,sourceHash:bound.sourceHash,existingLocales:bound.present,storeOnly:true};
  const requiredLocales=[TRANSLATE_TARGET_LOCALE];
  const demand=protocol.demand({
    id:translateDemandId({workId:bound.workId,revision:bound.source.revision}),
    workspaceId:bound.workspaceId,sectionId:bound.sectionId,kind:'translate',
    title:protocol.text(bound.title||('Store English '+bound.workId),'title',500),
    brief:'Store English only for existing work '+bound.workId+' from zh-CN revision '+bound.source.revision+'. Do not rewrite the Chinese edition. Do not create publication tasks.',
    requiredLocales,source:bound.source,priority:10,
  });
  const open=await listOpenTranslates(client,bound.workspaceId,bound.workId);
  if(open.some(row=>!sameTranslateBind(row,bound.source,bound.sourceHash,requiredLocales)))fail('An open translate task already exists for this work; wait for expiry, release or completion before rebinding','open_translate_conflict',409);
  const result=await client.createDemand({...demand,storeOnly:true});
  if(result?.status==='skipped')return {status:'skipped',reason:result.reason||'locale_present',workId:result.workId||bound.workId,workspaceId:bound.workspaceId,sectionId:bound.sectionId,source:bound.source,sourceHash:bound.sourceHash,existingLocales:result.existingLocales||bound.present,storeOnly:true};
  const payload=result?.payload,status=result?.status==='existing'?'existing':'created';
  if(!result||!result.id||!payload)fail('Center did not accept the store-only translate demand','invalid_response');
  if(result.id!==demand.id&&status==='created')fail('Created demand identity does not match the original request','identity_conflict',409);
  if(payload.kind&&payload.kind!=='translate'||payload.source&&protocol.canonical(payload.source)!==protocol.canonical(bound.source)||payload.requiredLocales&&protocol.canonical([...payload.requiredLocales].sort())!==protocol.canonical(requiredLocales))fail('Demand receipt changed the work or source bind','identity_conflict',409);
  if(typeof payload.sourceHash!=='string'||payload.sourceHash!==bound.sourceHash)fail('Center did not bind the current Chinese source hash','source_unbound',409);
  if(payload.storeOnly!==true||typeof payload.storeOnlyWorkerId!=='string'||!payload.storeOnlyWorkerId)fail('Center did not freeze store-only intent; refused to treat this as default translate','not_store_only',409);
  return {status,id:result.id,workspaceId:bound.workspaceId,sectionId:bound.sectionId,workId:bound.workId,source:bound.source,sourceHash:payload.sourceHash,storeOnly:true,storeOnlyWorkerId:payload.storeOnlyWorkerId,demand:{...demand,storeOnly:true},receipt:result};
}
