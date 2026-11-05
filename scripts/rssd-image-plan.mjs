// Draft image plan contract; not attached to any producer or publishing worker.
import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import protocol from '../contracts/rssd-v1.cjs';
import {withFileLock} from './editorial-lock.mjs';
import {generatedCaption} from './rssd-image-disclosure.mjs';

export const CENTER_IMAGE_PLAN_OUTPUT=`只返回一个 JSON 对象（不要围栏或说明），格式为 {"notebook":{"version":2,"kind":"article","title":"标题","skills":[],"fields":{},"groups":[],"blocks":[],"sources":[],"blockNotes":{},"internalNotes":{}},"summary":"摘要","metadata":{},"imagePlan":[]}。正文使用完整 notebook v2，正文、来源与内部备注按写作协议分开。安排至少两个必要图片槽位：一个题图和一个正文图。每个图片行用稳定唯一的 blockId、type=image、state=placeholder、text=""、sourceIds=[]；紧接对应图片行配一条 type=annotation、role=caption、targetId=对应 blockId、state=placeholder、text="" 的图注行，图片和图注之间不要插入其他行。imagePlan 每项为 {"blockId":"对应图片行 ID","requirement":"与文章有关的画面要求","alt":"20–60 字的画面说明","caption":"公开图注"}。只描述用途，不要虚构图片 URL、素材 ID 或文件路径；程序稍后会生成或登记图片。其他正文行必须完整且 state=ready。不要自填 modelSignatures。`;

