import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,dirname,basename} from 'node:path';
import {atomicJson,optionalJson} from '../../../scripts/editorial-sync.mjs';
import {withFileLock} from '../../../scripts/editorial-lock.mjs';
import {contained,readDraft,saveDraft} from '../../../scripts/editorial-workspace.mjs';
import {markdownImages} from '../../../scripts/article-format.mjs';
import {isArticleType} from './task-types.mjs';
import {domainType} from './domain-pack.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
async function writeImage(root,relative,bytes){
 await mkdir(join(root,dirname(relative)),{recursive:true});const dir=await contained(root,dirname(relative));
 try{await writeFile(join(dir,basename(relative)),bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;const existing=await readFile(await contained(root,relative));if(!existing.equals(bytes))throw Error('图片文件已改变，保留现有文件');}
}
export function imageSlots(task){
 // Unified boards own their explicit image rows; legacy defaults apply only to legacy workflows.
 if(task.notebook)return [];
 const blocks=task.outline.blocks.filter(b=>b.type==='image').map(b=>({id:b.id,prompt:b.text}));
 if(isArticleType(task.mode)&&task.articleId){
  const subject=task.outline.titleCandidates?.[task.outline.selectedTitle||0]||task.title||'当前文章';
  const descriptions=domainType(task.mode).illustrations;
  const ids=new Set(task.outline.blocks.map(b=>b.id));
  while(blocks.length<2){const number=blocks.length+1;let id='default-image-'+task.articleId+'-'+number;while(ids.has(id))id+='-slot';ids.add(id);blocks.push({id,prompt:subject+'：'+descriptions[number-1]+'。编辑完成后由用户生成或导入；仅安排示意，不编造数据、截图或照片。'});}
 }
 return blocks.map(b=>({...b,path:'assets/placeholders/'+hash(b.id).slice(0,20)+'.png'}));
}
export async function ensurePlaceholders(root,task){
 const slots=imageSlots(task);if(!slots.length)return;
 const draft=await readDraft(task.articleId,root),base=dirname(join(root,draft.canonicalPath));
 const sharp=(await import('sharp')).default;
 for(const slot of slots){const target=join(base,slot.path);await mkdir(dirname(target),{recursive:true});await contained(base,dirname(slot.path));const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="560"><rect width="1000" height="560" rx="24" fill="#eeeae2"/><rect x="350" y="140" width="300" height="190" rx="12" fill="none" stroke="#a5a098" stroke-width="4" stroke-dasharray="12 8"/><path d="M395 280l65-65 58 50 45-35 50 50" fill="none" stroke="#a5a098" stroke-width="5"/><text x="500" y="405" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#77736d">待配图 · 编辑完成后生成或导入</text></svg>';await writeImage(base,slot.path,await sharp(Buffer.from(svg)).png().toBuffer());}
}
export async function saveGallery(root,task,bytes,name,origin='generated'){
 if(!['generated','imported'].includes(origin))throw Error('图片来源类型无效');
 const sharp=(await import('sharp')).default,meta=await sharp(bytes,{limitInputPixels:64000000}).metadata();if(!['png','jpeg','webp'].includes(meta.format)||(meta.pages||1)>1)throw Error('仅支持静态图片');
 const id=hash(bytes).slice(0,24),dir=join(root,'.local/workbench/gallery');await mkdir(dir,{recursive:true});const path='.local/workbench/gallery/'+id+'.'+meta.format;await writeImage(root,path,bytes);
 const item={id,articleId:task.articleId,taskId:task.id,storage:'gallery',origin,path,originalPath:path,name:String(name||task.brief||'生成配图').slice(0,160),createdAt:new Date().toISOString(),width:meta.width,height:meta.height};
 const index=join(dir,'index.json');await withFileLock(index+'.lock',async()=>{const values=await optionalJson(index)||[];await atomicJson(index,[item,...values.filter(x=>x.id!==id||x.taskId!==task.id)]);});return item;
}
export async function galleryList(store){
 const generated=await optionalJson(join(store.base,'gallery/index.json'))||[],tasks=await store.list();
 const index=await optionalJson(join(store.root,'_ops/inventory/article-index.json'))||{articles:{}};
 const existing=tasks.flatMap(t=>t.assets.filter(a=>a.storage!=='gallery'&&index.articles?.[a.articleId]&&!t.assets.some(b=>b.replaces===a.id)).map(a=>({...a,taskId:t.id,taskTitle:t.title})));
 const titles=new Map(tasks.map(t=>[t.id,t.title]));
 const notebook=tasks.flatMap(t=>{
  const used=new Set();return (t.notebook?.blocks||[]).filter(b=>b.type==='image'&&b.state==='ready').flatMap((b,index)=>{
   const a=t.notebook.assets?.[b.text];if(!a||used.has(a.id)||!/^assets\/notebook\/[a-f0-9]{64}\.webp$/.test(a.path))return [];used.add(a.id);
   const provenance=Object.fromEntries(['origin','sourceUrl','creator','license','licenseUrl'].filter(k=>a[k]!==undefined).map(k=>[k,a[k]]));
   return [{...a,articleId:t.articleId,taskId:t.id,taskTitle:t.notebook.title||t.title,storage:'notebook',name:b.alt||`${t.notebook.title||t.title} · 配图 ${index+1}`,description:b.requirement||'',provenance}];
  });
 });
 return [...generated,...existing,...notebook].map(a=>({...a,taskTitle:a.taskTitle||titles.get(a.taskId),key:a.taskId+':'+a.id}));
}
export async function galleryBytes(store,taskId,assetId){
 const registered=(await optionalJson(join(store.base,'gallery/index.json'))||[]).find(x=>x.taskId===taskId&&x.id===assetId);
 if(registered)return readFile(await contained(store.root,registered.originalPath));
 const t=await store.get(taskId),notebook=Object.values(t.notebook?.assets||{}).find(a=>a.id===assetId&&t.notebook.blocks.some(b=>b.type==='image'&&b.text===a.path));
 if(notebook&&/^assets\/notebook\/[a-f0-9]{64}\.webp$/.test(notebook.path)){
  try{return await readFile(await contained(join(store.dir(taskId),'images'),basename(notebook.path)));}catch(e){if(e.code!=='ENOENT')throw e;}
  const draft=await readDraft(t.articleId,store.root);return readFile(await contained(dirname(join(store.root,draft.canonicalPath)),notebook.path));
 }
 const asset=t.assets.find(a=>a.id===assetId);if(!asset)throw Error('图片不存在');if(asset.storage==='gallery')return readFile(await contained(store.root,asset.originalPath));const d=await readDraft(asset.articleId,store.root);return readFile(await contained(dirname(join(store.root,d.canonicalPath)),asset.originalPath));
}
export async function articleImages(store,articleId){
 const draft=await readDraft(articleId,store.root),task=(await store.list()).find(t=>t.articleId===articleId&&t.mode!=='image');
 return {sha:draft.sha256,slots:markdownImages(draft.markdown).filter(p=>p.startsWith('assets/placeholders/')).map(path=>({...imageSlots(task||{outline:{blocks:[]}}).find(s=>s.path===path),path})),taskId:task?.id};
}
export async function replaceImageSlot(store,p){
 const owner='editor-image-'+randomUUID();await store.lease(p.articleId,owner);
 try{
  const draft=await readDraft(p.articleId,store.root);if(draft.sha256!==p.expectedSha)throw Error('文章已有修改，请保存并重新读取配图卡');
  if(!p.slotPath?.startsWith('assets/placeholders/')||!markdownImages(draft.markdown).includes(p.slotPath))throw Error('配图占位已改变，未覆盖正文');
  let bytes;if(p.data){if(typeof p.data!=='string'||p.data.length>6000000)throw Error('图片过大');bytes=Buffer.from(p.data,'base64');}else bytes=await galleryBytes(store,p.sourceTaskId,p.assetId);
  const sharp=(await import('sharp')).default,meta=await sharp(bytes,{limitInputPixels:64000000}).metadata();if(!['png','jpeg','webp'].includes(meta.format)||(meta.pages||1)>1)throw Error('请选择 PNG、JPEG 或 WebP 静态图片');
  const key=hash(bytes).slice(0,24),base=dirname(join(store.root,draft.canonicalPath)),relative='assets/source/'+key+'.'+meta.format;
  await mkdir(join(base,'assets/source'),{recursive:true});await writeImage(base,relative,bytes);
  // Store original bytes; the existing publish pipeline applies the watermark once.
  return await saveDraft({id:p.articleId,markdown:draft.markdown.split(p.slotPath).join(relative),expectedSha256:draft.sha256},store.root);
 }finally{await store.lease(p.articleId,owner,true);}
}
