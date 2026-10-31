import {publicationDirectory,siteForWorkspace} from './site-config.mjs';
import {readFile,writeFile,copyFile,rm,mkdir,rename} from 'node:fs/promises';
import {join,dirname,relative} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readDraft,contained,withWorkspaceLock,sha,nextAnnexFolder} from './editorial-workspace.mjs';
import {localFingerprint,localMetadata,atomicJson,optionalJson} from './editorial-sync.mjs';
import {markdownImages} from './article-format.mjs';
import {archiveCategories} from './archive-taxonomy.mjs';
import {requirePublishSection,sectionsForSite} from '../contracts/site-sections.mjs';

export async function setDraftCategory(root,{id,category,sectionId,expectedFingerprint}){
  const selecting=sectionId!==undefined,site=siteForWorkspace(root);
  if(selecting){if(sectionId)requirePublishSection(sectionId,site);category=sectionsForSite(site).find(s=>s.id===sectionId)?.name||'未归栏';}
  else if(!archiveCategories.includes(category))throw Error('栏目无效');
  return withWorkspaceLock(root,async()=>{
    if(!expectedFingerprint||await localFingerprint(root,id)!==expectedFingerprint)throw Error('本地稿件已变化，请刷新后设置栏目');
    const record=await optionalJson(join(publicationDirectory(root),id,'record.json'));
    const bound={year:'学术情报',history:'昔日学术',openSource:'学术开源'}[record?.kind];
    if(!selecting&&bound&&category!==bound)throw Error('此稿件保留官网原子记录结构，栏目固定为'+bound);
    const draft=await readDraft(id,root),file=join(root,'_ops/inventory/article-index.json'),index=JSON.parse(await readFile(file,'utf8'));
    const meta=await localMetadata(root,id,draft);
    // Metadata is the publication source of truth; the index also records the
    // classification for offline lists and external editor tools.
    const next={...meta,category};
    if(selecting){if(sectionId){next.sectionId=sectionId;index.articles[id].sectionId=sectionId;}else{delete next.sectionId;delete index.articles[id].sectionId;}}
    await atomicJson(join(publicationDirectory(root),id,'metadata.json'),next);
    if(!selecting||!bound)index.articles[id].archiveCategory=category;await atomicJson(file,index);
    return {id,category};
  });
}

export async function deleteLocalDraft(root,{id,expectedFingerprint,confirmed}){
  if(confirmed!==true)throw Error('请明确确认删除本地稿件');
  return withWorkspaceLock(root,async()=>{
    if(!expectedFingerprint||await localFingerprint(root,id)!==expectedFingerprint)throw Error('本地稿件已变化，请重新查看后删除');
    const draft=await readDraft(id,root),indexFile=join(root,'_ops/inventory/article-index.json'),raw=await readFile(indexFile,'utf8'),index=JSON.parse(raw);
    const source=dirname(await contained(root,draft.canonicalPath));
    const articles=await contained(root,'articles');
    if(source===articles||Object.entries(index.articles).some(([key,x])=>key!==id&&(dirname(x.canonicalPath)===dirname(draft.canonicalPath)||x.canonicalPath.startsWith(dirname(draft.canonicalPath)+'/'))))throw Error('多个稿件共用此目录，不能删除整个目录');
    for(const [key,entry] of Object.entries(index.articles)){
      if(key===id)continue;
      let other;try{other=await contained(root,entry.canonicalPath);}catch(e){if(e.code==='ENOENT')continue;throw e;}
      if(other.startsWith(source+'/'))throw Error('其他稿件经链接共用此目录，不能删除');
    }
    const trash=join(root,'.local/editorial-trash',id+'-'+randomUUID());await mkdir(trash,{recursive:true,mode:0o700});
    const manifest={id,entry:index.articles[id],source:draft.canonicalPath,deletedAt:new Date().toISOString(),fingerprint:expectedFingerprint,state:'prepared'};
    await atomicJson(join(trash,'manifest.json'),manifest);
    if(sha(await readFile(indexFile,'utf8'))!==sha(raw)||await localFingerprint(root,id)!==expectedFingerprint)throw Error('稿件或索引在删除前发生变化，未删除');
    await rename(source,join(trash,'files'));
    try{delete index.articles[id];await atomicJson(indexFile,index);}catch(e){await rename(join(trash,'files'),source);throw e;}
    await atomicJson(join(trash,'manifest.json'),{...manifest,state:'recycled'});
    return {id,deleted:true,backup:relative(root,trash)};
  });
}

