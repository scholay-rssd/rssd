import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import protocol from '../contracts/rssd-v1.cjs';
import writingDefaults from '../contracts/writing-defaults-v1.cjs';
import {withFileLock} from './editorial-lock.mjs';
import {CenterOutbox,clearCompletedClaim,writeCenterJson} from './rssd-center-client.mjs';
import {prepareEditionMedia,completeStoredEdition} from './rssd-device-media.mjs';
import {ARTICLE_WRITING_INSTRUCTIONS,ARTICLE_WRITING_POLICY} from '../contracts/article-writing-policy.mjs';
import {platformProductionInstructions} from '../contracts/rssd-platform-content.cjs';
import {verifyAutomatedReferences} from './rssd-reference-gate.mjs';
import {centerWritingScope,validateCenterSkillSnapshot} from '../desktop/scripts/agent/center-skill-mounts.mjs';
import {bindImagePlan} from './rssd-image-plan.mjs';
import {notebookMarkdown} from '../desktop/scripts/agent/notebook.mjs';
import {imageCreditContext,validateReusedImageCredits} from './rssd-image-credit-context.mjs';
import {verifyStoredVisualReview} from './rssd-image-visual-review.mjs';
import {imageTranslationInstructions,orderedOriginalImages} from './rssd-image-translation-prompt.mjs';
import {prepareVerifiedBibliography,applyVerifiedBibliography,verifyVerifiedBibliography,VERIFIED_BIBLIOGRAPHY_INSTRUCTIONS} from './rssd-verified-bibliography.mjs';
import {assertBoundSourceCurrent,assertStoreOnlyReceipt,requireStoreOnlyContract,requireTranslateClaim,requireTranslatePacket,storeOnlyClaimBody} from './rssd-translate-continuation.mjs';
import {parseCenterMediaRef} from './rssd-center-media-ref.mjs';
import {recoverPersistedCenterEdition} from './rssd-center-generation-evidence.mjs';
import {siteByline,withEditionByline} from '../contracts/edition-byline.mjs';
import {profiles as siteProfiles} from './site-config.mjs';

