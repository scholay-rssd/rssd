import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import protocol from '../contracts/rssd-v1.cjs';
import {writeCenterJson} from './rssd-center-client.mjs';
import {trustedCenterOrigin} from './rssd-center-media-ref.mjs';

export const GENERATION_EVIDENCE_KIND='center-generation-evidence';
export const GENERATION_UNRECOVERABLE='generation_unrecoverable';

function fail(message,code=GENERATION_UNRECOVERABLE){throw Object.assign(Error(message),{code,status:409});}
async function readText(path){try{return await readFile(path,'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function readJson(path){const text=await readText(path);return text==null?null:JSON.parse(text);}

export function sourceBindFrom(source){
  if(!source)return null;
  const payload=source.payload||source;
  const revision=Number.isInteger(source.revision)?source.revision:Number.isInteger(payload.revision)?payload.revision:null;
  const locale=typeof source.locale==='string'?source.locale:typeof payload.locale==='string'?payload.locale:null;
  const workId=source.workId||payload.workId||source.translationOf?.workId||payload.translationOf?.workId||null;
  return {workId:workId||null,locale:locale||null,revision,hash:protocol.hash(payload)};
}

export function authenticGenerationSignature(signature,{agentId}={}){
  if(!signature||typeof signature!=='object'||Array.isArray(signature))return false;
  if(signature.status!=='completed'||typeof signature.runId!=='string'||!signature.runId)return false;
  if(typeof signature.agentId!=='string'||!signature.agentId)return false;
  if(agentId&&signature.agentId!==agentId)return false;
  if(typeof signature.startedAt!=='string'||typeof signature.completedAt!=='string')return false;
  return true;
}

export function generationEvidenceRecord({locale,sectionId,origin,workspaceId,output,signature,source,agentId}){
  if(!authenticGenerationSignature(signature,{agentId}))fail('设备记录的生成证明缺少真实会话签名，不能从正文伪造','generation_evidence_invalid');
  protocol.locale(locale);
  return {
    version:1,
    kind:GENERATION_EVIDENCE_KIND,
    notFromAgentBody:true,
    locale,
    sectionId:sectionId||null,
    origin:trustedCenterOrigin(origin),
    workspaceId:protocol.id(workspaceId,'workspaceId'),
    outputSha256:protocol.hash(String(output||'')),
    signature:structuredClone(signature),
    sourceBind:sourceBindFrom(source),
  };
}

export async function persistGenerationEvidence({directory,locale,sectionId,origin,workspaceId,output,signature,source,agentId}){
  const file=join(directory,locale+'.generation-evidence.json');
  const record=generationEvidenceRecord({locale,sectionId,origin,workspaceId,output,signature,source,agentId});
  const prior=await readJson(file);
  if(prior&&protocol.canonical(prior)!==protocol.canonical(record))fail('已有生成证明与本次会话不一致，已保留等待核对');
  if(!prior)await writeCenterJson(file,record);
  return record;
}

export async function recoverPersistedCenterEdition({directory,locale,source,origin,workspaceId,sectionId,agentId}){
  const raw=await readText(join(directory,locale+'.agent-output.txt'));
  const evidence=await readJson(join(directory,locale+'.generation-evidence.json'));
  if(!raw)return {edition:null,recovered:false};
  if(!evidence)fail('保留的模型输出缺少设备记录的生成证明，不能从正文伪造签名，也不得重跑模型');
  if(evidence.kind!==GENERATION_EVIDENCE_KIND||evidence.notFromAgentBody!==true||evidence.version!==1)fail('生成证明格式无效，不能恢复');
  if(evidence.outputSha256!==protocol.hash(raw))fail('保留的模型输出与生成证明不一致，不能恢复');
  if(!authenticGenerationSignature(evidence.signature,{agentId}))fail('生成证明的签名不真实，不能从正文补签名或重跑模型');
  if(evidence.locale!==locale||evidence.origin!==trustedCenterOrigin(origin)||evidence.workspaceId!==protocol.id(workspaceId,'workspaceId'))fail('生成证明的中心 origin 或工作空间与当前任务不一致');
  if(sectionId&&evidence.sectionId&&evidence.sectionId!==sectionId)fail('生成证明的栏目与当前任务不一致');
  const expectedBind=sourceBindFrom(source);
  if(protocol.canonical(evidence.sourceBind)!==protocol.canonical(expectedBind))fail('生成证明的原稿绑定与当前 source 不一致，不能恢复');
  const {parseCenterEdition}=await import('../desktop/scripts/agent/center-producer.mjs');
  const edition=parseCenterEdition(raw,{source,locale,sectionId:sectionId||evidence.sectionId,signature:evidence.signature,origin:evidence.origin,workspaceId:evidence.workspaceId});
  return {edition,recovered:true,evidence};
}
