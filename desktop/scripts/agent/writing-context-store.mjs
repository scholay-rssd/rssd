import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {atomicJson,optionalJson} from '../../../scripts/editorial-sync.mjs';
import {publicationDirectory,siteForWorkspace} from '../../../scripts/site-config.mjs';
import {emptyWritingContext,migrateSourcesToContext,validateWritingContext,publicContextView,contextSummary} from './writing-context.mjs';
import {listConnectors,browseConnector,resolveRssMount,searchRssMount,readRssArticle,resolveWebMount,readPublicPage,webSearchCandidate,knownUrlCandidate,importLocalFile,loadImportedFile,resolveFileMount,searchFileChapters,readFileFragment,resolveGithubMount,readGithubFile,fileEvidence,loadSignals,resolveSignalsMount,resolveExistingMount,readExistingWork} from './resources/index.mjs';
import {cachePath,validateGithubPath} from './resources/github.mjs';
import {parseMountSpec} from './resources/mount-spec.mjs';

const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export function liveContextPath(store,taskId){return join(store.dir(taskId),'writing-context.json');}
export function exportContextPath(root,articleId){return join(publicationDirectory(root),articleId,'writing-context.json');}
export function spaceIdOf(task,store){return task.spaceId||(store?siteForWorkspace(store.root).spaceId:'academic');}

export function assertContextScope(task,params={},context,store){
 const spaceId=spaceIdOf(task,store);
 if(params.articleId&&params.articleId!==task.articleId)throw Error('文章编号与当前任务不一致');
 if(params.spaceId&&params.spaceId!==spaceId)throw Error('资料不属于当前空间');
 if(context){
  if(context.articleId!==task.articleId)throw Error('上下文不属于当前文章');
  if(context.spaceId!==spaceId)throw Error('跨空间不可读取本篇资料');
  if(params.spaceId&&context.spaceId!==params.spaceId)throw Error('上下文空间不匹配');
  if(params.expectedRevision!=null&&Number(params.expectedRevision)!==context.revision)throw Error('CONFLICT: 本篇上下文已有新版');
  if(params.mountId&&!context.mounts.some(m=>m.id===params.mountId))throw Error('挂载不存在或不属于本篇');
  if(params.versionId){
   const mount=context.mounts.find(m=>m.id===params.mountId);
   if(mount&&mount.versionId!==params.versionId)throw Error('挂载版本已变化，请使用当前版本');
  }
 }
}

export async function loadWritingContext(store,task,{migrate=true}={}){
 const live=await optionalJson(liveContextPath(store,task.id));
 if(live){
  const context=validateWritingContext(live);
  if(context.spaceId!==spaceIdOf(task,store))throw Error('跨空间不可读取本篇资料');
  if(context.articleId!==task.articleId)context.articleId=task.articleId;
  if(migrate&&!context.mounts.length&&task.notebook?.sources?.length)return migrateSourcesToContext(task.notebook.sources,task.articleId,spaceIdOf(task,store),context);
  return context;
 }
 if(migrate&&task.notebook?.sources?.length)return migrateSourcesToContext(task.notebook.sources,task.articleId,spaceIdOf(task,store));
 return emptyWritingContext(task.articleId,spaceIdOf(task,store));
}

export async function saveWritingContext(store,task,context){
 const next=validateWritingContext({...context,articleId:task.articleId,spaceId:spaceIdOf(task,store),revision:(context.revision||0)+1,updatedAt:new Date().toISOString()});
 await atomicJson(liveContextPath(store,task.id),next);
 return next;
}

function addResolved(context,resolved,{role,enabled=true,note}={}){
 const resourceId=randomUUID(),versionId=randomUUID(),mountId=randomUUID();
 context.resources[resourceId]={id:resourceId,kind:resolved.kind,title:resolved.title,locator:resolved.locator||{},createdAt:context.updatedAt};
 context.versions[versionId]={id:versionId,resourceId,immutable:true,createdAt:context.updatedAt,contentHash:String(resolved.version.contentHash),label:resolved.version.label||'',snapshot:resolved.version.snapshot||{},...(resolved.version.gaps?.length?{gaps:resolved.version.gaps}:{})};
 const mount={id:mountId,resourceId,versionId,enabled,role:role||resolved.role||'evidence',state:resolved.state||'ready',scope:resolved.scope||{}};
 if(resolved.error)mount.error=resolved.error;
 if(note)mount.note=note;
 context.mounts.push(mount);
 return {resourceId,versionId,mountId,mount};
}

function mountView(context,mount){
 const resource=context.resources[mount.resourceId],version=context.versions[mount.versionId];
 return {mount,resource,version};
}

