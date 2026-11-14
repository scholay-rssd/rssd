import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import rules from '../contracts/writing-defaults-v1.cjs';
import media from '../contracts/rssd-media.cjs';
import {normalizeNotebookResult} from '../contracts/notebook-output.mjs';
import {formatErrors,publicUrl} from '../desktop/scripts/agent/notebook-model.mjs';
import {headingFormatErrors} from '../desktop/scripts/agent/notebook-headings.mjs';
import sharp from 'sharp';
export async function checkWritingDraft({draftFile,contextFile,assetsFile}){
 const effective=rules.context(JSON.parse(await readFile(contextFile,'utf8')));
 const value=normalizeNotebookResult(JSON.parse(await readFile(draftFile,'utf8'))),n=value?.notebook||value;
 const fieldIssues=formatErrors(n,{imageReference:text=>typeof text==='string'&&text.trim().length>0&&(!/^https?:/i.test(text)||publicUrl(text))});
 if(!fieldIssues.length)fieldIssues.push(...headingFormatErrors(n));
 const issues=[...fieldIssues.map(e=>e.path+'：'+e.message),...rules.deliveryIssues(n,effective)],blocks=Array.isArray(n?.blocks)?n.blocks.filter(b=>b&&typeof b==='object'):[],images=blocks.filter(b=>b.type==='image'&&b.state==='ready');
 if(typeof n?.title!=='string'||!n.title.trim()||!blocks.length||blocks.some(b=>b.state!=='ready'||typeof b.text!=='string'||!b.text.trim()))issues.push('文章标题或正文未完成');
 for(const id of Object.keys(n?.blockNotes||{}))if(!blocks.some(b=>b.id===id))issues.push('行间备注对应的内容行不存在：'+id);
 const assets=assetsFile?JSON.parse(await readFile(assetsFile,'utf8')):[];
 if(!Array.isArray(assets)||new Set(assets.map(a=>a?.blockId)).size!==assets.length)throw Error('图片资产清单须为没有重复 blockId 的数组');
 const checked=[];
 for(const image of images){
  const asset=assets.find(x=>x.blockId===image.id);
  if(!asset?.file){issues.push('图片缺少实际文件与来源记录：'+image.id);continue;}
  const file=resolve(dirname(assetsFile),asset.file),bytes=await readFile(file),manifest=media.imageManifest(bytes);
  const decoder=sharp(bytes),{width,height}=await decoder.metadata();await decoder.stats();
  if(!['licensed-source','owned','generated','computed'].includes(asset.kind))issues.push('图片来源类型无效：'+image.id);
  if(effective.images.sourceMode==='actual-object'&&!['licensed-source','owned'].includes(asset.kind))issues.push('本栏需要真实对象图片：'+image.id);
  if(asset.kind==='licensed-source'&&(!asset.sourceUrl||!asset.creator||!asset.license||!asset.licenseEvidence))issues.push('图片缺少来源、作者或许可依据：'+image.id);
  if(asset.kind==='computed'&&!asset.computationRecord)issues.push('计算图缺少运行记录：'+image.id);
  checked.push({blockId:image.id,kind:asset.kind,...manifest,width,height});
 }
 return {ok:issues.length===0,issues,measurements:rules.measurements(n),bodyLength:effective.bodyLength||null,version:effective.baseline.version,baselineHash:effective.baselineHash,catalogHash:effective.baseline.catalogHash,sourceCommit:effective.baseline.source.commit,adjustmentHash:rules.hash(effective.adjustment),images:checked};
}
