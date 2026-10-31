import {publicationDirectory,siteForWorkspace} from './site-config.mjs';
import {validatePrivateEditorial} from '../contracts/article-internal-notes.mjs';
import {readFile,readdir,lstat,rename,rm,mkdir,realpath} from 'node:fs/promises';
import {join,dirname,relative,resolve,sep} from 'node:path';
import {readDraft,sha,withWorkspaceLock} from './editorial-workspace.mjs';
import {atomicJson,localFingerprint,optionalJson} from './editorial-sync.mjs';
import {isDeepStrictEqual} from 'node:util';
import {RECORD_STRUCTURE,recordFields} from './editorial-record.mjs';

// Structured cloud records reconstruct their display envelope (date, author,
// category and summary). Compare the authoritative fields and media instead,
// while requiring both Markdown copies to agree with those same fields.
export function samePublishedContent(expected,actual){
  if(!expected?.record&&!actual?.record)return isDeepStrictEqual(expected,actual);
  const project=data=>{
    const record=data?.record;
    if(!record||!Object.hasOwn(RECORD_STRUCTURE,record.kind)||!record.documentId||data.id!=='record-'+record.documentId||data.title!==record.fields?.title)return null;
    if(!isDeepStrictEqual(recordFields(record.kind,record.fields,data.markdown),record.fields))return null;
    return {id:data.id,sectionId:data.sectionId,record,assets:data.assets};
  };
  try{const a=project(expected),b=project(actual);return !!a&&!!b&&isDeepStrictEqual(a,b);}catch{return false;}
}