const read=async path=>{try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}};
const save=writeCenterJson;
function sourceProof(evidence,content){
 const snapshotHash=evidence?.snapshot?.snapshotHash,selectionHash=evidence?.selectionHash,bindingHash=evidence?.bindingHash;
 if(![snapshotHash,selectionHash,bindingHash].every(x=>/^[a-f0-9]{64}$/.test(x||'')))throw Error('原任务来源快照或绑定缺失');
 return {version:1,snapshotHash,selectionHash,bindingHash,contentHash:protocol.hash(content)};
}
async function requireSourceProof(file,evidence,content){const saved=await read(file),expected=sourceProof(evidence,content);if(!saved||protocol.canonical(saved)!==protocol.canonical(expected))throw Error('原稿或提交包缺少匹配的来源绑定，已保留等待核对');}
function requirePilotEdition(edition){
  const signature=edition?.metadata?.notebook?.modelSignatures?.at(-1);
  if(signature?.agentId!=='codex'||signature?.status!=='completed'||!/^gpt-6\.1-terra(?:\[(?:low|medium|high|xhigh|max|ultra)\])?$/.test(signature?.modelId||''))throw Error('原稿未确认由 Codex 和 gpt-6.1-terra 生成，已保留等待核对');
}
function requireScopedSkills(edition){
  const signature=edition?.metadata?.notebook?.modelSignatures?.at(-1),skills=signature?.writingSkills;
  if(!/^[a-f0-9]{64}$/.test(signature?.writingSkillSnapshotHash||'')||!Array.isArray(skills)||!skills.length||skills.some(s=>!s||typeof s.id!=='string'||!s.id||typeof s.version!=='string'||!s.version||!/^[a-f0-9]{64}$/.test(s.contentHash||''))||new Set(skills.map(s=>s.id)).size!==skills.length)throw Error('原稿缺少本次写作技能快照记录，已保留等待核对');
}
function notebookImages(edition){
  const blocks=edition?.metadata?.notebook?.blocks;if(!Array.isArray(blocks))throw Error('稿件缺少图片内容行');
  return blocks.filter(b=>b.type==='image'&&b.state==='ready').map(image=>{
    const captions=blocks.filter(b=>b.type==='annotation'&&b.role==='caption'&&b.targetId===image.id&&b.state==='ready');
    if(typeof image.text!=='string'||!image.text||typeof image.alt!=='string'||!image.alt.trim()||captions.length!==1||!captions[0].text?.trim())throw Error('图片缺少描述或对应图注');
    return {id:image.id,url:image.text,alt:image.alt,caption:captions[0].text};
  });
}
export function requireReusedTranslationImages(source,edition,origin){
  const expected=notebookImages(source),actual=notebookImages(edition);
  if(expected.length<2||actual.length!==expected.length)throw Error('英文稿必须按原顺序复用中文稿的全部图片及对应图注');
  const same=actual.every((x,i)=>{
    if(origin){
      const want=parseCenterMediaRef(expected[i].url,{origin}),got=parseCenterMediaRef(x.url,{origin});
      return want&&got&&want.id===got.id&&want.origin===got.origin;
    }
    return x.url===expected[i].url;
  });
  if(!same)throw Error('英文稿必须按原顺序复用中文稿的全部图片及对应图注');
}
function requirePilotPacket(packet){
  if(packet?.workspaceId!=='metho'||packet.sectionId!=='methods'||!Array.isArray(packet.editions)||packet.editions.length!==1||packet.editions[0]?.locale!=='zh-CN')throw Error('待提交稿件不属于研究方法试点，已保留等待核对');
  requirePilotEdition(packet.editions[0]);
}
function normalizeScope(value,{agentId,workspaceIds,sectionIds,demandId,verifyReady}){
  if(!value)return null;
  if(value.imagePlanRequired!==undefined&&typeof value.imagePlanRequired!=='boolean')throw Error('配图生产范围无效');
  const scope={siteId:protocol.id(value.siteId,'siteId'),workspaceId:protocol.id(value.workspaceId,'workspaceId'),sectionId:protocol.id(value.sectionId,'sectionId'),destinationId:protocol.id(value.destinationId,'destinationId'),demandId:protocol.id(value.demandId,'demandId'),agentId:value.agentId,modelId:value.modelId,requiredLocales:protocol.array(value.requiredLocales,'requiredLocales',2).map(protocol.locale),...(value.imagePlanRequired===true?{imagePlanRequired:true}:{})};
  if(typeof verifyReady!=='function'||scope.agentId!=='codex'||scope.modelId!=='gpt-6.1-terra'||agentId!==scope.agentId||workspaceIds?.length!==1||workspaceIds[0]!==scope.workspaceId||sectionIds.length!==1||sectionIds[0]!==scope.sectionId||demandId!==scope.demandId||!scope.requiredLocales.length||new Set(scope.requiredLocales).size!==scope.requiredLocales.length)throw Error('自动生产范围或模型未获验证');
  return scope;
}
function requireScopedClaim(claim,scope){
  const locales=claim?.payload?.requiredLocales,targets=claim?.payload?.policy?.targets;
  if(claim?.id!==scope.demandId||claim.workspaceId!==scope.workspaceId||claim.sectionId!==scope.sectionId||claim.kind!=='write'||!Array.isArray(locales)||protocol.canonical([...locales].sort())!==protocol.canonical([...scope.requiredLocales].sort())||!Array.isArray(targets)||targets.length!==scope.requiredLocales.length||targets.some(t=>t.destinationId!==scope.destinationId||!scope.requiredLocales.includes(t.locale))||new Set(targets.map(t=>t.locale)).size!==scope.requiredLocales.length)throw Error('原认领的工作范围或发布目标不匹配');
}
function requireScopedPacket(packet,scope){
  if(packet?.demandId!==scope.demandId||packet.workspaceId!==scope.workspaceId||packet.sectionId!==scope.sectionId||!Array.isArray(packet.editions)||packet.editions.length!==1||!scope.requiredLocales.includes(packet.editions[0]?.locale))throw Error('待提交稿件不属于已验证范围');
  requirePilotEdition(packet.editions[0]);
  requireScopedSkills(packet.editions[0]);
  verifyAutomatedReferences(packet.editions[0]);
}
export async function runProductionTurn({client,home,producer,profiles=siteProfiles,agentId,workspaceIds,sectionIds=[],demandId,resume=false,storeOnly=false,requiredModel,productionScope,writingSkillScope,sourceStage,verifyReady,signal,onEvent=()=>{},writingPolicy={version:ARTICLE_WRITING_POLICY,instructions:ARTICLE_WRITING_INSTRUCTIONS}}){
  if(requiredModel&&(requiredModel!=='gpt-6.1-terra'||agentId!=='codex'||workspaceIds?.length!==1||workspaceIds[0]!=='metho'||sectionIds.length!==1||sectionIds[0]!=='methods'))throw Error('自动试点的模型或工作范围不匹配');
  if(requiredModel&&productionScope)throw Error('不能同时使用两种生产守卫');
  if(storeOnly){
    if(productionScope||requiredModel)throw Error('Store-only English cannot run under scoped auto-publish production');
    await requireStoreOnlyContract(client);
    if(!demandId)throw Object.assign(Error('Store-only English requires a pointed demandId'),{code:'store_only_required',status:403});
  }
  const scoped=normalizeScope(productionScope,{agentId,workspaceIds,sectionIds,demandId,verifyReady});
  if(scoped&&(!sourceStage||typeof sourceStage.restore!=='function'||typeof sourceStage.verifyEdition!=='function'))throw Object.assign(Error('来源验证与冻结阶段未配置，原任务保持待处理'),{code:'source_verification_unavailable'});
  const sourceSlot=scoped?{...scoped,id:scoped.demandId}:null;
  const ready=async phase=>{if(scoped&&(await verifyReady({scope:scoped,phase,signal}))?.ready!==true)throw Error('站点迁移、发布目标或独占写入尚未确认');};
  await mkdir(home,{recursive:true,mode:0o700});
  return withFileLock(join(home,'worker.lock'),async()=>{
    const outbox=new CenterOutbox({directory:join(home,'outbox'),client});
    const activeFile=join(home,'active-claim.json');
    const confirmChineseReceipt=async(chinese)=>{
      if(!chinese?.requestId||!chinese?.workId||chinese?.editions?.length!==1||chinese.editions[0].locale!=='zh-CN')throw Error('英文稿缺少原中文稿');
      const receipt=await client.submission(chinese.requestId),item=receipt?.editions?.[0];
      if(receipt?.status!=='accepted'||receipt.requestId!==chinese.requestId||receipt.workId!==chinese.workId||receipt.workspaceId!==chinese.workspaceId||receipt.editions?.length!==1||item?.locale!=='zh-CN'||item.hash!==protocol.hash(chinese.editions[0])||item.revision!==chinese.baseRevisions?.['zh-CN']+1)throw Error('原中文稿尚无匹配的 Center 已接收回执');
    };
    const retainUnverifiedReceipt=async(packet,directory)=>{
      // Lookup never authorizes a POST or marks an old, unproven packet as
      // source-verified. Keep a matching accepted receipt only for review.
      let receipt;try{receipt=await client.submission(packet.requestId);}catch{return;}
      if(receipt?.status!=='accepted'||receipt.requestId!==packet.requestId||receipt.workId!==packet.workId||receipt.workspaceId!==packet.workspaceId||!Array.isArray(receipt.editions)||receipt.editions.length!==packet.editions.length||packet.editions.some(e=>!receipt.editions.some(r=>r.locale===e.locale&&r.hash===protocol.hash(e)&&r.revision===packet.baseRevisions[e.locale]+1)))return;
      const file=join(directory,packet.editions[0].locale+'.unverified-receipt.json'),old=await read(file);if(old&&protocol.hash(old)!==protocol.hash(receipt))throw Error('原提交回执发生变化，已保留等待核对');if(!old)await save(file,receipt);
    };
    const attest=async(packet,original,{receiptOnly=false}={})=>{
      requireScopedPacket(packet,scoped);requireScopedClaim(original,scoped);
      if(packet.claimToken!==original.claimToken)throw Error('待提交稿件不属于原认领');
      const directory=join(home,'jobs',protocol.hash(original.id+':'+original.generation));
      const stored=await read(join(directory,'claim.json')),context=await read(join(directory,'context.json')),snapshot=await read(join(directory,'writing-skills.json'));
      if(!stored||stored.id!==original.id||stored.generation!==original.generation||stored.claimToken!==original.claimToken||!context?.writingPolicy||!snapshot)throw Error('原任务缺少可验证的写作技能快照，已保留等待核对');
      const scope=centerWritingScope(original,writingSkillScope);
      validateCenterSkillSnapshot(snapshot,{claim:original,scope,writingPolicy:context.writingPolicy});
      const signature=packet.editions[0].metadata.notebook.modelSignatures.at(-1);
      const skills=snapshot.skills.map(({id,version,contentHash})=>({id,version,contentHash}));
      if(signature.writingSkillSnapshotHash!==snapshot.snapshotHash||protocol.canonical(signature.writingSkills)!==protocol.canonical(skills))throw Error('稿件与原任务写作技能快照不一致，已保留等待核对');
      let sourceEvidence;try{
        sourceEvidence=await sourceStage.restore({claim:original,slot:sourceSlot,directory,signal,offline:receiptOnly});
        if(![sourceEvidence?.snapshot?.snapshotHash,sourceEvidence?.selectionHash,sourceEvidence?.bindingHash].every(x=>/^[a-f0-9]{64}$/.test(x||'')))throw Error('原任务来源快照或绑定缺失');
        await requireSourceProof(join(directory,packet.editions[0].locale+'.packet-source-binding.json'),sourceEvidence,packet);
        if(!receiptOnly)await verifyVerifiedBibliography({snapshot:sourceEvidence.snapshot,directory,edition:packet.editions[0],signal});
        // An already accepted receipt is reconciled by its original packet
        // hash, never reposted or retroactively assigned new image evidence.
        if(receiptOnly){
          const historical=await read(join(directory,'zh-CN.image-receipt.json'));
          if(!historical?.images?.some(image=>image.provenance?.kind==='licensed-source')&&(await sourceStage.verifyEdition({claim:original,slot:sourceSlot,directory,edition:packet.editions[0],signal,offline:true}))?.ok!==true)throw Error('原稿来源核验未通过');
        }else{const credits=await imageCreditContext({directory,claim:original,client,edition:packet.editions[0]});
         if((await sourceStage.verifyEdition({claim:original,slot:sourceSlot,directory,edition:packet.editions[0],signal,...credits}))?.ok!==true)throw Error('原稿来源核验未通过');}
      }catch(error){await retainUnverifiedReceipt(packet,directory);throw error;}
      if(scoped.imagePlanRequired&&!receiptOnly){
        const edition=packet.editions[0];
        if(edition.locale==='en'){
          const chinese=await read(join(directory,'zh-CN.packet.json'));
          if(chinese?.workId!==packet.workId||chinese?.claimToken!==packet.claimToken||chinese?.editions?.[0]?.locale!=='zh-CN')throw Error('英文稿缺少原中文稿图片凭据');
          await confirmChineseReceipt(chinese);
          requireReusedTranslationImages(chinese.editions[0],edition,client.origin);
          const originalPlan=await read(join(directory,'zh-CN.image-plan.json')),originalReceipt=await read(join(directory,'zh-CN.image-receipt.json'));
          if(!originalPlan||!originalReceipt||originalPlan.claimId!==original.id||originalPlan.generation!==original.generation||originalReceipt.planHash!==protocol.hash(originalPlan)||originalReceipt.origin!==client.origin||originalReceipt.workspaceId!==original.workspaceId||!Array.isArray(originalReceipt.images))throw Error('英文稿缺少原中文稿图片验收凭据');
          const originalBound=bindImagePlan({plan:originalPlan,images:originalReceipt.images,origin:originalReceipt.origin});
          if(protocol.canonical(notebookImages({metadata:{notebook:originalBound.notebook}}))!==protocol.canonical(notebookImages(chinese.editions[0])))throw Error('英文稿的原图片与中文稿不一致');
          validateReusedImageCredits({edition,images:orderedOriginalImages({edition:chinese.editions[0],images:originalReceipt.images})});
          for(const image of originalReceipt.images){
            await verifyStoredVisualReview({directory,jobId:original.id,image});
            const remote=await client.request('/media/'+encodeURIComponent(image.id));
            if(remote?.id!==image.id||remote.workspaceId!==original.workspaceId||protocol.hash(remote.manifest)!==protocol.hash(image.manifest))throw Error('Center 图片上传回执不匹配');
          }
        }else{
          const plan=await read(join(directory,'zh-CN.image-plan.json')),receipt=await read(join(directory,'zh-CN.image-receipt.json'));
          if(!plan||!receipt||plan.claimId!==original.id||plan.generation!==original.generation||plan.workId!==packet.workId||plan.locale!=='zh-CN'||plan.binding?.sectionId!==original.sectionId||plan.binding?.sourceHash!==protocol.hash(context.source||null)||plan.binding?.verifiedSourceSnapshotHash!==sourceEvidence.snapshot.snapshotHash||plan.binding?.verifiedSourceSelectionHash!==sourceEvidence.selectionHash||plan.binding?.verifiedSourceBindingHash!==sourceEvidence.bindingHash||plan.binding?.writingSkillSnapshotHash!==snapshot.snapshotHash||protocol.hash(plan.binding?.signature)!==protocol.hash(signature)||receipt.version!==1||receipt.planHash!==protocol.hash(plan)||receipt.origin!==client.origin||receipt.workspaceId!==original.workspaceId)throw Error('原稿缺少可验证的配图计划和上传回执');
          const bound=bindImagePlan({plan,images:receipt.images,origin:receipt.origin}),expected=notebookImages({metadata:{notebook:bound.notebook}}),actual=notebookImages(edition);
          if(expected.length<2||protocol.canonical(expected)!==protocol.canonical(actual))throw Error('稿件图片或图注与原配图计划不一致');
          for(const image of receipt.images){
            await verifyStoredVisualReview({directory,jobId:original.id,image});
            const remote=await client.request('/media/'+encodeURIComponent(image.id));
            if(remote?.id!==image.id||remote.workspaceId!==original.workspaceId||protocol.hash(remote.manifest)!==protocol.hash(image.manifest))throw Error('Center 图片上传回执不匹配');
          }
        }
        if(edition.bodyMarkdown!==notebookMarkdown(edition.metadata.notebook,{site:null,locale:edition.locale}))throw Error('稿件正文与包含图片的内容行不一致');
      }
    };
    const attestOutbox=async original=>{for(const entry of await outbox.list())if(['pending','needs_attention'].includes(entry.state))await attest(entry.packet,original);};
    const flushScoped=async original=>{for(const entry of await outbox.list())if(entry.state==='pending'){await attest(entry.packet,original);await ready('before_submission');await outbox.flushOne(entry.requestId);}};
    if(requiredModel)for(const entry of await outbox.list())if(['pending','needs_attention'].includes(entry.state))requirePilotPacket(entry.packet);
    if(scoped){await ready('before_recovery');for(const entry of await outbox.list())if(['pending','needs_attention'].includes(entry.state))requireScopedPacket(entry.packet,scoped);}
    else if(!storeOnly) await outbox.flush();
    else{
      for(const entry of await outbox.list()){
        if(entry.storeOnly!==true||demandId&&entry.packet.demandId!==demandId)continue;
        try{await client.submission(entry.requestId);}catch(error){if(error.status===404)continue;throw error;}
        const flushed=await outbox.flushOne(entry.requestId,{lookupOnly:true});
        if(flushed.state==='accepted')assertStoreOnlyReceipt(flushed.receipt,entry.packet,{workerId:client.workerId});
      }
    }
    let claim,offline=false;
    try{claim=await client.activeClaim();}
    catch(error){
      if(error.status>=400&&error.status<500&&![408,429].includes(error.status))throw error;
      const cached=await read(activeFile);if(!cached||cached.origin!==client.origin||!cached.claim)throw error;
      claim=cached.claim;offline=true;
    }
    if(claim)await save(activeFile,{origin:client.origin,claim});
    if(scoped&&claim){requireScopedClaim(claim,scoped);for(const entry of await outbox.list())if(['pending','needs_attention'].includes(entry.state)&&entry.packet.claimToken!==claim.claimToken)throw Error('待提交稿件不属于当前认领');}
    if(claim?.state==='blocked'){
      if(!resume)return {state:'blocked',demandId:claim.id,message:claim.payload.lastError};
      if(scoped&&offline)throw Error('中心不可达，无法确认原认领');
      if(!offline){await ready('before_resume');await client.changeDemand(claim.id,{action:'resume',claimToken:claim.claimToken});claim=await client.activeClaim();if(scoped&&claim)requireScopedClaim(claim,scoped);}
    }
    if(scoped){
      if(claim){
        if(scoped.imagePlanRequired)for(const entry of await outbox.list())if(entry.state==='pending'){
          try{await client.submission(entry.requestId);}catch(error){if(error.status===404)continue;throw error;}
          await attest(entry.packet,claim,{receiptOnly:true});
          // Lookup only: an accepted historical request can be reconciled without
          // relaxing the evidence required for any new publication attempt.
          await outbox.flushOne(entry.requestId,{lookupOnly:true});
        }
        await attestOutbox(claim);await ready('before_recovery');await flushScoped(claim);claim=await client.activeClaim();if(claim)requireScopedClaim(claim,scoped);
      }else{
        // With no active claim an uncertain packet must not be POSTed. A
        // confirmed existing receipt can be reconciled by its original ID.
        for(const entry of await outbox.list())if(entry.state==='pending'){
          const saved=await read(activeFile);if(saved?.origin!==client.origin||!saved.claim)throw Error('原认领身份不可验证，待提交稿件已保留');
          if(!scoped.imagePlanRequired)await attest(entry.packet,saved.claim,{receiptOnly:true});
          try{await client.submission(entry.requestId);}catch(error){if(error.status===404)continue;throw error;}
          if(scoped.imagePlanRequired)await attest(entry.packet,saved.claim,{receiptOnly:true});
          await outbox.flushOne(entry.requestId,{lookupOnly:true});
        }
      }
      if(!claim){
        const accepted=(await outbox.list()).filter(e=>e.state==='accepted'&&e.packet.demandId===scoped.demandId&&e.receipt?.demandState==='completed');
        if(accepted.length){await clearCompletedClaim(home,client.origin,await outbox.list());return {state:'accepted',demandId:scoped.demandId,workId:accepted[0].packet.workId,submissions:accepted.map(e=>({requestId:e.requestId,state:e.state,receipt:e.receipt}))};}
      }
    }
    if(!claim){
      if(storeOnly){
        const done=(await outbox.list()).filter(entry=>entry.state==='accepted'&&entry.storeOnly===true&&(!demandId||entry.packet.demandId===demandId)&&entry.receipt?.demandState==='completed');
        if(done.length){
          for(const entry of done)assertStoreOnlyReceipt(entry.receipt,entry.packet,{workerId:client.workerId});
          await clearCompletedClaim(home,client.origin,await outbox.list());
          return {state:'accepted',demandId:demandId||done[0].packet.demandId,workId:done[0].packet.workId,submissions:done.map(entry=>({requestId:entry.requestId,state:entry.state,receipt:entry.receipt}))};
        }
      }
      // A flush can leave a request unresolved (or requiring attention).
      // Preserve the original packet and do not claim another demand until
      // its receipt is reconciled. An already active claim may still resume.
      const unresolved=(await outbox.list()).filter(entry=>entry.state!=='accepted');
      const blocking=storeOnly&&demandId?[]:unresolved;
      if(blocking.length){
        await client.heartbeat({state:'blocked',agentId,message:'原提交尚未确认，已保留并停止领取'}).catch(()=>{});
        return {state:'pending',message:'原提交尚未确认，已保留并停止领取'};
      }
      await save(activeFile,{origin:client.origin,claim:null});await ready('before_claim');
      claim=await client.claim(storeOnly?storeOnlyClaimBody({workspaceIds,sectionIds,demandId}):{workspaceIds,sectionIds,...(demandId?{demandId}:{})});
    }
    if(!claim){await client.heartbeat({state:'idle',agentId});return {state:'idle'};}
    // Save a newly acquired identity before any later validation or network
    // operation, so an ineligible claim can still be released or recovered.
    await save(activeFile,{origin:client.origin,claim});
    if(claim.payload?.storeOnly===true){
      if(!storeOnly)throw Object.assign(Error('Store-only demand requires --store-only / storeOnly:true'),{code:'store_only_required',status:403});
      await requireStoreOnlyContract(client);
    }else if(storeOnly)throw Object.assign(Error('Claim is not store-only'),{code:'not_store_only',status:409});
    if(!workspaceIds.includes(claim.workspaceId)||sectionIds.length&&!sectionIds.includes(claim.sectionId))throw Error('The active demand is outside the selected scope; resume that scope or release it explicitly');
    if(scoped)try{requireScopedClaim(claim,scoped);}catch(error){try{await client.changeDemand(claim.id,{action:'blocked',claimToken:claim.claimToken,message:error.message});}catch{}throw error;}
    if(requiredModel&&(claim.kind!=='write'||claim.payload.requiredLocales?.length!==1||claim.payload.requiredLocales[0]!=='zh-CN')){
      const message='当前需求不属于研究方法中文试点，已保留等待核对';
      try{await client.changeDemand(claim.id,{action:'blocked',claimToken:claim.claimToken,message});}catch{/* The original claim remains saved for recovery. */}
      throw Error(message);
    }
    const directory=join(home,'jobs',protocol.hash(claim.id+':'+claim.generation));await mkdir(directory,{recursive:true,mode:0o700});
    const claimFile=join(directory,'claim.json');await save(claimFile,claim);
    if(scoped)try{await sourceStage.restore({claim,slot:sourceSlot,directory,signal});}catch(error){
      await client.changeDemand(claim.id,{action:'blocked',claimToken:claim.claimToken,message:String(error.message).slice(0,2000)}).catch(()=>{});
      await client.heartbeat({state:'blocked',agentId,message:String(error.message).slice(0,2000)}).catch(()=>{});
      await save(join(directory,'failure.json'),{message:error.message,at:new Date().toISOString(),...(error.diagnostics?{diagnostics:error.diagnostics}:{})});throw error;
    }
    const translateSource=claim.kind==='translate'?requireTranslateClaim(claim):null;
    const workId=translateSource?.workId||claim.payload.workId||claim.payload.source?.workId||'work-'+protocol.hash(claim.id).slice(0,32);
    const contextFile=join(directory,'context.json');
    let context=await read(contextFile);
    if(!context){
      let work=null;try{work=await client.work(workId);}catch(error){if(error.status!==404)throw error;}
      const deliveryInstructions=platformProductionInstructions(claim);
      context={work,writingPolicy:deliveryInstructions?{...writingPolicy,instructions:writingPolicy.instructions+deliveryInstructions,deliverySchemaVersion:1}:writingPolicy,baseRevisions:Object.fromEntries((work?.editions||[]).map(e=>[e.locale,e.revision]))};
      if(claim.payload.source){const source=claim.payload.source;context.source=await client.request('/works/'+encodeURIComponent(source.workId)+'/editions/'+source.locale+'/'+source.revision);if(translateSource)assertBoundSourceCurrent(claim,context.work,context.source);}
      await save(contextFile,context);
    }
    // Compatibility with claims created before common policy snapshots existed.
    if(!context.writingPolicy){context.writingPolicy=writingPolicy;await save(contextFile,context);}
    if(translateSource){
      let liveWork=context.work,liveSource=context.source;
      try{liveWork=await client.work(workId);liveSource=await client.request('/works/'+encodeURIComponent(translateSource.workId)+'/editions/'+translateSource.locale+'/'+translateSource.revision);}
      catch(error){if(error.status&&error.status<500&&![408,429].includes(error.status))throw error;}
      assertBoundSourceCurrent(claim,liveWork,liveSource);
    }
    await save(activeFile,{origin:client.origin,claim});
    const heartbeat=()=>client.heartbeat({state:'running',agentId,message:claim.title}).catch(()=>{});
    await heartbeat();const timer=setInterval(heartbeat,30000);timer.unref?.();
    try{
      const results=[];
      const locales=[...claim.payload.requiredLocales].filter(locale=>!translateSource||locale!==translateSource.locale).sort((a,b)=>a===b?0:a==='zh-CN'?-1:1);
      if(translateSource&&!locales.length)throw Error('Translate claim has no target locale after excluding the Chinese source');
      for(const locale of locales){
        if(claim.payload.submittedLocales?.includes(locale))continue;
        if(signal?.aborted)throw Error('Work was paused on this device');
        const packetFile=join(directory,locale+'.packet.json');let packet=await read(packetFile);
        if(!packet){
          onEvent({type:'producing',demandId:claim.id,locale,agentId});
          let translationOf=null,source=context.source,chinesePacket=null;
          if(source&&claim.payload?.source?.workId&&!source.workId)source={...source,workId:claim.payload.source.workId};
          if(claim.kind==='translate')translationOf=claim.payload.source;
          else if(locale==='en'&&claim.payload.requiredLocales.includes('zh-CN')){
            const chinese=await read(join(directory,'zh-CN.packet.json'));
            const old=context.work?.editions.find(e=>e.locale==='zh-CN');
            if(chinese){if(scoped?.imagePlanRequired)await confirmChineseReceipt(chinese);chinesePacket=chinese;source={payload:chinese.editions[0]};translationOf={workId,locale:'zh-CN',revision:chinese.baseRevisions['zh-CN']+1};}
            else if(old){source=old;translationOf={workId,locale:'zh-CN',revision:old.revision};}
          }
          const resultFile=join(directory,locale+'.result.json');
          let output=await read(resultFile);
          if(!output){
            const recovered=await recoverPersistedCenterEdition({directory,locale,source,origin:client.origin,workspaceId:claim.workspaceId,sectionId:claim.sectionId,agentId,demandId:claim.id,generation:claim.generation,workerId:claim.workerId||client.workerId||claim.payload?.storeOnlyWorkerId,sourceHash:claim.payload?.sourceHash,strictRegisteredImages:claim.kind==='translate'});
            const evidence=scoped?await sourceStage.restore({claim,slot:sourceSlot,directory,signal}):null;
            if(scoped){sourceProof(evidence,null);if(typeof evidence.prompt!=='string'||!evidence.prompt)throw Error('原任务来源正文材料缺失');}
            const bibliography=scoped?await prepareVerifiedBibliography({snapshot:evidence.snapshot,directory,signal}):null;
            if(recovered?.edition){output=recovered.edition;if(recovered.repair)onEvent({type:'notebook_repaired',demandId:claim.id,locale,repair:recovered.repair});}
            else{
            let imageInstructions;if(scoped?.imagePlanRequired&&locale==='en'){if(!chinesePacket)throw Error('英文稿缺少原中文稿图片凭据');await attest(chinesePacket,claim);const originalReceipt=await read(join(directory,'zh-CN.image-receipt.json'));imageInstructions=imageTranslationInstructions({edition:chinesePacket.editions[0],images:originalReceipt.images});}
            output=await producer({claim,locale,workId,source,directory,agentId,origin:client.origin,...(scoped?{expectedModel:scoped.modelId,verifiedSourcePrompt:evidence.prompt,verifiedSourceSnapshotHash:evidence.snapshot.snapshotHash,verifiedSourceSelectionHash:evidence.selectionHash,verifiedSourceBindingHash:evidence.bindingHash}:{}),...(scoped?.imagePlanRequired&&locale==='zh-CN'?{imagePlanRequired:true}:{}),...(imageInstructions?{imageTranslationInstructions:imageInstructions}:{}),...(bibliography?{verifiedBibliographyInstructions:VERIFIED_BIBLIOGRAPHY_INSTRUCTIONS}:{}),signal,onEvent,writingPolicy:context.writingPolicy});
            }
            if(requiredModel||scoped)requirePilotEdition(output);
            if(bibliography)output=applyVerifiedBibliography(output,bibliography,locale);
            let fresh=null;if(scoped)try{fresh=await sourceStage.restore({claim,slot:sourceSlot,directory,signal});if(protocol.canonical(sourceProof(evidence,output))!==protocol.canonical(sourceProof(fresh,output)))throw Error('写作期间原来源发生变化，已保留结果等待核对');}catch(error){await save(resultFile,output);throw error;}
            await save(resultFile,output);if(scoped)await save(join(directory,locale+'.result-source-binding.json'),sourceProof(fresh,output));
          }
          if(requiredModel||scoped)requirePilotEdition(output);
          if(scoped){const evidence=await sourceStage.restore({claim,slot:sourceSlot,directory,signal});await requireSourceProof(join(directory,locale+'.result-source-binding.json'),evidence,output);requireScopedSkills(output);verifyAutomatedReferences(output);const verifiedEdition={...output,locale};await verifyVerifiedBibliography({snapshot:evidence.snapshot,directory,edition:verifiedEdition,signal});const credits=await imageCreditContext({directory,claim,client,edition:verifiedEdition});if((await sourceStage.verifyEdition({claim,slot:sourceSlot,directory,edition:verifiedEdition,signal,...credits}))?.ok!==true)throw Error('原稿来源核验未通过');}
          output=await prepareEditionMedia({edition:output,home,directory,client,workspaceId:claim.workspaceId,signal,source:chinesePacket?.editions[0]||source?.payload||source});
          if(claim.payload.writingDefaults){
            const baseline=writingDefaults.snapshot(claim.payload.writingDefaults,{workspaceId:claim.workspaceId,sectionId:claim.sectionId});
            if(output.metadata?.writingDefaults?.baselineHash!==baseline.hash)throw Object.assign(Error('稿件缺少原认领的线上写作基线'),{code:'writing_defaults_conflict'});
            const issues=writingDefaults.deliveryIssues(output.metadata?.notebook,baseline);if(issues.length)throw Object.assign(Error(issues.join('；')),{code:'writing_delivery_incomplete'});
          }
          // New packets only: a saved packet keeps its exact bytes and request hash.
          output=withEditionByline(output,{source,site:siteByline(profiles,claim.workspaceId,claim.sectionId)});
          packet=protocol.submission({requestId:randomUUID(),workId,workspaceId:claim.workspaceId,sectionId:claim.sectionId,
            demandId:claim.id,claimToken:claim.claimToken,baseRevisions:{[locale]:context.baseRevisions[locale]||0},
            editions:[{...output,locale,translationOf}]});
          if(translateSource){if(locale===translateSource.locale)throw Error('Translation must not rewrite the source edition');requireTranslatePacket(packet,claim);}
          // Durable packet exists before the first request is made.
          await save(packetFile,packet);
          if(scoped){const evidence=await sourceStage.restore({claim,slot:sourceSlot,directory,signal});await requireSourceProof(join(directory,locale+'.result-source-binding.json'),evidence,await read(resultFile));await save(join(directory,locale+'.packet-source-binding.json'),sourceProof(evidence,packet));}
        }else{
          const chinese=locale==='en'?await read(join(directory,'zh-CN.packet.json')):null;
          const completed=await completeStoredEdition({packet,home,directory,client,signal,source:chinese?.editions?.[0]||context.source?.payload||context.source});
          if(protocol.hash(completed)!==protocol.hash(packet)){
            await save(packetFile,completed);
            if((await outbox.list()).some(entry=>entry.requestId===packet.requestId))await outbox.repairUnsubmitted(packet.requestId,completed);
            packet=completed;
          }
        }
        if(requiredModel)requirePilotPacket(packet);
        if(translateSource)requireTranslatePacket(packet,claim);
        if(scoped){await attest(packet,claim);await attestOutbox(claim);await ready('before_submission');}
        await outbox.enqueue(packet,{storeOnly:storeOnly===true||claim.payload?.storeOnly===true});if(scoped){await attestOutbox(claim);await attest(packet,claim);await ready('before_submission');}else if(!storeOnly) await outbox.flush();
        else await outbox.flushOne(packet.requestId);
        const result=await outbox.flushOne(packet.requestId,{retry:resume});
        if(storeOnly&&result.state==='accepted')assertStoreOnlyReceipt(result.receipt,packet,{workerId:client.workerId||claim.payload?.storeOnlyWorkerId});
        results.push(result);
        onEvent({type:result.state,demandId:claim.id,locale,requestId:packet.requestId});
        if(result.state==='needs_attention')throw Object.assign(Error(result.error?.message||'Submission needs attention'),{code:result.error?.code,status:result.error?.status});
        // Continue producing the remaining language even if the center goes offline.
      }
      const pending=results.some(r=>r.state==='pending');
      if(!pending)await clearCompletedClaim(home,client.origin,await outbox.list());
      await client.heartbeat({state:pending?'blocked':'idle',agentId,message:pending?'Content is retained locally; waiting for the center':''}).catch(()=>{});
      return {state:pending?'pending':'accepted',demandId:claim.id,workId,submissions:results.map(r=>({requestId:r.requestId,state:r.state,receipt:r.receipt}))};
    }catch(error){
      await client.changeDemand(claim.id,{action:'blocked',claimToken:claim.claimToken,message:String(error.message).slice(0,2000)}).catch(()=>{});
      await client.heartbeat({state:'blocked',agentId,message:String(error.message).slice(0,2000)}).catch(()=>{});
      await save(join(directory,'failure.json'),{message:error.message,at:new Date().toISOString(),...(error.diagnostics?{diagnostics:error.diagnostics}:{})});
      throw error;
    }finally{clearInterval(timer);}
  },{timeout:100});
}
