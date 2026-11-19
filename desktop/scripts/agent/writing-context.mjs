import {randomUUID} from 'node:crypto';
import {cleanCitationUrl} from '../../../scripts/clean-citation-urls.mjs';
export const WRITING_CONTEXT_SCHEMA=1;
export const CONNECTOR_IDS=['rss','web','file','github','signals','existing'];
export const MOUNT_ROLES=['evidence','background','lead','style'];
export const MOUNT_STATES=['parsing','ready','partial','failed','needs_ocr','unavailable'];
const isRecord=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const text=(value,max,required=false)=>{
 if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw Error('上下文字段无效');
 return value;
};
export function emptyWritingContext(articleId,spaceId,at=new Date().toISOString()){
 return {schemaVersion:WRITING_CONTEXT_SCHEMA,articleId:text(articleId,200,true),spaceId:text(spaceId,64,true),revision:1,allowNetwork:false,mounts:[],candidates:[],evidence:[],citations:[],resources:{},versions:{},updatedAt:at};
}
function sourceKind(source){
 if(source?.acquiredVia==='rss'||source?.rssId)return 'rss';
 if(source?.acquiredVia==='record'||source?.recordId)return 'existing';
 return 'web';
}
export function migrateSourcesToContext(sources,articleId,spaceId,existing){
 const context=existing?validateWritingContext(existing):emptyWritingContext(articleId,spaceId);
 if(!Array.isArray(sources)||!sources.length)return context;
 const seen=new Set(Object.values(context.resources).map(r=>JSON.stringify(r.locator)));
 for(const source of sources){
  if(!source||typeof source!=='object')continue;
  const kind=sourceKind(source);
  const locator=kind==='rss'?{articleId:String(source.rssId||''),url:source.url||''}:kind==='existing'?{recordId:source.recordId||source.id,url:source.url||''}:{url:source.url||''};
  const key=JSON.stringify(locator);
  if(seen.has(key))continue;
  seen.add(key);
  const resourceId=randomUUID(),versionId=randomUUID(),mountId=randomUUID();
  context.resources[resourceId]={id:resourceId,kind,title:String(source.title||'未命名资料').slice(0,300),locator,createdAt:context.updatedAt};
  context.versions[versionId]={id:versionId,resourceId,immutable:true,createdAt:context.updatedAt,contentHash:String(source.id||resourceId),label:'imported-source',snapshot:{title:source.title,summary:source.summary,url:source.url,acquiredVia:source.acquiredVia,rssId:source.rssId,recordId:source.recordId,sourceId:source.id}};
  context.mounts.push({id:mountId,resourceId,versionId,enabled:true,role:'evidence',state:'ready',scope:{legacySourceId:source.id}});
 }
 return context;
}
function checkList(list,name,item){
 if(!Array.isArray(list)||list.length>400)throw Error(name+' 格式无效');
 const ids=new Set();
 for(const value of list){
  const next=item(value);
  if(ids.has(next.id))throw Error(name+' 编号重复');
  ids.add(next.id);
 }
}
export function validateWritingContext(value){
 if(!isRecord(value)||value.schemaVersion!==WRITING_CONTEXT_SCHEMA)throw Error('不支持的本篇上下文格式');
 const context={
  schemaVersion:WRITING_CONTEXT_SCHEMA,
  articleId:text(value.articleId,200,true),
  spaceId:text(value.spaceId,64,true),
  revision:Number.isSafeInteger(value.revision)&&value.revision>0?value.revision:1,
  allowNetwork:value.allowNetwork===true,
  mounts:[],candidates:[],evidence:[],citations:[],
  resources:{},versions:{},
  updatedAt:typeof value.updatedAt==='string'?value.updatedAt:new Date().toISOString(),
 };
 if(value.bodySha!==undefined)context.bodySha=text(value.bodySha,64);
 if(value.frozenRunId!==undefined)context.frozenRunId=text(value.frozenRunId,80);
 if(!isRecord(value.resources)||!isRecord(value.versions))throw Error('资源或版本格式无效');
 for(const [id,resource] of Object.entries(value.resources)){
  if(!isRecord(resource)||resource.id!==id||!CONNECTOR_IDS.includes(resource.kind))throw Error('资源格式无效');
  context.resources[id]={id,kind:resource.kind,title:text(resource.title,400,true),locator:isRecord(resource.locator)?structuredClone(resource.locator):{},createdAt:text(resource.createdAt||context.updatedAt,40)};
 }
 for(const [id,version] of Object.entries(value.versions)){
  if(!isRecord(version)||version.id!==id||!context.resources[version.resourceId]||typeof version.contentHash!=='string')throw Error('资源版本格式无效');
  context.versions[id]={id,resourceId:version.resourceId,immutable:true,createdAt:text(version.createdAt||context.updatedAt,40),contentHash:text(version.contentHash,128,true),label:text(version.label||'',200),snapshot:isRecord(version.snapshot)?structuredClone(version.snapshot):{},...(Array.isArray(version.gaps)?{gaps:version.gaps.map(x=>text(x,400))}:{})};
 }
 checkList(value.mounts||[],'mounts',mount=>{
  if(!isRecord(mount)||!context.resources[mount.resourceId]||!context.versions[mount.versionId]||!MOUNT_ROLES.includes(mount.role)||!MOUNT_STATES.includes(mount.state))throw Error('挂载格式无效');
  const next={id:text(mount.id,80,true),resourceId:mount.resourceId,versionId:mount.versionId,enabled:mount.enabled!==false,role:mount.role,state:mount.state,scope:isRecord(mount.scope)?structuredClone(mount.scope):{}};
  if(Array.isArray(mount.blockIds))next.blockIds=mount.blockIds.map(id=>text(id,80,true));
  if(mount.note)next.note=text(mount.note,800);
  if(mount.error)next.error=text(mount.error,800);
  context.mounts.push(next);
  return next;
 });
 checkList(value.candidates||[],'candidates',item=>{
  if(!isRecord(item)||!CONNECTOR_IDS.includes(item.kind))throw Error('候选资料格式无效');
  const next={id:text(item.id,80,true),kind:item.kind,title:text(item.title,400,true),summary:text(item.summary||'',4000),locator:isRecord(item.locator)?structuredClone(item.locator):{},acquiredVia:text(item.acquiredVia||item.kind,40),createdAt:text(item.createdAt||context.updatedAt,40)};
  context.candidates.push(next);
  return next;
 });
 checkList(value.evidence||[],'evidence',item=>{
  if(!isRecord(item)||typeof item.text!=='string'||item.text.length>20000)throw Error('已读证据格式无效');
  const next={id:text(item.id,80,true),mountId:text(item.mountId,80,true),versionId:text(item.versionId,80,true),locator:isRecord(item.locator)?structuredClone(item.locator):{},text:item.text,hash:text(item.hash,128,true),truncated:item.truncated===true,readAt:text(item.readAt||context.updatedAt,40)};
  if(item.runId)next.runId=text(item.runId,80);
  if(item.gap)next.gap=text(item.gap,400);
  context.evidence.push(next);
  return next;
 });
 checkList(value.citations||[],'citations',item=>{
  if(!isRecord(item))throw Error('引用格式无效');
  const next={id:text(item.id,80,true),blockId:text(item.blockId,80,true),evidenceId:text(item.evidenceId,80,true),label:text(item.label||'',200)};
  context.citations.push(next);
  return next;
 });
 if(JSON.stringify(context).length>4000000)throw Error('本篇上下文过大');
 return context;
}
export function contextSummary(context){
 const mounts=context.mounts.length;
 return {mounts,enabled:context.mounts.filter(m=>m.enabled).length,evidence:context.evidence.length,citations:context.citations.length};
}
export function publicContextView(context){
 const value=validateWritingContext(context);
 return {schemaVersion:value.schemaVersion,articleId:value.articleId,spaceId:value.spaceId,revision:value.revision,allowNetwork:value.allowNetwork,mounts:value.mounts,candidates:value.candidates,evidence:value.evidence,citations:value.citations,resources:Object.values(value.resources),versions:Object.values(value.versions),...(value.bodySha?{bodySha:value.bodySha}:{}),...(value.frozenRunId?{frozenRunId:value.frozenRunId}:{})};
}
export function stripPrivateCaches(value){
 const next=structuredClone(value);
 delete next.cache;
 delete next.bytes;
 delete next.token;
 delete next.credential;
 return next;
}

