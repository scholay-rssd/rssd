import {DatabaseSync} from 'node:sqlite';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import p from '../contracts/rssd-v1.cjs';
import {imageManifest,mediaId} from '../contracts/rssd-media.cjs';
import {record as publicRecord} from '../contracts/rssd-record.cjs';
import {sourceContentSha256} from '../contracts/language-editions.mjs';
import {snapshot} from '../admin/store.mjs';
import {profiles,validateSite} from './site-config.mjs';
import {sectionsForSite} from '../contracts/site-sections.mjs';

const bytesHash=bytes=>createHash('sha256').update(bytes).digest('hex');
const workId=(siteId,id)=>'legacy-'+p.hash([siteId,id]).slice(0,48);
const markdown=(kind,data,site)=>kind==='news'?data.markdown:'# '+data.title+'\n\n'+({year:[['摘要',data.summary],['正文',data.body]],history:[['事实摘要',data.factSummary],[site.legacy?'学术意义':'历史意义',data.historicalSignificance]],openSource:[['项目简介',data.summary],[site.legacy?'学术价值':'使用价值',data.value]]}[kind]).map(([h,t])=>'## '+h+'\n\n'+(t||'')).join('\n\n')+'\n';

/** Export a consistent read-only SQLite snapshot. No live writer or channel is contacted. */
export async function exportLegacySite({database,site,output}){
 site=validateSite(site);output=resolve(output);await mkdir(join(output,'documents'),{recursive:true,mode:0o700});await mkdir(join(output,'media'),{recursive:true,mode:0o700});
 const db=new DatabaseSync(resolve(database),{readOnly:true});
 try{
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Source database integrity failed');
  const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
  const select=(table,where='',...args)=>tables.has(table)?db.prepare('SELECT * FROM '+table+where).all(...args):[];
  const docs=select('documents'),byArticle=new Map(),prepared=new Map(),sections=sectionsForSite(site).map(s=>({id:s.id,name:s.name,policy:{version:1,targets:[]}}));
  for(const doc of docs){
   const revisions=select('revisions',' WHERE document_id=? ORDER BY version',doc.id),last=revisions.find(r=>r.version===doc.latest_revision);
   if(!last)throw Error('Missing latest revision '+doc.id);const data=JSON.parse(last.payload),articleId=doc.kind==='news'?data.id:'record-'+doc.id;
   if(byArticle.has(articleId))throw Error('Duplicate legacy article identity '+articleId);
   const item={doc,revisions,data,articleId,workId:workId(site.id,doc.id)};byArticle.set(articleId,item);prepared.set(doc.id,item);
  }
  // Only explicit source identities establish a bilingual work; never titles.
  for(const item of prepared.values())if(item.data.translationOf){
   const source=byArticle.get(item.data.translationOf.articleId);if(!source||source.data.locale==='en')throw Error('Unresolved translation source '+item.doc.id);
   item.source=source;item.workId=source.workId;
  }
  const documents=[],identity={},media=new Map(),warnings=[],seenEditions=new Set();
  for(const item of prepared.values()){
   const {doc,data,revisions}=item,locale=data.locale||'zh-CN',editionKey=p.hash([item.workId,locale]);
   if(seenEditions.has(editionKey))throw Error('Several documents claim the same language edition '+doc.id);seenEditions.add(editionKey);
   const sectionData=item.source?.data||data;
   let sectionId=sectionData.sectionId||sections.find(s=>s.name===sectionData.category)?.id;
   if(!sectionId){sectionId=({year:'calendar',history:'history',openSource:'open-source'})[item.source?.doc.kind||doc.kind]||'archive';
    if(!sections.some(s=>s.id===sectionId))sections.push({id:sectionId,name:({year:site.columns[3],history:site.columns[4],openSource:site.columns[2]})[doc.kind]||'历史文章',policy:{version:1,targets:[]}});
    warnings.push({documentId:doc.id,code:'section_inferred_from_original_kind',sectionId});
   }
   if(!sections.some(s=>s.id===sectionId))throw Error('Unknown legacy section '+sectionId);
   const editions=[];
   for(const revision of revisions){
    const original=JSON.parse(revision.payload);if((original.locale||'zh-CN')!==locale)throw Error('Legacy document changed language '+doc.id);
    let bodyMarkdown=markdown(doc.kind,original,site);const attachments=[];
    for(const asset of original.assets||[]){
     if(!asset.data)throw Error('Missing source image bytes '+doc.id+' '+asset.path);
     const bytes=Buffer.from(asset.data,'base64'),manifest=imageManifest(bytes);if(manifest.path!==asset.path)throw Error('Legacy image checksum mismatch');
     const id=mediaId(site.spaceId,manifest.sha256);attachments.push({id,alt:''});
     if(!media.has(id)){const path='media/'+manifest.path.split('/').at(-1);await writeFile(join(output,path),bytes,{mode:0o600});media.set(id,{id,workspaceId:site.spaceId,manifest,path});}
     bodyMarkdown=bodyMarkdown.replaceAll(asset.path,'/api/rssd/v1/media/'+id+'/raw');
    }
    let translationOf=null;
    if(original.translationOf){
     const source=item.source,ref=original.translationOf;
     const sourceRevision=source.revisions.find(r=>r.version===ref.revision&&(!ref.sha256||sourceContentSha256(JSON.parse(r.payload))===ref.sha256))||source.revisions.find(r=>sourceContentSha256(JSON.parse(r.payload))===ref.sha256);
     if(!sourceRevision)throw Error('Missing translation source revision '+doc.id);
     translationOf={workId:item.workId,locale:'zh-CN',revision:sourceRevision.version};
    }
    const sources=(original.sources||[{label:original.sourceName||'原始来源',url:original.sourceUrl||original.url}]).filter(s=>/^https?:\/\//.test(s.url||'')).map(s=>({title:s.label||s.title||'',url:s.url}));
    const metadata={author:original.author||site.author,date:original.date||new Date(revision.created).toISOString().slice(0,10),category:original.category||sections.find(s=>s.id===sectionId).name,
     publication:{path:doc.permalink},migration:{siteId:site.id,documentId:doc.id,revision:revision.version,sourceKey:doc.source_key,sourceSha256:bytesHash(revision.payload)}};
    if(doc.kind!=='news')metadata.record=publicRecord({kind:doc.kind,fields:original});
    const payload=p.edition({locale,title:original.title,bodyMarkdown,summary:original.summary||original.factSummary||'',sources,media:attachments,translationOf,metadata});
    editions.push({revision:revision.version,payload,hash:p.hash(payload),createdAt:new Date(revision.created).toISOString()});
   }
   const tombstone=select('document_tombstones',' WHERE document_id=?',doc.id)[0]||null;
   const sourceArchives=select('source_archives',' WHERE document_id=?',doc.id).map(row=>({...row,payload:Buffer.from(row.payload).toString('base64'),encoding:'base64',sha256:bytesHash(Buffer.from(row.payload))}));
   const source={document:doc,revisions,tombstone,sourceArchives,requests:select('content_requests',' WHERE document_id=?',doc.id),drafts:select('content_drafts',' WHERE document_id=?',doc.id),actions:select('content_actions',' WHERE document_id=?',doc.id),jobs:select('jobs',' WHERE document_id=?',doc.id)};
   const value={version:1,siteId:site.id,workspaceId:site.spaceId,workId:item.workId,sectionId,locale,editions,source,sourceHash:p.hash(source)};
   const path='documents/'+p.hash(doc.id)+'.json',raw=JSON.stringify(value);await writeFile(join(output,path),raw,{mode:0o600});
   documents.push({documentId:doc.id,workId:item.workId,locale,path,sha256:bytesHash(raw),sourceHash:value.sourceHash,revisions:revisions.length,publishedRevision:doc.published_revision,deleted:Boolean(tombstone)});
   identity[editionKey]={kind:doc.kind,id:data.id||item.articleId,key:doc.source_key,documentId:doc.id,route:doc.permalink,revision:doc.published_revision||0,deleted:Boolean(tombstone),...(doc.kind==='openSource'?{url:data.url}:{})};
  }
  const baseline=snapshot(db,null,{reusePublishedAssets:true});baseline.rssdIdentity=identity;const baselineRaw=JSON.stringify(baseline);await writeFile(join(output,'baseline.json'),baselineRaw,{mode:0o600});
  const ancillary={meta:select('meta'),jobs:select('jobs'),siteJobs:select('site_jobs'),jobDocuments:select('job_documents'),requests:select('content_requests'),drafts:select('content_drafts'),actions:select('content_actions'),audit:select('audit'),tombstones:select('document_tombstones')};
  const ancillaryRaw=JSON.stringify(ancillary);await writeFile(join(output,'ancillary.json'),ancillaryRaw,{mode:0o600});
  const manifest={version:1,site,workspace:{id:site.spaceId,siteId:site.id,name:site.name,sections},databaseSha256:bytesHash(await readFile(database)),documents,media:[...media.values()],warnings,
   baseline:{path:'baseline.json',sha256:bytesHash(baselineRaw)},ancillary:{path:'ancillary.json',sha256:bytesHash(ancillaryRaw)},counts:{documents:documents.length,revisions:documents.reduce((n,d)=>n+d.revisions,0),published:documents.filter(d=>d.publishedRevision&&!d.deleted).length,deleted:documents.filter(d=>d.deleted).length,media:media.size}};
  await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});return manifest;
 }finally{db.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [siteId,database,output]=process.argv.slice(2),site=profiles.find(s=>s.id===siteId);
 if(!site||!database||!output||!resolve(output).split(/[\\/]/).includes('.local'))throw Error('Usage: rssd-migrate-site.mjs SITE SNAPSHOT.sqlite .local/PRIVATE-OUTPUT');
 const result=await exportLegacySite({site,database,output});console.log(JSON.stringify({siteId:site.id,...result.counts,warnings:result.warnings.length}));
}