async function tree(root,path){
  const result=[];
  async function walk(file){const info=await lstat(file);if(info.isSymbolicLink())throw Error('原稿包含符号链接，请先处理');
    if(info.isDirectory()){for(const name of (await readdir(file)).sort())await walk(join(file,name));}
    else if(info.isFile()){const data=await readFile(file);result.push({path:relative(root,file),sha256:sha(data),data:data.toString('base64')});}
    else throw Error('原稿包含不支持的文件');
  }
  await walk(path);return result;
}
// Keep private notes backed up even when this site retains its local manuscript.
export async function archivePrivateEditorial({root,id,packet,receipt,api}){
  const state=join(publicationDirectory(root),id),path=join(state,'internal-notes.json');
  const bytes=await readFile(path).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(!bytes)return null;
  validatePrivateEditorial(JSON.parse(bytes.toString('utf8')));
  if(receipt.requestKey!==packet?.requestKey||!(receipt.status==='draft_saved'||receipt.publicReadback&&receipt.job?.status==='success'))throw Error('提交尚未核验，内部备注仍保留在本地');
  if(await localFingerprint(root,id)!==packet.localFingerprint)throw Error('内部备注或正文已有修改，保留本地新版');
  const file={path:relative(root,path).split(sep).join('/'),sha256:sha(bytes),data:bytes.toString('base64')};
  const bundle={articleId:packet.data.id,revision:receipt.revision,files:[file]},hash=sha(JSON.stringify(bundle));
  const cached=await optionalJson(join(state,'private-archive.json'));if(cached?.archiveId===hash)return cached;
  const remote=await api('/cloud/'+packet.data.id);
  if(remote.version!==receipt.revision||!samePublishedContent(packet.data,remote.data))throw Error('云端版本已变化，内部备注保留在本地');
  const proof=await api('/source-archives',bundle),readback=await api('/source-archives/'+proof.archiveId);
  if(proof.archiveId!==hash||readback.archiveSha256!==hash||sha(JSON.stringify(readback.bundle))!==hash)throw Error('内部备注归档未通过回读校验');
  return withWorkspaceLock(root,async()=>{
    if(await localFingerprint(root,id)!==packet.localFingerprint)throw Error('归档期间内部备注已有修改，保留本地新版');
    const pointer={articleId:packet.data.id,version:receipt.revision,archiveId:hash,archiveSha256:hash,privateNotesPath:file.path};
    await atomicJson(join(state,'private-archive.json'),pointer);return pointer;
  });
}
export async function releaseCloudCopy({root,id,packet,receipt,api}){
  if(receipt.requestKey!==packet?.requestKey||!(receipt.status==='draft_saved'||receipt.publicReadback&&receipt.job?.status==='success'))throw Error('提交尚未核验，保留本地稿件');
  const draft=await readDraft(id,root),fingerprint=await localFingerprint(root,id);
  if(draft.sha256!==packet.sourceSha256||fingerprint!==packet.localFingerprint)throw Error('本地已有新的修改，保留工作副本');
  const remote=await api('/cloud/'+packet.data.id);
  if(remote.version!==receipt.revision||!samePublishedContent(packet.data,remote.data))throw Error('云端内容与本次提交不一致，保留本地稿件');
  const indexPath=join(root,'_ops/inventory/article-index.json');
  const directory=dirname(resolve(root,draft.canonicalPath));
  if(!directory.startsWith(resolve(root,'articles')+sep))throw Error('稿件目录不能自动清理');
  if(await realpath(directory)!==resolve(await realpath(root),relative(root,directory)))throw Error('稿件目录包含链接，保留本地稿件');
  const state=join(publicationDirectory(root),id);
  const targets=[directory];
  // These are article-owned body copies. Receipts, metadata and cloud pointers stay local.
  for(const path of [join(root,'.local/editorial-backups',id),join(state,'backups'),join(state,'prepared.json'),join(state,'preview.html'),join(state,'incoming.json'),join(state,'record.json'),join(state,'release-proof.json')])if(await lstat(path).catch(()=>null))targets.push(path);
  const retained=[];const privateNotes=join(state,'internal-notes.json');if(await lstat(privateNotes).catch(()=>null))retained.push(privateNotes);
  const files=(await Promise.all([...targets,...retained].map(p=>tree(root,p)))).flat().sort((a,b)=>a.path.localeCompare(b.path));
  if(files.reduce((sum,f)=>sum+Buffer.byteLength(f.data,'base64'),0)>48*1024*1024)throw Error('原稿归档超过 48 MB，本地副本已保留');
  // Archive paths cross operating systems; local staging journals keep native paths.
  const bundle={articleId:packet.data.id,revision:receipt.revision,files:files.map(file=>({...file,path:file.path.split(sep).join('/')}))},hash=sha(JSON.stringify(bundle));
  const proof=await api('/source-archives',bundle);
  const readback=await api('/source-archives/'+proof.archiveId);
  if(proof.archiveId!==hash||readback.archiveSha256!==hash||sha(JSON.stringify(readback.bundle))!==hash)throw Error('云端原稿归档未通过回读校验，保留本地稿件');
  return withWorkspaceLock(root,async()=>{
    const index=JSON.parse(await readFile(indexPath,'utf8'));
    if(index.articles[id]?.canonicalPath!==draft.canonicalPath||await localFingerprint(root,id)!==fingerprint)throw Error('稿件在归档时发生变化，保留本地副本');
    for(const [other,entry] of Object.entries(index.articles))if(other!==id&&(resolve(root,entry.canonicalPath)===directory||resolve(root,entry.canonicalPath).startsWith(directory+sep)))throw Error('目录由其他稿件共用，保留本地副本');
    const current=(await Promise.all([...targets,...retained].map(p=>tree(root,p)))).flat().sort((a,b)=>a.path.localeCompare(b.path));
    if(sha(JSON.stringify(current))!==sha(JSON.stringify(files)))throw Error('原稿或附件在归档时变化，保留本地副本');
    const journal=join(state,'release.json'),staging=join(state,'release-staging');
    if(await lstat(staging).catch(()=>null))throw Error('有未完成的本地清理，请先恢复');
    await mkdir(staging,{recursive:true,mode:0o700});const moved=[];
    const cloud={articleId:packet.data.id,version:remote.version,publishedVersion:remote.publishedVersion,sourceSha256:draft.sha256,archiveId:hash,archiveSha256:hash,...(retained.length?{privateNotesPath:relative(root,privateNotes).split(sep).join('/')} :{}),releasedAt:new Date().toISOString()};
    await atomicJson(journal,{phase:'prepared',cloud,targets:targets.map(x=>relative(root,x)),files:files.map(({path,sha256})=>({path,sha256}))});
    try{
      for(let i=0;i<targets.length;i++){await rename(targets[i],join(staging,String(i)));moved.push(i);}
      // Recheck after the atomic renames; an external editor cannot slip changed bytes into the purge.
      const staged=[];for(let i=0;i<targets.length;i++){for(const f of await tree(root,join(staging,String(i))))staged.push({...f,path:relative(root,targets[i])+f.path.slice(relative(root,join(staging,String(i))).length)});}
      for(const path of retained)staged.push(...await tree(root,path));
      staged.sort((a,b)=>a.path.localeCompare(b.path));if(sha(JSON.stringify(staged))!==sha(JSON.stringify(files)))throw Error('移动期间文件发生变化');
      for(const target of targets)if(await lstat(target).catch(()=>null))throw Error('有编辑器写入了新文件，保留新文件与归档暂存副本');
      index.cloudArticles??={};index.cloudArticles[id]={...index.articles[id],cloud};delete index.articles[id];await atomicJson(indexPath,index);
    }catch(e){
      for(const i of moved.reverse()){if(await lstat(targets[i]).catch(()=>null))throw Error('清理已停止：新文件和原稿暂存副本均已保留，请核对后恢复');await rename(join(staging,String(i)),targets[i]);}
      await rm(staging,{recursive:true,force:true});await atomicJson(journal,{phase:'rolled_back',cloud});throw e;
    }
    await atomicJson(journal,{phase:'indexed',cloud,targets:targets.map(x=>relative(root,x)),files:files.map(({path,sha256})=>({path,sha256}))});
    await rm(staging,{recursive:true,force:true});await atomicJson(journal,{phase:'complete',cloud});
    // A pushed editing copy is finished; the fresh pointer above replaces its origin.
    await rm(join(state,'pull-origin.json'),{force:true});
    return cloud;
  });
}