function requireMount(context,mountId,versionId){
 const mount=context.mounts.find(m=>m.id===mountId);
 if(!mount)throw Error('挂载不存在或不属于本篇');
 if(versionId&&mount.versionId!==versionId)throw Error('挂载版本已变化，请使用当前版本');
 if(!mount.enabled)throw Error('该资料已停用，下一轮不再查阅');
 return mountView(context,mount);
}

export async function resolveMountInput(store,task,input,{signals,fetcher=fetch}={}){
 const kind=input.kind,spaceId=spaceIdOf(task,store);
 if(kind==='rss')return resolveRssMount(spaceId,store.root,input);
 if(kind==='web'){
  if(input.query&&!input.url)return {candidate:webSearchCandidate(input.query,input)};
  return resolveWebMount(input,fetcher);
 }
 if(kind==='file'){
  const imported=input.contentHash&&!input.path&&!input.data
   ?{contentHash:input.contentHash,filename:input.name||'document',parsed:await loadImportedFile(store,task.id,input.contentHash,input.name),state:'ready'}
   :await importLocalFile(store,task.id,input);
  return {...resolveFileMount(imported,input),imported};
 }
 if(kind==='github')return resolveGithubMount(input,fetcher);
 if(kind==='signals')return resolveSignalsMount(signals||await loadSignals({snapshot:input.snapshot,fetcher}),input);
 if(kind==='existing')return resolveExistingMount(store.root,input);
 throw Error('未知资料来源');
}

function pushCandidate(context,item){
 const candidate={id:randomUUID(),kind:item.kind,title:item.title,summary:item.summary||'',locator:item.locator||{},acquiredVia:item.acquiredVia||item.kind,createdAt:new Date().toISOString()};
 context.candidates.push(candidate);
 return candidate;
}

export async function listContextConnectors(store,task,{signals}={}){
 assertContextScope(task,{},undefined,store);
 return listConnectors(spaceIdOf(task,store),store.root,{signals});
}

export async function browseContextConnector(store,task,kind,query=''){
 assertContextScope(task,{},undefined,store);
 return browseConnector(kind,spaceIdOf(task,store),store.root,query);
}

export async function getWritingContext(store,task){
 const context=await loadWritingContext(store,task);
 assertContextScope(task,{},context,store);
 return {context:publicContextView(context),summary:contextSummary(context)};
}

export async function setContextNetwork(store,task,allowNetwork,params={}){
 const current=await loadWritingContext(store,task);
 assertContextScope(task,params,current,store);
 if(task.runtime?.busy||task.runtime?.queued)throw Error('请先停止当前任务再变更检索范围');
 current.allowNetwork=allowNetwork===true;
 const saved=await saveWritingContext(store,task,current);
 return {context:publicContextView(saved),summary:contextSummary(saved)};
}

export async function addContextCandidate(store,task,input,params={}){
 const current=await loadWritingContext(store,task);
 assertContextScope(task,params,current,store);
 const item=input.url&&!input.query?knownUrlCandidate(input.url,input.title):input.kind==='web'||input.query?webSearchCandidate(input.query||input.title,input):input;
 const candidate=pushCandidate(current,item);
 const saved=await saveWritingContext(store,task,current);
 return {context:publicContextView(saved),candidate};
}

export async function mountResource(store,task,input,options={}){
 const current=await loadWritingContext(store,task);
 assertContextScope(task,input,current,store);
 if(task.runtime?.busy||task.runtime?.queued)throw Error('请先停止当前任务再变更资料范围');
 if(input.kind==='web'&&input.query&&!input.url&&!current.allowNetwork&&options.requireNetwork!==false){
  const candidate=pushCandidate(current,webSearchCandidate(input.query,input));
  const saved=await saveWritingContext(store,task,current);
  return {context:publicContextView(saved),candidate,mounted:false};
 }
 const resolved=await resolveMountInput(store,task,input,options);
 if(resolved.candidate){
  const candidate=pushCandidate(current,resolved.candidate);
  const saved=await saveWritingContext(store,task,current);
  return {context:publicContextView(saved),candidate,mounted:false};
 }
 const ids=addResolved(current,resolved,{role:input.role});
 if(resolved.page){
  current.evidence.push({
   id:randomUUID(),mountId:ids.mountId,versionId:ids.versionId,
   locator:{url:resolved.page.url,dateBasis:resolved.page.dateBasis},
   text:resolved.page.text,hash:resolved.page.contentHash,truncated:!!resolved.page.truncated,readAt:new Date().toISOString(),
  });
 }
 const saved=await saveWritingContext(store,task,current);
 return {context:publicContextView(saved),mount:ids.mount,mounted:true};
}

