import {readFile,writeFile,mkdir,rename,readlink,access} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import p from '../contracts/rssd-v1.cjs';
import {contentKey} from '../contracts/rssd-publication.cjs';
import {buildSiteRelease} from '../web/engine/render-site.mjs';
import {sourceContentSha256} from '../contracts/language-editions.mjs';
import {activateRelease} from '../admin/worker.mjs';
import {verifyLive} from '../admin/release-verification.mjs';
import {digest} from '../admin/model.mjs';
import {byteHash} from '../web/engine/theme-homepage.mjs';
import {recordFields} from '../contracts/rssd-record.cjs';

export function snapshotForPackets(packets,site,baseline={}) {
  const snapshot=structuredClone({news:[],data:{year:[],history:[]},openSource:{items:[]},permalinks:{},editorialRecords:[],...baseline});
  const identity=baseline.rssdIdentity||{};
  const ids=new Map(packets.map(x=>[contentKey(x),identity[contentKey(x)]?.id||'rssd-'+contentKey(x).slice(0,32)]));
  const entries=packets.map(packet=>{
    const c=packet.content,id=ids.get(contentKey(packet)),section=site.sections.find(s=>s.id===packet.sectionId);
    const data={id,title:c.title,markdown:c.bodyMarkdown,summary:c.summary,locale:packet.locale,sectionId:packet.sectionId,
      category:c.metadata.category||section?.name||site.columns[1],author:c.metadata.author||site.author,date:c.metadata.date||'1970-01-01',
      sources:c.sources.map(s=>({label:s.title||'Source',url:s.url})),assets:[]};
    return {packet,data};
  });
  for(const {packet,data} of entries){
    const mapped=identity[contentKey(packet)];
    if(mapped?.kind&&mapped.kind!=='news'&&packet.locale==='zh-CN'&&!packet.content.metadata.record)throw Error('An existing structured record must retain its record fields');
    if(packet.content.metadata.record&&packet.locale==='zh-CN'){
      const record=packet.content.metadata.record,kind=record.kind;
      if(mapped&&mapped.kind!==kind)throw Error('A migrated record cannot change its content kind');
      const fields={...recordFields(record,packet.content),...(kind!=='openSource'?{id:data.id}:{}),sectionId:packet.sectionId,assets:[]};
      const key=kind+':'+(kind==='openSource'?fields.url:data.id),list=kind==='year'?snapshot.data.year:kind==='history'?snapshot.data.history:snapshot.openSource.items;
      const index=list.findIndex(x=>kind==='openSource'?x.url===(mapped?.url||fields.url):x.id===data.id);
      if(index>=0)list[index]=fields;else list.push(fields);
      if(mapped?.key&&mapped.key!==key)delete snapshot.permalinks[mapped.key];
      snapshot.permalinks[key]=packet.route;
      const descriptor={documentId:mapped?.documentId||packet.workId,kind,key,updated:new Date(data.date).getTime()||0};
      const descriptorIndex=snapshot.editorialRecords.findIndex(x=>x.documentId===descriptor.documentId);
      if(descriptorIndex>=0)snapshot.editorialRecords[descriptorIndex]=descriptor;else snapshot.editorialRecords.push(descriptor);
      continue;
    }
    const original=entries.find(x=>x.packet.workId===packet.workId&&x.packet.locale==='zh-CN');
    if(packet.locale==='en'){
      if(original)data.translationOf={articleId:original.packet.content.metadata.record?'record-'+(identity[contentKey(original.packet)]?.documentId||original.packet.workId):original.data.id,locale:'zh-CN',sha256:sourceContentSha256(original.data)};
      else {const previous=snapshot.news.find(x=>x.id===data.id);if(previous?.translationOf)data.translationOf=previous.translationOf;}
    }
    // Migration uses a stable identity map; titles are never matching keys.
    const existing=snapshot.news.findIndex(x=>x.id===data.id);if(existing>=0)snapshot.news[existing]=data;else snapshot.news.push(data);
    snapshot.permalinks['news:'+data.id]=packet.route;
  }
  return snapshot;
}
export async function buildAndActivate({job,site,source,base,baseline,media,verify=manifest=>verifyLive(manifest,site.origin,false)}) {
  const current=join(base,'current'),key=contentKey(job.packet),publicPath='rssd-content/'+key+'.json';
  // A lost SQLite acknowledgement after activation is recovered by inspecting
  // the exact activated artifact before starting another build.
  if(job.resume){
    try{
      const active=JSON.parse(await readFile(join(current,'release.json'),'utf8'));
      const published=JSON.parse(await readFile(join(current,publicPath),'utf8'));
      if(active.rssd?.requestId===job.id&&p.hash(published)===p.hash(job.packet)){
        try{await verify(active);return makeReceipt(job,active.release,site,publicPath);}
        catch(error){
          if(/^admin-[a-zA-Z0-9-]+$/.test(active.previousRelease||'')){
            const previous=join(base,'releases',active.previousRelease);await access(join(previous,'index.html'));
            await activateRelease({base,release:previous,verify:async()=>{}});
          }
          throw error;
        }
      }
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const buildId=randomUUID(),release='admin-'+buildId,stage=join(base,'releases','.building-'+buildId),target=join(base,'releases',release);
  await mkdir(stage,{recursive:true});
  const mediaHashes={},mediaByteHashes={};
  for(const asset of new Map(job.packets.flatMap(p=>(p.assets||[]).map(a=>[a.path,a]))).values()){
    if(!media)throw Error('Publication media store is unavailable');const bytes=await media.bytes(asset),path=asset.path.slice(1);
    await mkdir(dirname(join(stage,path)),{recursive:true});await writeFile(join(stage,path),bytes);mediaHashes[path]=digest(bytes);mediaByteHashes[path]=byteHash(bytes);
  }
  const snapshot=snapshotForPackets(job.packets,site,baseline),snapshotHash=p.hash(snapshot);
  const manifest=await buildSiteRelease({job:{id:buildId,snapshot,snapshot_hash:snapshotHash},target:stage,source,previousRoot:current,site});
  Object.assign(manifest.hashes,mediaHashes);manifest.byteHashes={...manifest.byteHashes,...mediaByteHashes};
  for(const packet of job.packets){
    const path='rssd-content/'+contentKey(packet)+'.json',bytes=JSON.stringify(packet);await mkdir(dirname(join(stage,path)),{recursive:true});await writeFile(join(stage,path),bytes);manifest.hashes[path]=p.hash(bytes);
  }
  // Fail before activation when the renderer omitted the requested edition.
  await access(join(stage,job.packet.route.slice(1),'index.html'));
  manifest.rssd={requestId:job.id,packetHash:p.hash(job.packet)};
  try{manifest.previousRelease=(await readlink(current)).split(/[\\/]/).at(-1);}catch(error){if(error.code!=='ENOENT')throw error;}
  await writeFile(join(stage,'release.json'),JSON.stringify(manifest));await rename(stage,target);
  await activateRelease({base,release:target,verify:()=>verify(manifest)});
  return makeReceipt(job,release,site,publicPath);
}
function makeReceipt(job,release,site,publicPath){return {requestId:job.id,contentHash:job.packet.contentHash,packetHash:p.hash(job.packet),revision:job.packet.revision,release,url:site.origin+job.packet.route,publicUrl:site.origin+'/'+publicPath};}
