import {validatePrivateEditorial} from '../contracts/article-internal-notes.mjs';
import {synchronizationState} from '../contracts/sync-state.mjs';
import {replaceFile} from './replace-file.mjs';
import {publicationDirectory,siteForWorkspace} from './site-config.mjs';
import {readFile,writeFile,mkdir,rename,rm,stat} from 'node:fs/promises';
import {join,dirname,basename,resolve,relative,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readDraft,contained,sha,withWorkspaceLock} from './editorial-workspace.mjs';
import {markdownImages} from './article-format.mjs';
import {draftCategory} from './archive-taxonomy.mjs';

export const optionalJson=async path=>{try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
export async function atomicJson(path,value){await mkdir(dirname(path),{recursive:true,mode:0o700});const tmp=path+'.'+randomUUID()+'.tmp';try{await writeFile(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});await replaceFile(tmp,path);}finally{await rm(tmp,{force:true});}}
export const publicationMetadata=data=>({date:data.date||'',summary:data.summary||'',author:data.author||'Scholay 编辑部',category:data.category||'学界犀闻',...(data.sectionId?{sectionId:data.sectionId}:{})});
export async function localMetadata(root,id,draft){
  const local=await optionalJson(join(publicationDirectory(root),id,'metadata.json'));
  const registry=await optionalJson(join(root,'_ops/inventory/today-articles.json'));
  const site=siteForWorkspace(root);
  return publicationMetadata({date:draft.batchDate||'',category:draftCategory(draft),author:site.author,...(local||registry?.[id]||{}),...(draft.sectionId?{sectionId:draft.sectionId}:{})});
}
export async function localFingerprint(root,id,meta,{pullTransaction=false}={}){
  if(!pullTransaction&&await optionalJson(join(publicationDirectory(root),id,'pull-transaction.json')))throw Error('上次取回尚未完成，请先恢复取回事务；本地备份已保留');
  const draft=await readDraft(id,root),images=[];
  for(const src of [...new Set(markdownImages(draft.markdown))].sort()){
    if(/^https?:\/\//i.test(src)){images.push([src,'remote']);continue;}
    const path=await contained(dirname(join(root,draft.canonicalPath)),decodeURIComponent(src));
    if((await stat(path)).size>24*1024*1024)throw Error('配图超过 24MB');
    images.push([src,sha(await readFile(path))]);
  }
  // Paths in the article index are deliberately excluded: moving a folder
  // doesn't make an article a new publication.
  const record=await optionalJson(join(publicationDirectory(root),id,'record.json'));
  const privateNotes=await optionalJson(join(publicationDirectory(root),id,'internal-notes.json'));
  return sha(JSON.stringify({...(privateNotes?{privateNotes}:{}),markdown:draft.markdown,metadata:meta||await localMetadata(root,id,draft),images,record}));
}
export {synchronizationState};
export async function syncItem(root,id,remote,known,pending=false){
  const base=await optionalJson(join(publicationDirectory(root),id,'sync.json'));
  try{const fingerprint=await localFingerprint(root,id);return {state:synchronizationState({base,local:fingerprint,remote,known,pending}),fingerprint,baseRevision:base?.revision??null,remoteRevision:remote?.version??remote?.publishedVersion??null,publishedRevision:remote?.publishedVersion??null};}
  catch(e){return {state:'invalid',error:e.message,baseRevision:base?.revision??null,remoteRevision:remote?.version??remote?.publishedVersion??null};}
}
async function prepareArticleParent(root,canonicalPath){
  if(typeof canonicalPath!=='string'||!canonicalPath.startsWith('articles/')||canonicalPath.includes('\\')||canonicalPath.split('/').some(p=>!p||p==='.'||p==='..')||!canonicalPath.endsWith('/正文.md'))throw Error('云端登记的稿件路径无效');
  const parts=canonicalPath.split('/').slice(1,-2);let parent=join(root,'articles');
  await mkdir(parent,{recursive:true});
  await contained(root,'articles');
  for(const part of parts){parent=join(parent,part);await mkdir(parent,{recursive:false}).catch(e=>{if(e.code!=='EEXIST')throw e;});await contained(join(root,'articles'),relative(join(root,'articles'),parent));}
  return join(root,canonicalPath);
}
// Fetch first, validate and stage the complete bundle, then replace. Recheck
// local bytes immediately before committing; dirty content always survives.
export async function importPublished(root,bundle,{expectedFingerprint,localId}={}){
  const {data,revision}=bundle,id=localId||data.id;
  if(!Number.isSafeInteger(revision)||revision<1||![id,data.id].every(value=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{2,99}$/.test(value))||data.record&&id!==data.id)throw Error('官网稿件包无效');
  return withWorkspaceLock(root,async()=>{
    const stateDir=join(publicationDirectory(root),id),base=await optionalJson(join(stateDir,'sync.json'));
    if(await optionalJson(join(stateDir,'pull-transaction.json')))throw Error('上次取回尚未完成，请先恢复取回事务；本地备份已保留');
    let existing=null;try{existing=await readDraft(id,root);}catch(e){if(e.message!=='Article not found')throw e;}
    const before=existing?await localFingerprint(root,id):null;
    if(existing&&expectedFingerprint&&before!==expectedFingerprint)throw Error('本地稿件在取回期间发生变化，请重新比较');
    if(existing&&(!base||before!==base.fingerprint)){
      // Incoming images get immutable, content-addressed local paths so a
      // manual Markdown merge works offline without overwriting local assets.
      let localMarkdown=data.markdown;const derivatives=await optionalJson(join(stateDir,'derivatives.json'))||{};
      const draftDir=dirname(await contained(root,existing.canonicalPath));
      for(const asset of data.assets||[]){
        const bytes=Buffer.from(asset.data,'base64');
        if(!/^\/article-media\/[a-f0-9]{64}\.(webp|png|jpg)$/.test(asset.path)||sha(bytes)!==asset.path.split('/').pop().split('.')[0])throw Error('官网配图校验失败');
        const relative='assets/cloud/'+asset.path.split('/').pop();
        await mkdir(join(draftDir,'assets/cloud'),{recursive:true});
        const assetsDir=await contained(draftDir,'assets/cloud');
        const target=join(assetsDir,basename(relative));
        try{await writeFile(target,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST'||sha(await readFile(await contained(draftDir,relative)))!==sha(bytes))throw Error('本地配图路径冲突');}
        localMarkdown=localMarkdown.split(asset.path).join(relative);derivatives[relative]={sha256:sha(bytes),publicPath:asset.path};
      }
      await atomicJson(join(stateDir,'derivatives.json'),derivatives);
      await atomicJson(join(stateDir,'incoming.json'),{...bundle,localMarkdown});
      return {id,conflict:true,message:'官网版本已保存为对照稿。本地有修改，未覆盖；请在本地比较后合并。',revision};
    }
    const indexFile=join(root,'_ops/inventory/article-index.json'),index=await optionalJson(indexFile);
    const released=index.cloudArticles?.[id];
    const title=data.title.replace(/[\\/:*?"<>|\x00-\x1f]/g,'').trim().slice(0,18)||'官网稿件';
    const canonicalPath=existing?.canonicalPath||released?.canonicalPath||`articles/${data.date.slice(0,7)}/${data.date}_${id}_${title}/正文.md`;
    const directory=existing?dirname(await contained(root,canonicalPath)):dirname(join(root,canonicalPath));
    const candidate=resolve(root,dirname(canonicalPath));
    if(Object.entries({...index.cloudArticles,...index.articles}).some(([key,value])=>{if(key===id)return false;const other=resolve(root,dirname(value.canonicalPath));return other===candidate||other.startsWith(candidate+sep)||candidate.startsWith(other+sep);} ))throw Error('多个稿件共用同一文件夹，请先整理为每篇独立目录后取回');
    if(!existing){await prepareArticleParent(root,canonicalPath);try{await stat(directory);throw Error('取回目录已存在未登记文件，未覆盖');}catch(e){if(e.code!=='ENOENT')throw e;}}
    const temp=join(dirname(directory),'.incoming-'+randomUUID());await mkdir(temp,{mode:0o700});
    let markdown=data.markdown;
    const derivatives={};
    try{
      for(const asset of data.assets||[]){
        const bytes=Buffer.from(asset.data,'base64');
        if(!/^\/article-media\/[a-f0-9]{64}\.(webp|png|jpg)$/.test(asset.path)||sha(bytes)!==asset.path.split('/').pop().split('.')[0])throw Error('官网配图校验失败');
        const path='assets/published/'+asset.path.split('/').pop();await mkdir(join(temp,'assets/published'),{recursive:true});
        await writeFile(join(temp,path),bytes,{flag:'wx'});markdown=markdown.split(asset.path).join(path);derivatives[path]={sha256:sha(bytes),publicPath:asset.path};
      }
      await writeFile(join(temp,basename(canonicalPath)),markdown,{flag:'wx'});
      const backup=existing?join(stateDir,'backups',randomUUID()):null;
      const previous={};
      for(const name of ['metadata','record','derivatives','sync','internal-notes'])previous[name]=await optionalJson(join(stateDir,name+'.json'));
      if(existing){
        if(await localFingerprint(root,id)!==before)throw Error('本地稿件在下载时发生变化，取回已停止');
      }
      // A durable recovery record also blocks upload after a crash between the
      // folder swap and index/baseline writes. Never treat a partial pull as new.
      await atomicJson(join(stateDir,'pull-transaction.json'),{id,revision,canonicalPath,backup,previous,index,at:new Date().toISOString()});
      if(existing){
        await mkdir(dirname(backup),{recursive:true});
        // The complete prior folder (including unused originals) remains recoverable.
        await rename(directory,backup);
        try{await rename(temp,directory);}catch(e){await rename(backup,directory);throw e;}
      }else{
        await rename(temp,directory);
      }
      const entry={...released,...index.articles[id],canonicalPath,shortTitle:data.title,...(!existing&&!released?{batchDate:data.date,dateBasis:'website'}:{})};delete entry.cloud;
      if(data.sectionId)entry.sectionId=data.sectionId;else delete entry.sectionId;
      index.articles[id]=entry;
      await atomicJson(indexFile,index);
      const meta=publicationMetadata(data);await atomicJson(join(stateDir,'metadata.json'),meta);
      if(data.record)await atomicJson(join(stateDir,'record.json'),data.record);
      await atomicJson(join(stateDir,'derivatives.json'),derivatives);
      if(bundle.privateEditorial)await atomicJson(join(stateDir,'internal-notes.json'),validatePrivateEditorial(bundle.privateEditorial));
      // Keep the recovery marker until every file has committed, but allow this
      // transaction alone to compute its final fingerprint.
      const fingerprint=await localFingerprint(root,id,undefined,{pullTransaction:true});
      await atomicJson(join(stateDir,'sync.json'),{remoteId:data.id,revision,cloudRevision:revision,publishedRevision:bundle.publishedVersion??(bundle.scope==='cloud'?null:revision),fingerprint,at:new Date().toISOString(),origin:bundle.scope==='cloud'?'cloud-pull':'pull',publishedDataHash:sha(JSON.stringify(data))});
      await rm(join(stateDir,'incoming.json'),{force:true});
      // A fresh editing copy records what it replaced, so cancelling the edit
      // can restore the cloud-only entry without contacting the server.
      if(!existing)await atomicJson(join(stateDir,'pull-origin.json'),{entry:released||null,remoteId:data.id,revision,at:new Date().toISOString()});
      // The cloud-only pointer survives interrupted pulls until every local
      // asset, metadata field and acknowledged fingerprint has committed.
      if(released){delete index.cloudArticles[id];await atomicJson(indexFile,index);}
      await rm(join(stateDir,'pull-transaction.json'),{force:true});
      return {id,conflict:false,revision,editCopy:!existing||!!await optionalJson(join(stateDir,'pull-origin.json'))};
    }finally{await rm(temp,{recursive:true,force:true});}
  });
}