export async function unmountResource(store,task,mountId,params={}){
 const current=await loadWritingContext(store,task);
 assertContextScope(task,{...params,mountId},current,store);
 if(task.runtime?.busy||task.runtime?.queued)throw Error('请先停止当前任务再移出资料');
 const mount=current.mounts.find(m=>m.id===mountId);
 if(!mount)throw Error('挂载不存在或不属于本篇');
 current.mounts=current.mounts.filter(m=>m.id!==mountId);
 const saved=await saveWritingContext(store,task,current);
 return {context:publicContextView(saved),keptEvidence:saved.evidence.filter(e=>e.mountId===mountId).length,keptCitations:saved.citations.filter(c=>saved.evidence.some(e=>e.id===c.evidenceId&&e.mountId===mountId)).length};
}

export async function setMountEnabled(store,task,mountId,enabled,params={}){
 const current=await loadWritingContext(store,task);
 assertContextScope(task,{...params,mountId},current,store);
 if(task.runtime?.busy||task.runtime?.queued)throw Error('请先停止当前任务再停用资料');
 const mount=current.mounts.find(m=>m.id===mountId);
 if(!mount)throw Error('挂载不存在或不属于本篇');
 mount.enabled=enabled!==false;
 const saved=await saveWritingContext(store,task,current);
 return {context:publicContextView(saved)};
}

export async function adjustMountScope(store,task,mountId,scope,params={}){
 const current=await loadWritingContext(store,task);
 assertContextScope(task,{...params,mountId},current,store);
 if(task.runtime?.busy||task.runtime?.queued)throw Error('运行中不能变更范围，请先停止当前任务');
 const mount=current.mounts.find(m=>m.id===mountId);if(!mount)throw Error('挂载不存在或不属于本篇');
 const resource=current.resources[mount.resourceId],version=current.versions[mount.versionId];
 const input={kind:resource.kind,...resource.locator,...mount.scope,...scope,contentHash:resource.locator.contentHash||version.contentHash,name:resource.locator.name};
 const resolved=await resolveMountInput(store,task,input,params);
 if(resolved.candidate)throw Error('调整范围需要已挂载的资料，不能改成搜索候选');
 const versionId=randomUUID();
 current.versions[versionId]={id:versionId,resourceId:resource.id,immutable:true,createdAt:new Date().toISOString(),contentHash:String(resolved.version.contentHash),label:resolved.version.label||'',snapshot:resolved.version.snapshot||{},...(resolved.version.gaps?.length?{gaps:resolved.version.gaps}:{})};
 mount.versionId=versionId;
 mount.scope=resolved.scope||scope;
 mount.state=resolved.state||mount.state;
 if(resolved.error)mount.error=resolved.error;else delete mount.error;
 const saved=await saveWritingContext(store,task,current);
 return {context:publicContextView(saved),versionId};
}

function assertNetwork(context,kind,cached,{networkAllowed=context.allowNetwork}={}){
 if(cached)return;
 if((kind==='web'||kind==='github')&&networkAllowed!==true)throw Error('本篇或本轮未允许联网补充');
}

export async function searchMount(store,task,mountId,query,params={}){
 const current=await loadWritingContext(store,task);
 assertContextScope(task,{...params,mountId,versionId:params.versionId},current,store);
 const {mount,resource,version}=requireMount(current,mountId,params.versionId);
 const kind=resource.kind;
 if(kind==='rss')return {items:searchRssMount(spaceIdOf(task,store),store.root,{version,scope:mount.scope},query)};
 if(kind==='file'){
  const parsed=await loadImportedFile(store,task.id,resource.locator.contentHash,resource.locator.name);
  return {items:searchFileChapters(parsed,mount.scope,query)};
 }
 if(kind==='github'){
  const files=(version.snapshot.files||[]).filter(f=>!query||f.path.toLowerCase().includes(String(query).toLowerCase()));
  return {items:files.slice(0,40),treeTruncated:!!version.snapshot.treeTruncated,completeTree:version.snapshot.completeTree!==false};
 }
 if(kind==='signals'){
  const items=(version.snapshot.items||[]).filter(item=>!query||String(item.term||'').toLowerCase().includes(String(query).toLowerCase()));
  return {items,role:'lead',note:'选题线索，不是新闻全文'};
 }
 if(kind==='existing'){
  const items=version.snapshot.items||(version.snapshot.id?[{id:version.snapshot.id,title:version.snapshot.title}]:[]);
  return {items:items.filter(item=>!query||JSON.stringify(item).toLowerCase().includes(String(query).toLowerCase()))};
 }
 if(kind==='web'){
  if(version.snapshot.query)return {items:[],note:'搜索结果是候选，读取页面后才是证据'};
  return {items:[{url:resource.locator.url,title:resource.title}]};
 }
 return {items:[]};
}

