import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import rules from '../contracts/writing-defaults-v1.cjs';
import media from '../contracts/rssd-media.cjs';
export async function checkWritingDraft({draftFile,contextFile,assetsFile}){
 const context=JSON.parse(await readFile(contextFile,'utf8')),effective=rules.compose(context.baseline,context.adjustment);
 if(context.hash!==effective.hash||context.instructions!==effective.instructions)throw Error('本篇写作上下文或本地调整已变化');
 const value=JSON.parse(await readFile(draftFile,'utf8')),n=value.notebook||value,issues=rules.deliveryIssues(n,effective),images=n.blocks.filter(b=>b.type==='image'&&b.state==='ready');
 const assets=assetsFile?JSON.parse(await readFile(assetsFile,'utf8')):[];
 const checked=[];
 for(const image of images){
  const asset=assets.find(x=>x.blockId===image.id);
  if(!asset?.file){issues.push('图片缺少实际文件与来源记录：'+image.id);continue;}
  const file=resolve(dirname(assetsFile),asset.file),bytes=await readFile(file),manifest=media.imageManifest(bytes);
  if(!['licensed-source','owned','generated','computed'].includes(asset.kind))issues.push('图片来源类型无效：'+image.id);
  if(effective.images.sourceMode==='actual-object'&&!['licensed-source','owned'].includes(asset.kind))issues.push('本栏需要真实对象图片：'+image.id);
  if(asset.kind==='licensed-source'&&(!asset.sourceUrl||!asset.creator||!asset.license||!asset.licenseEvidence))issues.push('图片缺少来源、作者或许可依据：'+image.id);
  if(asset.kind==='computed'&&!asset.computationRecord)issues.push('计算图缺少运行记录：'+image.id);
  checked.push({blockId:image.id,kind:asset.kind,...manifest});
 }
 return {ok:issues.length===0,issues,version:effective.baseline.version,baselineHash:effective.baselineHash,catalogHash:effective.baseline.catalogHash,sourceCommit:effective.baseline.source.commit,adjustmentHash:rules.hash(effective.adjustment),images:checked};
}