// Cancelling a cloud edit removes only the local editing copy made by a pull.
// Files go to the recoverable trash and the cloud-only entry returns; the
// cloud and public versions are never touched.
export async function discardPulledCopy(root,{id,expectedFingerprint,discardChanges,confirmed}){
  if(confirmed!==true)throw Error('请明确确认取消编辑');
  return withWorkspaceLock(root,async()=>{
    const state=join(publicationDirectory(root),id),origin=await optionalJson(join(state,'pull-origin.json'));
    if(!origin)throw Error('这不是从云端取回的编辑副本，不能取消编辑');
    const fingerprint=await localFingerprint(root,id);
    if(!expectedFingerprint||fingerprint!==expectedFingerprint)throw Error('编辑副本已变化，请重新查看后取消');
    const sync=await optionalJson(join(state,'sync.json'));
    if(fingerprint!==sync?.fingerprint&&discardChanges!==true)throw Error('编辑副本有未推送的修改，请确认放弃修改');
    const draft=await readDraft(id,root),indexFile=join(root,'_ops/inventory/article-index.json'),raw=await readFile(indexFile,'utf8'),index=JSON.parse(raw);
    const source=dirname(await contained(root,draft.canonicalPath));
    if(source===await contained(root,'articles')||Object.entries(index.articles).some(([key,x])=>key!==id&&(dirname(x.canonicalPath)===dirname(draft.canonicalPath)||x.canonicalPath.startsWith(dirname(draft.canonicalPath)+'/'))))throw Error('多个稿件共用此目录，不能取消编辑');
    const trash=join(root,'.local/editorial-trash',id+'-'+randomUUID());await mkdir(trash,{recursive:true,mode:0o700});
    const manifest={id,entry:index.articles[id],restored:origin.entry,source:draft.canonicalPath,reason:'cancel-cloud-edit',deletedAt:new Date().toISOString(),fingerprint,state:'prepared'};
    await atomicJson(join(trash,'manifest.json'),manifest);
    if(sha(await readFile(indexFile,'utf8'))!==sha(raw)||await localFingerprint(root,id)!==fingerprint)throw Error('编辑副本在取消前发生变化，未删除');
    await rename(source,join(trash,'files'));
    // An unsent push preview belongs to this copy; keep it with the copy.
    const staged=[];
    for(const name of ['prepared.json','preview.html'])try{await rename(join(state,name),join(trash,name));staged.push(name);}catch(e){if(e.code!=='ENOENT'){for(const n of staged)await rename(join(trash,n),join(state,n));await rename(join(trash,'files'),source);throw e;}}
    try{
      delete index.articles[id];
      if(origin.entry){index.cloudArticles??={};index.cloudArticles[id]=origin.entry;}
      await atomicJson(indexFile,index);
    }catch(e){for(const n of staged)await rename(join(trash,n),join(state,n));await rename(join(trash,'files'),source);throw e;}
    await rm(join(state,'pull-origin.json'),{force:true});
    await atomicJson(join(trash,'manifest.json'),{...manifest,state:'recycled'});
    return {id,discarded:true,changed:fingerprint!==sync?.fingerprint,backup:relative(root,trash)};
  });
}

// A deleted remote ID cannot be reused. Keep the old manuscript and receipts,
// and make an independent, versioned local copy only on explicit recovery.
export async function recoverDeletedDraft(root,{id,expectedFingerprint,confirmed}){
  if(confirmed!==true)throw Error('请确认保留原稿并恢复为新稿');
  return withWorkspaceLock(root,async()=>{
    if(!expectedFingerprint||await localFingerprint(root,id)!==expectedFingerprint)throw Error('本地稿件已变化，请刷新后恢复');
    const draft=await readDraft(id,root),state=publicationDirectory(root),record=await optionalJson(join(state,id,'record.json'));
    if(record)throw Error('结构化记录需在后台恢复原记录，不能复制编号');
    const file=join(root,'_ops/inventory/article-index.json'),index=JSON.parse(await readFile(file,'utf8'));
    const recovery=await optionalJson(join(state,id,'recovered-copy.json'));
    if(recovery?.fingerprint===expectedFingerprint&&index.articles[recovery.id])return {id:recovery.id};
    const originalColumn=draft.canonicalPath.startsWith('articles/annex/')?draft.canonicalPath.split('/')[2]:null;
    const column=index.annexColumns.includes(originalColumn)?originalColumn:archiveCategories.includes(draft.archiveCategory)?draft.archiveCategory:'新闻聚合';
    if(!index.annexColumns.includes(column))index.annexColumns.push(column);
    const shortTitle=String(draft.shortTitle||'恢复稿件').replace(/[\\/:*?"<>|\x00-\x1f]/g,'').trim().slice(0,60);
    if(!shortTitle)throw Error('稿件标题无效，请先整理标题');
    const next='draft-'+randomUUID(),folder=await nextAnnexFolder(root,index,column,next,shortTitle);
    const directory='articles/annex/'+column+'/'+folder,canonicalPath=directory+'/正文.md',target=join(root,directory);
    await mkdir(dirname(target),{recursive:true});await mkdir(target);
    let indexed=false;
    try{
      await writeFile(join(target,'正文.md'),draft.markdown,{flag:'wx'});
      for(const src of markdownImages(draft.markdown)){
        if(/^https?:\/\//i.test(src))continue;
        const decoded=decodeURIComponent(src);
        if(decoded.split('/').includes('..')||decoded.startsWith('/')||decoded.includes('\\'))throw Error('配图路径需先整理到稿件目录');
        const source=await contained(dirname(join(root,draft.canonicalPath)),decoded),destination=join(target,decoded);
        await mkdir(dirname(destination),{recursive:true});await copyFile(source,destination);
      }
      for(const name of ['metadata.json','derivatives.json']){const value=await optionalJson(join(state,id,name));if(value)await atomicJson(join(state,next,name),value);}
      if(await localFingerprint(root,id)!==expectedFingerprint)throw Error('稿件在恢复时发生变化，请重试');
      index.articles[next]={...index.articles[id],canonicalPath,batchDate:null,dateBasis:'annex',shortTitle};await atomicJson(file,index);indexed=true;
      await atomicJson(join(state,id,'recovered-copy.json'),{id:next,fingerprint:expectedFingerprint});
      return {id:next};
    }catch(error){if(!indexed){await rm(target,{recursive:true,force:true});await rm(join(state,next),{recursive:true,force:true});}throw error;}
  });
}