function invalid(message){return Object.assign(Error(message),{code:'image_plan_invalid'});}
function attributionPending(message){return Object.assign(Error(message),{code:'image_pending'});}
function label(value){return String(value).replace(/[\\`*_{}\[\]<>]/g,'\\$&').replace(/[\r\n]/g,' ').trim();}
function safeHttps(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!/[\s()]/.test(value)&&u.href===value;}catch{return false;}}
const knownLicenses=new Map([['https://creativecommons.org/licenses/by/4.0/','CC BY 4.0'],['https://creativecommons.org/publicdomain/zero/1.0/','CC0 1.0']]);
function publicCaption(caption,provenance,locale,{version=2}={}){
 const english=locale==='en';
 const separator=version>=3&&!english&&/[。！？]$/.test(caption)?' ':' · ';
 if(provenance?.kind==='generated'){
  const text=generatedCaption(caption,provenance,locale);
  return separator===' '&&text.startsWith(caption+' · ')?caption+' '+text.slice(caption.length+3):text;
 }
 if(provenance?.kind==='licensed-source'){
  const {creator,sourceUrl,license,licenseUrl,changes,licenseEvidence}=provenance;
  if(typeof creator!=='string'||!creator.trim()||!safeHttps(sourceUrl)||!safeHttps(licenseUrl)||knownLicenses.get(licenseUrl)!==license||changes!=='unchanged'||licenseEvidence?.url!==sourceUrl||!/^[a-f0-9]{64}$/.test(licenseEvidence?.sha256||'')||typeof licenseEvidence?.quote!=='string'||!licenseEvidence.quote.trim()||typeof licenseEvidence?.reviewedBy!=='string'||!licenseEvidence.reviewedBy.trim()||!Number.isFinite(Date.parse(licenseEvidence?.reviewedAt)))throw attributionPending('Licensed image attribution or change evidence is incomplete');
  return caption+separator+(english?'Source: ':'来源：')+label(creator)+' (['+(english?'source':'原文')+']('+sourceUrl+')); '+(english?'license: ':'许可：')+'['+label(license)+']('+licenseUrl+'); '+(english?'unchanged original image':'原图未修改');
 }
 if(provenance?.kind==='code')return caption;
 throw attributionPending('Image provenance is unavailable');
}
async function optional(file){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function save(file,value){const temp=file+'.'+randomUUID();try{await writeFile(temp,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});await rename(temp,file);}finally{await rm(temp,{force:true});}}

/** Freeze the original draft and unresolved images before any image request. */
export async function freezeImagePlan({directory,claimId,generation,workId,locale,result,binding,minimumSlots=2}){
 protocol.id(claimId,'claimId');protocol.id(workId,'workId');protocol.locale(locale);
 if(!Number.isSafeInteger(generation)||generation<0)throw invalid('Invalid claim generation');
 const draft=structuredClone(result),n=draft?.notebook,slots=draft?.imagePlan;
 if(n?.version!==2||!Array.isArray(n.blocks)||!Array.isArray(slots)||slots.length<minimumSlots)throw invalid('Required image plan is incomplete');
 const ids=new Set(),images=n.blocks.filter(b=>b.type==='image'&&b.state==='placeholder');
 if(new Set(n.blocks.map(b=>b.id)).size!==n.blocks.length||images.length!==slots.length)throw invalid('Image slots are missing or ambiguous');
 for(const slot of slots){
  protocol.id(slot?.blockId,'blockId');if(ids.has(slot.blockId))throw invalid('Image slot repeated');ids.add(slot.blockId);
  const image=images.find(b=>b.id===slot.blockId),caption=n.blocks.find(b=>b.role==='caption'&&b.targetId===slot.blockId);
  if(!image||image.text||!caption||!['ready','placeholder'].includes(caption.state))throw invalid('Image slot or caption is not bound');
  if(typeof slot.requirement!=='string'||!slot.requirement.trim()||slot.requirement.length>3500||typeof slot.alt!=='string'||[...slot.alt.trim()].length<20||[...slot.alt.trim()].length>60||typeof slot.caption!=='string'||!slot.caption.trim()||(slot.referenceSha256!==undefined&&!/^[a-f0-9]{64}$/.test(slot.referenceSha256)))throw invalid('Image slot requirements are incomplete');
  if(caption.state==='ready'&&caption.text!==slot.caption)throw invalid('Existing caption must remain unchanged');
 }
 if(n.blocks.some(b=>b.state==='placeholder'&&b.type!=='image'&&!(b.role==='caption'&&ids.has(b.targetId))))throw invalid('Non-image placeholders remain');
 const plan={version:3,claimId,generation,workId,locale,draft,slots:structuredClone(slots),...(binding?{binding:structuredClone(binding)}:{})};
 const dir=resolve(directory);await mkdir(dir,{recursive:true,mode:0o700});const file=join(dir,locale+'.image-plan.json');
 return withFileLock(file+'.lock',async()=>{
  const prior=await optional(file);if(prior&&(![1,2,3].includes(prior.version)||protocol.hash(prior)!==protocol.hash({...plan,version:prior.version})))throw invalid('Original image plan already exists with different content');
  if(!prior)await save(file,plan);return prior||plan;
 });
}

/** Bind only verified, uploaded images; do not parse or submit the edition. */
export function bindImagePlan({plan,images,origin}){
 if(![1,2,3].includes(plan?.version)||!Array.isArray(plan.slots)||!Array.isArray(images))throw invalid('Image plan is unavailable');
 const base=new URL(origin).origin;if(base!==origin)throw invalid('Center origin is invalid');
 if(images.length!==plan.slots.length||new Set(images.map(x=>x.blockId)).size!==images.length)throw invalid('Required images are missing');
 const result=structuredClone(plan.draft),n=result.notebook;
 for(const slot of plan.slots){
  const image=images.find(x=>x.blockId===slot.blockId),block=n.blocks.find(x=>x.id===slot.blockId),caption=n.blocks.find(x=>x.role==='caption'&&x.targetId===slot.blockId);
  if(!image||image.uploaded!==true||!image.registration||!image.provenance||block?.state!=='placeholder'||block.text||!caption)throw invalid('Required image has not been uploaded and registered');
  protocol.id(image.id,'mediaId');
  if(image.url!==base+'/api/rssd/v1/media/'+image.id+'/raw'||image.alt!==slot.alt||image.caption!==slot.caption)throw invalid('Image binding differs from the frozen plan');
  if(plan.version>=2&&n.blocks[n.blocks.indexOf(block)+1]!==caption)throw attributionPending('Image caption is not adjacent to its image');
  block.text=image.url;block.state='ready';block.alt=image.alt;
  caption.text=plan.version>=2?publicCaption(slot.caption,image.provenance,plan.locale,{version:plan.version}):slot.caption;caption.state='ready';
  const prior=n.blockNotes?.[slot.blockId]?.notes?.images||'';
  const note='图片来源类型：'+image.provenance.kind+'；素材 SHA-256：'+image.manifest.sha256+'；图库登记任务：'+image.registration.taskId+'。';
  n.blockNotes||={};n.blockNotes[slot.blockId]||={notes:{}};n.blockNotes[slot.blockId].notes||={};n.blockNotes[slot.blockId].notes.images=prior?prior+'\n\n'+note:note;
 }
 delete result.imagePlan;
 return result;
}