// Which read evidence backs each source the public text cites. A source is
// matched by its address or by its RSS/record id. Hot-list leads and style
// mounts never count as reading, and an RSS item read without its body counts
// only as its summary. This reports gaps; it never blocks completion, because
// the writing policy keeps unresolved sourcing as a private to-do.
export const SOURCE_CITATION_LABEL='source:';
function comparableUrl(value){
 try{
  const url=new URL(cleanCitationUrl(String(value||'')));
  if(!['http:','https:'].includes(url.protocol))return null;
  return url.hostname.replace(/^www\./,'')+url.pathname.replace(/\/+$/,'')+url.search;
 }catch{return null;}
}
function githubTarget(value){
 try{
  const url=new URL(String(value||''));if(url.hostname!=='github.com')return null;
  const [owner,repo,kind,ref,...path]=url.pathname.split('/').filter(Boolean);if(!owner||!repo)return null;
  return {owner:owner.toLowerCase(),repo:repo.replace(/\.git$/,'').toLowerCase(),path:['blob','tree'].includes(kind)&&ref?path.join('/'):''};
 }catch{return null;}
}
function evidenceKind(context,item){return context.resources?.[context.versions?.[item.versionId]?.resourceId]?.kind;}
function countsAsReading(context,item){
 const mount=context.mounts.find(m=>m.id===item.mountId);
 return evidenceKind(context,item)!=='signals'&&!['lead','style'].includes(mount?.role);
}
function evidenceBacks(source,item){
 const at=item.locator||{};
 if(source.rssId!=null&&at.articleId!=null&&String(source.rssId)===String(at.articleId))return true;
 if(source.recordId&&at.id&&source.recordId===at.id)return true;
 const cited=comparableUrl(source.url),read=comparableUrl(at.url);
 if(cited&&cited===read)return true;
 const target=at.owner&&at.repo&&at.path?githubTarget(source.url):null;
 return !!target&&target.owner===String(at.owner).toLowerCase()&&target.repo===String(at.repo).toLowerCase()&&(!target.path||at.path===target.path||at.path.startsWith(target.path+'/'));
}
export function sourceEvidenceLinks(notebook,context){
 const cited=new Map();
 for(const block of notebook?.blocks||[])if(block?.state==='ready')for(const id of block.sourceIds||[]){const rows=cited.get(id)||[];if(!rows.includes(block.id))rows.push(block.id);cited.set(id,rows);}
 const evidence=(context?.evidence||[]).filter(item=>countsAsReading(context,item)),links=[],gaps=[];
 for(const source of notebook?.sources||[]){
  const blockIds=cited.get(source?.id);if(!blockIds)continue;
  const matched=evidence.filter(item=>evidenceBacks(source,item)),full=matched.filter(item=>item.gap!=='缺正文');
  if(full.length)links.push({sourceId:source.id,blockIds,evidenceId:full.at(-1).id});
  else if(source.reviewed!==true)gaps.push({sourceId:source.id,title:source.title,url:source.url,blockIds,reason:matched.length?'summary-only':'unread'});
 }
 return {links,gaps};
}
export function sourceGapNote(gap){
 const name='来源「'+gap.title+'」（'+gap.url+'）';
 return gap.reason==='summary-only'
  ?name+'只读到摘要，缺正文。正文引用它之前，需要读到原文。'
  :name+'在本篇读取记录里没有对应的已读原文。通过其他途径读过的，补记读取范围；没读过的，读原文后再引用。';
}
// Citations derived from sources are replaced on every export; citations
// recorded by hand keep their own labels and stay.
export function sourceCitations(context,links){
 const kept=(context.citations||[]).filter(c=>!c.label.startsWith(SOURCE_CITATION_LABEL));
 const derived=links.flatMap(link=>link.blockIds.map(blockId=>({id:randomUUID(),blockId,evidenceId:link.evidenceId,label:SOURCE_CITATION_LABEL+link.sourceId})));
 return [...kept,...derived].slice(0,400);
}