export async function recoverCloudRelease(root,id){
  const state=join(publicationDirectory(root),id),journal=await optionalJson(join(state,'release.json'));
  if(!journal||!['prepared','indexed'].includes(journal.phase))return;
  await withWorkspaceLock(root,async()=>{
    const index=JSON.parse(await readFile(join(root,'_ops/inventory/article-index.json'),'utf8'));
    const staging=join(state,'release-staging');
    if(index.cloudArticles?.[id]?.cloud.archiveId===journal.cloud.archiveId&&!index.articles[id]){
      const children=await readdir(staging).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
      if(children.some(x=>!journal.targets.some((_,i)=>String(i)===x)))throw Error('归档暂存目录出现新文件，已保留');
      const files=[];
      for(let i=0;i<journal.targets.length;i++){const path=join(staging,String(i));if(!await lstat(path).catch(()=>null))continue;for(const f of await tree(root,path))files.push({path:journal.targets[i]+f.path.slice(relative(root,path).length),sha256:f.sha256});}
      if(files.some(f=>!journal.files?.some(x=>x.path===f.path&&x.sha256===f.sha256)))throw Error('归档暂存文件发生变化，请手动恢复');
      await rm(staging,{recursive:true,force:true});await atomicJson(join(state,'release.json'),{phase:'complete',cloud:journal.cloud});
    }else{
      for(let i=0;i<journal.targets.length;i++){const source=join(staging,String(i)),target=resolve(root,journal.targets[i]);if(!target.startsWith(resolve(root)+sep))throw Error('清理恢复路径无效');if(!await lstat(source).catch(()=>null))continue;if(await lstat(target).catch(()=>null))throw Error('原稿恢复遇到新文件，保留两份供比较');await rename(source,target);}
      await rm(staging,{recursive:true,force:true});await atomicJson(join(state,'release.json'),{phase:'rolled_back',cloud:journal.cloud});
    }
  });
}
