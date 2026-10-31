import {validatePrivateEditorial} from '../contracts/article-internal-notes.mjs';
import {validateSectionId} from '../contracts/site-sections.mjs';
import {publicationDirectory,siteForWorkspace} from './site-config.mjs';
import {readFile,writeFile,mkdir,realpath,rename,rm,stat,readdir} from 'node:fs/promises';
import {resolve,dirname,join,relative,sep,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {renderArticle,markdownImages} from './article-format.mjs';
import {publicationImage,PUBLICATION_IMAGE_MAX_BYTES} from './publication-images.mjs';
import {withFileLock} from './editorial-lock.mjs';
import {configuredWorkspace,workspaceInfo,selectWorkspace} from './editorial-location.mjs';
import {archiveCategories} from './archive-taxonomy.mjs';
import {validate} from '../admin/model.mjs';
import {recordFields,RECORD_STRUCTURE,structureFor,normalizeRecordMarkdown,recordStructureIssue} from './editorial-record.mjs';

export const workspaceRoot=configuredWorkspace();
export const sha=value=>createHash('sha256').update(value).digest('hex');
const idOf=id=>{if(typeof id!=='string'||!/^[a-z0-9][a-z0-9-]{2,99}$/.test(id))throw Error('Invalid article ID');return id;};
const maxBody=160000;
export async function contained(root,path){const base=await realpath(root),target=await realpath(resolve(base,path));if(!target.startsWith(base+sep))throw Error('Path leaves the article workspace');return target;}
const readIndex=async root=>JSON.parse(await readFile(join(root,'_ops/inventory/article-index.json'),'utf8'));
export async function readDraft(id,root=workspaceRoot){
  idOf(id);const index=await readIndex(root),entry=index.articles[id];if(!entry)throw Error('Article not found');
  if(!entry.canonicalPath.startsWith('articles/'))throw Error('Invalid canonical path');
  const path=await contained(join(root,'articles'),entry.canonicalPath.slice(9));
  if((await stat(path)).size>maxBody*4)throw Error('Article is too large');
  const markdown=await readFile(path,'utf8');if(markdown.length>maxBody)throw Error('Article is too large');
  // The structure travels with the draft so the editor can lock its headings and report a broken record at once.
  const structure=structureFor(entry.archiveCategory);
  return {id,...entry,markdown,sha256:sha(markdown),structure,structureIssue:recordStructureIssue(structure.kind,markdown)};
}
export async function withWorkspaceLock(root,work){return withFileLock(join(root,'.local/workspace-write-v2.lock'),work);}
// Date + article-id fragment, so independently initialized workspaces do not
// reuse 01_/02_ from an empty local index. Existing numbered folders stay valid.
export function annexFolderStamp(id,shortTitle,day){
  const key=String(id||'').replace(/^(?:draft|record)-/i,'').replace(/-/g,'').slice(0,8);
  if(!key)throw Error('Invalid article ID');
  return day+'-'+key+'_'+shortTitle;
}
export async function nextAnnexFolder(root,index,column,id,shortTitle){
  const site=siteForWorkspace(root);
  const day=new Intl.DateTimeFormat('sv-SE',{timeZone:site.timezone||'Asia/Shanghai'}).format(new Date()).replaceAll('-','');
  const prefix='articles/annex/'+column+'/';
  const taken=new Set(Object.values({...index.cloudArticles,...index.articles}).filter(x=>x.canonicalPath.startsWith(prefix)).map(x=>x.canonicalPath.slice(prefix.length).split('/')[0]));
  try{for(const name of await readdir(join(root,'articles/annex',column)))taken.add(name);}catch(error){if(error.code!=='ENOENT')throw error;}
  let folder=annexFolderStamp(id,shortTitle,day),n=1;
  while(taken.has(folder)){n+=1;folder=annexFolderStamp(id,shortTitle+'-'+n,day);}
  return folder;
}

async function atomic(path,body){const tmp=path+'.'+randomUUID()+'.tmp';try{await writeFile(tmp,body,{flag:'wx'});await rename(tmp,path);}finally{await rm(tmp,{force:true});}}
export async function saveDraft({id,markdown,expectedSha256},root=workspaceRoot){
  if(typeof markdown!=='string'||!markdown.trim()||markdown.length>maxBody)throw Error('Markdown is empty or too large');
  return withWorkspaceLock(root,async()=>{
    const before=await readDraft(id,root);if(before.sha256!==expectedSha256)throw Error('CONFLICT: the article changed in another editor; reload before saving. Your text has not been written.');
    const path=await contained(root,before.canonicalPath),backup=join(root,'.local/editorial-backups',id);await mkdir(backup,{recursive:true,mode:0o700});
    await writeFile(join(backup,before.sha256+'.md'),before.markdown,{mode:0o600});
    if(sha(await readFile(path,'utf8'))!==expectedSha256)throw Error('CONFLICT: the article changed while saving');
    // Structural headings are written back in their canonical form.
    await atomic(path,normalizeRecordMarkdown(structureFor(before.archiveCategory).kind,markdown));return readDraft(id,root);
  });
}
// `type` is the production task type that made the draft. It is recorded as-is: what a type means, and which column
// or record it becomes, is decided by the caller's destination profile, not here.
export async function createDraft({id,title,column='新闻聚合',markdown,sources,archiveCategory,record,type,writingSkills,sectionId},root=workspaceRoot){
  sectionId=validateSectionId(sectionId,siteForWorkspace(root));
  if(archiveCategory!==undefined&&archiveCategory!=='未归栏'&&!archiveCategories.includes(archiveCategory))throw Error('Unknown archive category');
  if(type!==undefined&&(typeof type!=='string'||!/^[a-z][a-z0-9-]{1,30}$/.test(type)))throw Error('Invalid task type');
  if(writingSkills!==undefined&&(!Array.isArray(writingSkills)||writingSkills.length>32||writingSkills.some(id=>typeof id!=='string'||!/^[a-z][a-z0-9-]{1,30}$/.test(id))||new Set(writingSkills).size!==writingSkills.length))throw Error('Invalid writing skills');
  idOf(id);if(typeof title!=='string'||!title.trim()||title.length>120||typeof markdown!=='string'||!markdown.trim()||markdown.length>maxBody)throw Error('Provide title and Markdown');
  return withWorkspaceLock(root,async()=>{
    const index=await readIndex(root);if(index.articles[id]||index.cloudArticles?.[id])throw Error('Article ID already exists; 云端稿件请先取回编辑');
    if(!index.annexColumns.includes(column)){if(column!=='未归栏'&&!archiveCategories.includes(column))throw Error('Unknown annex column');index.annexColumns.push(column);}
    let binding;
    if(record){
      if(!/^record-[a-f0-9-]{36}$/.test(id)||!['year','history','openSource'].includes(record.kind))throw Error('新建结构化稿件需要 record-UUID 与有效类型');
      const expectedCategory=RECORD_STRUCTURE[record.kind].category;
      if(archiveCategory!==expectedCategory)throw Error('栏目与结构化类型不一致');
      binding={documentId:id.slice(7),kind:record.kind,fields:validate(record.kind,recordFields(record.kind,record.fields,markdown),{id:record.kind+':editor:'+id.slice(7)})};
    }else if(id.startsWith('record-'))throw Error('结构化稿件必须提供日期等 record 字段');
    const shortTitle=title.replace(/[\\/:*?"<>|\x00-\x1f]/g,'').trim().slice(0,60);if(!shortTitle)throw Error('Invalid title');
    const base=join(root,'articles/annex',column);await mkdir(base,{recursive:true});
    const prefix='articles/annex/'+column+'/';
    const folder=await nextAnnexFolder(root,index,column,id,shortTitle);
    const canonicalPath=prefix+folder+'/正文.md';
    const dir=dirname(join(root,canonicalPath));await mkdir(dir);await writeFile(join(root,canonicalPath),markdown,{flag:'wx'});
    index.articles[id]={canonicalPath,batchDate:null,shortTitle,dateBasis:'annex',...(sectionId?{sectionId}:{}),...(archiveCategory?{archiveCategory}:{}),...(type?{type}:{}),...(writingSkills!==undefined?{writingSkills:[...writingSkills]}:{}),...(Array.isArray(sources)?{sources:sources.slice(0,20).map(x=>({rssArticleId:Number.isSafeInteger(x.rssArticleId)?x.rssArticleId:null,url:typeof x.url==='string'&&/^https?:\/\//.test(x.url)?x.url.slice(0,2000):'',cleanedAt:String(x.cleanedAt||'').slice(0,50)}))}:{})};
    const stateDir=join(publicationDirectory(root),id);
    try{if(binding){await mkdir(stateDir,{recursive:true,mode:0o700});await atomic(join(stateDir,'record.json'),JSON.stringify(binding));}await atomic(join(root,'_ops/inventory/article-index.json'),JSON.stringify(index,null,2)+'\n');}catch(error){await rm(dir,{recursive:true});if(binding)await rm(join(stateDir,'record.json'),{force:true});throw error;}
    const readme=join(root,'articles/README.md');
    try{const text=await readFile(readme,'utf8');await atomic(readme,text+'\n- ['+shortTitle.replace(/[\[\]]/g,'')+']('+canonicalPath.slice(9)+') · '+id+'\n');}catch(error){if(error.code!=='ENOENT')throw error;}
    return readDraft(id,root);
  });
}
export async function packedDraft(id,root=workspaceRoot,{maxAsset=PUBLICATION_IMAGE_MAX_BYTES,maxTotal=2*1024*1024}={}){
  const draft=await readDraft(id,root);let markdown=draft.markdown;const assets=[];let total=0;
  let derivatives={};try{derivatives=JSON.parse(await readFile(join(publicationDirectory(root),id,'derivatives.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  for(const src of markdownImages(markdown)){
    if(src.startsWith('assets/placeholders/'))throw Error('文章还有待替换的配图占位，请先生成或导入图片');
    if(/^https?:\/\//i.test(src))throw Error('发布配图需要保存到稿件 assets 目录，以便统一加水印和生成 WebP：'+src);
    const path=await contained(dirname(join(root,draft.canonicalPath)),decodeURIComponent(src));
    if((await stat(path)).size>24*1024*1024)throw Error('原始配图超过 24MB');
    const original=await readFile(path);
    // Exact server derivatives already contain the watermark. Modified images
    // go through the normal image pipeline again.
    const bytes=derivatives[src]?.sha256===sha(original)&&src.endsWith('.webp')?original:await publicationImage(original,join(publicationDirectory(root) ,'image-cache'),{maxBytes:maxAsset});
    if(bytes.length>maxAsset||total+bytes.length>maxTotal)throw Error('压缩后配图仍超出发布限制：单图 1MB，整篇 2MB');
    total+=bytes.length;const ext='webp';
    const publicPath='/article-media/'+sha(bytes)+'.'+ext;assets.push({path:publicPath,data:bytes.toString('base64')});markdown=markdown.split(src).join(publicPath);
  }
  return {draft,markdown,assets};
}
async function previewDraft(p,root){
  const draft=await readDraft(p.id,root);
  const markdown=Object.hasOwn(p,'markdown')?p.markdown:draft.markdown;
  if(typeof markdown!=='string'||markdown.length>maxBody)throw Error('Markdown is invalid or too large');
  if(!p.embedImages)return {id:p.id,sha256:sha(markdown),html:renderArticle(markdown),images:'Local images omitted in MCP preview; use the desktop for image preview'};
  const dir=dirname(await contained(root,draft.canonicalPath)),imageSources=new Map(),warnings=[];
  let total=0;
  for(const src of markdownImages(markdown)){
    if(src.startsWith('assets/placeholders/'))throw Error('文章还有待替换的配图占位，请先生成或导入图片');
    if(/^https?:\/\//i.test(src))continue;
    imageSources.set(src,null);
    try{
      const decoded=decodeURIComponent(src);
      if(isAbsolute(decoded)||/^[a-z][a-z\d+.-]*:/i.test(decoded)||decoded.includes('\0'))throw Error('该图片路径不可用');
      const path=await contained(dir,decoded),info=await stat(path);
      if(!info.isFile())throw Error('图片文件不存在');
      if(info.size>4*1024*1024||total+info.size>16*1024*1024)throw Error('预览图片需小于 4MB，合计不超过 16MB');
      const bytes=await readFile(path);
      if(bytes.length>4*1024*1024||total+bytes.length>16*1024*1024)throw Error('预览图片需小于 4MB，合计不超过 16MB');
      const type=bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a'?'png':bytes[0]===255&&bytes[1]===216?'jpeg':bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'?'webp':null;
      if(!type)throw Error('仅支持 PNG、JPEG 和 WebP 图片');
      total+=bytes.length;imageSources.set(src,'data:image/'+type+';base64,'+bytes.toString('base64'));
    }catch(error){
      const detail=error.message.startsWith('预览图片')||error.message.startsWith('仅支持')?error.message:'文件缺失或路径不可用';
      warnings.push('图片 '+src+'：'+detail);
    }
  }
  const result={id:p.id,sha256:sha(markdown),html:renderArticle(markdown,{imageSources}),warnings};
  if(p.includeImageSources){
    result.imageSources=Object.fromEntries(imageSources);
    for(const [src,value] of imageSources){try{result.imageSources[decodeURIComponent(src)]=value;}catch{}}
  }
  return result;
}
export async function workspaceCall(method,p={},root=workspaceRoot){
  switch(method){
    case 'workspace_stamp':{
      const index=await readIndex(root),stamps=[['index',sha(JSON.stringify(index))]];
      for(const id of Object.keys(index.articles)){
        try{const d=await readDraft(id,root);stamps.push([id,d.sha256,d.canonicalPath]);
          for(const src of markdownImages(d.markdown)){if(/^https?:\/\//i.test(src))continue;try{const s=await stat(await contained(dirname(join(root,d.canonicalPath)),decodeURIComponent(src)));stamps.push([id,src,s.size,s.mtimeMs,s.ctimeMs]);}catch{stamps.push([id,src,'missing']);}}
        }catch{stamps.push([id,'missing']);}
      }
      return {stamp:sha(JSON.stringify(stamps))};
    }
    case 'draft_list':{const index=await readIndex(root);return {articles:Object.entries(index.articles).map(([id,x])=>({id,...x})),columns:index.annexColumns};}
    case 'draft_read':return readDraft(p.id,root);
    case 'draft_private_notes':{
      await readDraft(p.id,root);
      try{return validatePrivateEditorial(JSON.parse(await readFile(join(publicationDirectory(root),p.id,'internal-notes.json'),'utf8')));}
      catch(error){if(error.code==='ENOENT')return null;throw error;}
    }
    case 'draft_save':return saveDraft(p,root);
    case 'draft_create':return createDraft(p,root);
    case 'draft_preview':return previewDraft(p,root);
    case 'publication_status':{idOf(p.id);try{const receipt=JSON.parse(await readFile(join(publicationDirectory(root),p.id,'receipt.json'),'utf8'));return {local:true,...receipt};}catch(e){if(e.code!=='ENOENT')throw e;return {local:true,status:'not_submitted'};}}
    default:throw Error('Unknown editorial operation');
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let input='';process.stdin.setEncoding('utf8');for await(const chunk of process.stdin){input+=chunk;if(input.length>700000)throw Error('Request too large');if(input.endsWith('\n'))break;}
  try{const {method,params}=JSON.parse(input);const result=method==='workspace_info'?await workspaceInfo():method==='workspace_select'?await selectWorkspace(params.path):await workspaceCall(method,params);process.stdout.write(JSON.stringify(result));}catch(error){process.stderr.write(error.message);process.exitCode=1;}
}