function recordEvidence(context,mount,payload){
 const item={id:randomUUID(),mountId:mount.id,versionId:mount.versionId,locator:payload.locator||{},text:String(payload.text||'').slice(0,20000),hash:payload.hash||hash(payload.text||''),truncated:!!payload.truncated||String(payload.text||'').length>20000,readAt:new Date().toISOString()};
 if(payload.runId||context.frozenRunId)item.runId=payload.runId||context.frozenRunId;
 if(payload.gap)item.gap=payload.gap;
 context.evidence.push(item);
 return item;
}

export async function readMount(store,task,mountId,locator={},params={}){
 const current=await loadWritingContext(store,task);
 assertContextScope(task,{...params,mountId,versionId:params.versionId},current,store);
 const {mount,resource,version}=requireMount(current,mountId,params.versionId);
 const kind=resource.kind;
 let evidence;
 if(kind==='rss'){
  const ids=version.snapshot.articleIds||mount.scope.articleIds||[];
  const articleId=locator.articleId||ids[0];
  if(!articleId||!ids.map(Number).includes(Number(articleId)))throw Error('读取范围不在本篇挂载的 RSS 集合内');
  const article=readRssArticle(spaceIdOf(task,store),store.root,articleId);
  const text=(article.body||article.structured&&JSON.stringify(article.structured)||'').slice(0,20000);
  evidence=recordEvidence(current,mount,{locator:{articleId,url:article.url,title:article.title,publishedAt:article.publishedAt},text,truncated:!!article.body&&article.body.length>20000,gap:article.missingBody?'缺正文':article.dateUnknown?'日期不明':undefined});
 }
 else if(kind==='web'){
  const url=locator.url||resource.locator.url;
  if(!url)throw Error('搜索结果需先加入候选并读取页面');
  if(resource.locator.url&&url!==resource.locator.url)throw Error('网页不在本篇挂载的范围内');
  assertNetwork(current,'web',false,params);
  const page=await readPublicPage(url,params.fetcher||fetch);
  evidence=recordEvidence(current,mount,{locator:{url:page.url,publishedAt:page.publishedAt,dateBasis:page.dateBasis},text:page.text,hash:page.contentHash,truncated:page.truncated});
 }
 else if(kind==='file'){
  let parsed;
  try{parsed=await loadImportedFile(store,task.id,resource.locator.contentHash,resource.locator.name);}
  catch(error){throw Error('本地副本不在当前空间，只能查看已有出处记录');}
  if(parsed.needsOcr)throw Error('扫描 PDF 需文字识别，当前不能当作已可全文检索');
  const fragment=readFileFragment(parsed,mount.scope,locator);
  evidence=recordEvidence(current,mount,{locator:{...fragment.locator,name:resource.title},text:fragment.text});
 }
 else if(kind==='github'){
  const path=locator.path;
  validateGithubPath(path);
  const allowed=new Set((version.snapshot.files||[]).map(f=>f.path));
  if(!allowed.has(path))throw Error('文件不在本篇挂载的目录范围内');
  const snap=version.snapshot||{};
  let cached=false;
  try{await readFile(join(cachePath(store,task.id,snap.owner,snap.repo,snap.commit),path),'utf8');cached=true;}catch{}
  assertNetwork(current,'github',cached,params);
  const file=await readGithubFile(store,task.id,{version},path,params.fetcher||fetch);
  const start=Number(locator.startLine||locator.start||1);
  const lines=file.text.split(/\r?\n/);
  const slice=locator.endLine||locator.query?lines.slice(start-1,locator.endLine||start+40).join('\n'):file.text.slice(0,8000);
  const ev=fileEvidence(version.snapshot.owner,version.snapshot.repo,version.snapshot.commit,path,slice,start);
  evidence=recordEvidence(current,mount,{locator:ev.locator,text:ev.text,hash:ev.hash,truncated:file.text.length>8000});
 }
 else if(kind==='signals'){
  const item=(version.snapshot.items||[]).find(row=>row.id===locator.id||row.term===locator.term)||version.snapshot.items?.[0];
  evidence=recordEvidence(current,mount,{locator:{term:item?.term,platformId:item?.platformId,observedAt:version.snapshot.observedAt},text:JSON.stringify(item||{note:'选题线索'},null,2),gap:'选题线索，查找原文后才能形成事实依据'});
 }
 else if(kind==='existing'){
  const id=locator.id||resource.locator.id||version.snapshot.id;
  if(!id)throw Error('请指定要读取的已有作品');
  const ids=version.snapshot.id?[version.snapshot.id]:(version.snapshot.items||[]).map(item=>item.id);
  if(!ids.includes(id))throw Error('作品不在本篇挂载的范围内');
  const work=await readExistingWork(store.root,id);
  evidence=recordEvidence(current,mount,{locator:{id:work.id,sha256:work.sha256,canonicalPath:work.canonicalPath},text:work.markdown.slice(0,20000),hash:work.sha256,truncated:work.markdown.length>20000});
 }
 else throw Error('未知资料来源');
 const saved=await saveWritingContext(store,task,current);
 return {context:publicContextView(saved),evidence};
}

export async function citeEvidence(store,task,{evidenceId,blockId,label=''},params={}){
 const current=await loadWritingContext(store,task);
 assertContextScope(task,params,current,store);
 if(!current.evidence.some(e=>e.id===evidenceId))throw Error('引用必须指向已读证据');
 current.citations.push({id:randomUUID(),blockId,evidenceId,label});
 const saved=await saveWritingContext(store,task,current);
 return {context:publicContextView(saved)};
}

export async function freezeWritingContext(store,task,runId){
 const current=await loadWritingContext(store,task);
 current.frozenRunId=runId;
 for(const mount of current.mounts.filter(m=>m.enabled)){
  const resource=current.resources[mount.resourceId];
  if(resource?.kind!=='rss')continue;
  if(!mount.scope?.range?.dynamic&&Array.isArray(mount.scope?.articleIds)&&mount.scope.articleIds.length)continue;
  if(resource.locator.articleId&&!mount.scope?.range?.dynamic)continue;
  const range=mount.scope?.range?.days?`${mount.scope.range.days}d`:mount.scope?.range||resource.locator.range||'30d';
  try{
   const resolved=resolveRssMount(spaceIdOf(task,store),store.root,{...resource.locator,...mount.scope,range,query:mount.scope?.query});
   const versionId=randomUUID();
   current.versions[versionId]={id:versionId,resourceId:resource.id,immutable:true,createdAt:new Date().toISOString(),contentHash:resolved.version.contentHash,label:resolved.version.label,snapshot:resolved.version.snapshot,...(resolved.version.gaps?.length?{gaps:resolved.version.gaps}:{})};
   mount.versionId=versionId;
   mount.scope={...mount.scope,...resolved.scope,range:{start:resolved.version.snapshot.range.start,end:resolved.version.snapshot.range.end,frozen:true,label:resolved.version.snapshot.range.label}};
   mount.state=resolved.state;
  }catch(error){
   mount.state=mount.state==='ready'?'partial':mount.state;
   mount.error=error.message;
  }
 }
 return saveWritingContext(store,task,current);
}

export function workflowFromContext(context,fallback='rss'){
 const kinds=[...new Set(context.mounts.filter(m=>m.enabled).map(m=>context.resources[m.resourceId]?.kind).filter(Boolean))];
 const allowNetwork=context.allowNetwork===true;
 return {sources:allowNetwork||kinds.includes('web')||kinds.includes('github')?'combined':(kinds.length?'rss':fallback),allowNetwork,mountKinds:kinds,contextRevision:context.revision};
}

export async function bindExportContext(store,task,bodySha){
 const context=await loadWritingContext(store,task);
 context.bodySha=bodySha;
 const saved=await saveWritingContext(store,task,context);
 await atomicJson(exportContextPath(store.root,task.articleId),saved);
 return saved;
}

export async function restoreBoundContext(store,task,bodySha){
 const saved=await optionalJson(exportContextPath(store.root,task.articleId));
 if(saved?.bodySha===bodySha){
  const context=validateWritingContext(saved);
  if(context.articleId!==task.articleId||context.spaceId!==spaceIdOf(task,store))throw Error('跨空间不可读取本篇资料');
  await atomicJson(liveContextPath(store,task.id),context);
  return context;
 }
 return loadWritingContext(store,task);
}

export async function applyMountSpec(store,task,spec,options={}){
 const input=typeof spec==='string'?parseMountSpec(spec):spec;
 return mountResource(store,task,input,options);
}

export async function applyMountList(store,task,specs,options={}){
 let last=await getWritingContext(store,task);
 for(const spec of specs)last=await applyMountSpec(store,task,spec,options);
 return last;
}
