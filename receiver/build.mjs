import {readFile,writeFile,mkdir,rename,readlink,access,readdir,lstat,chmod} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import p from '../contracts/rssd-v1.cjs';
import {contentKey,operation,visible} from '../contracts/rssd-publication.cjs';
import {buildSiteRelease} from '../web/engine/render-site.mjs';
import {activateRelease} from '../admin/worker.mjs';
import {verifyLive} from '../admin/release-verification.mjs';
import {digest} from '../admin/model.mjs';
import {byteHash} from '../web/engine/theme-homepage.mjs';
import {recordFields} from '../contracts/rssd-record.cjs';

export function snapshotForPackets(packets,site,baseline={},previousPackets=[]) {
  const snapshot=structuredClone({news:[],data:{year:[],history:[]},openSource:{items:[]},permalinks:{},editorialRecords:[],...baseline});
  const identity=baseline.rssdIdentity||{};
  const ids=new Map(packets.map(x=>[contentKey(x),identity[contentKey(x)]?.id||'rssd-'+contentKey(x).slice(0,32)]));
  // Tombstones must also mask the initial legacy snapshot. Removing only the
  // receiver's latest row would resurrect baseline content on the next build.
  for(const packet of packets.filter(packet=>!visible(packet))){
    const key=contentKey(packet),mapped=identity[key],id=ids.get(key),previous=previousPackets.find(x=>contentKey(x)===key);
    const record=previous?.content?.metadata?.record,kind=mapped?.kind||record?.kind||'news';
    snapshot.news=snapshot.news.filter(x=>x.id!==id);
    if(kind==='year')snapshot.data.year=snapshot.data.year.filter(x=>x.id!==id);
    if(kind==='history')snapshot.data.history=snapshot.data.history.filter(x=>x.id!==id);
    if(kind==='openSource')snapshot.openSource.items=snapshot.openSource.items.filter(x=>x.url!==mapped?.url&&x.url!==record?.fields?.url);
    snapshot.editorialRecords=snapshot.editorialRecords.filter(x=>x.documentId!==(mapped?.documentId||packet.workId));
    for(const [entry,path] of Object.entries(snapshot.permalinks))if(path===packet.route||entry===mapped?.key||entry==='news:'+id)delete snapshot.permalinks[entry];
  }
  const entries=packets.filter(visible).map(packet=>{
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
    // A v1 public packet does not carry a source revision; never infer it
    // from whichever Chinese revision happens to be present during this build.
    if(packet.locale==='en'){
      data.translationSourceStatus='unknown';
      // A shared work ID permits navigation, but does not prove a revision.
      const key=contentKey({workId:packet.workId,locale:'zh-CN'}),mappedSource=identity[key];
      const chinese=entries.find(entry=>entry.packet.workId===packet.workId&&entry.packet.locale==='zh-CN');
      if(chinese||mappedSource){
        const structured=chinese?.packet.content.metadata.record||(mappedSource?.kind&&mappedSource.kind!=='news');
        data.translationCandidateArticleId=structured?'record-'+(mappedSource?.documentId||packet.workId):(chinese?.data.id||mappedSource.id);
      }
    }
    // Migration uses a stable identity map; titles are never matching keys.
    const existing=snapshot.news.findIndex(x=>x.id===data.id);if(existing>=0)snapshot.news[existing]=data;else snapshot.news.push(data);
    snapshot.permalinks['news:'+data.id]=packet.route;
  }
  return snapshot;
}
export async function buildAndActivate({job,site,source,base,baseline,media,bindingStore,makePublic=publicModes,verify=manifest=>verifyLive(manifest,site.origin,false)}) {
  const current=join(base,'current'),key=contentKey(job.packet),publicPath='rssd-content/'+key+'.json';
  const verifyRelease=async manifest=>{
    await verify(manifest);
    if(!visible(job.packet)){
      const response=await fetch(site.origin+job.packet.route,{redirect:'error',signal:AbortSignal.timeout(30000)});
      await response.body?.cancel();
      if(![404,410].includes(response.status))throw Error('Removed edition is still publicly accessible');
    }
  };
  // A lost SQLite acknowledgement after activation is recovered by inspecting
  // the exact activated artifact before starting another build.
  if(job.resume){
    try{
      const active=JSON.parse(await readFile(join(current,'release.json'),'utf8'));
      const published=JSON.parse(await readFile(join(current,publicPath),'utf8'));
      if(active.rssd?.requestId===job.id&&p.hash(published)===p.hash(job.packet)&&(!(job.packets||[]).some(x=>x.locale==='en'&&visible(x))||active.rssd.translationBindingPolicy===1)&&(!job.bindingRefresh||active.rssd.bindingRefresh===job.bindingRefresh)){
        try{await verifyRelease(active);return makeReceipt(job,active.release,site,publicPath);}
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
  const snapshot=snapshotForPackets(job.packets,site,baseline,job.previousPackets);
  for(const packet of job.packets.filter(x=>x.locale==='en'&&visible(x))){const id=baseline?.rssdIdentity?.[contentKey(packet)]?.id||'rssd-'+contentKey(packet).slice(0,32),view=snapshot.news.find(x=>x.id===id&&x.locale==='en');if(!view)throw Error('English view missing');delete view.translationOf;const binding=bindingStore?bindingStore.lookup(packet):{state:'unknown'};view.translationSourceStatus=binding.state;if(binding.state==='verified'){view.translationSourceHashVersion=binding.binding.sourceHashVersion;view.translationOf={articleId:binding.binding.sourceArticleId,revision:binding.binding.sourceRevision,sha256:binding.binding.sourceRenderHash};}}
  const snapshotHash=p.hash(snapshot);
  const manifest=await buildSiteRelease({job:{id:buildId,snapshot,snapshot_hash:snapshotHash},target:stage,source,previousRoot:current,site});
  Object.assign(manifest.hashes,mediaHashes);manifest.byteHashes={...manifest.byteHashes,...mediaByteHashes};
  for(const packet of job.packets){
    const path='rssd-content/'+contentKey(packet)+'.json',bytes=JSON.stringify(packet);await mkdir(dirname(join(stage,path)),{recursive:true});await writeFile(join(stage,path),bytes);manifest.hashes[path]=p.hash(bytes);
  }
  // Fail before activation when the renderer omitted the requested edition.
  if(visible(job.packet))await access(join(stage,job.packet.route.slice(1),'index.html'));
  else {try{await access(join(stage,job.packet.route.slice(1),'index.html'));throw Error('Renderer retained a removed edition');}catch(error){if(error.code!=='ENOENT')throw error;}}
  manifest.rssd={requestId:job.id,packetHash:p.hash(job.packet),operation:operation(job.packet),operationSequence:job.operationSequence,translationBindingPolicy:1,...(job.bindingRefresh?{bindingRefresh:job.bindingRefresh}:{})};
  try{manifest.previousRelease=(await readlink(current)).split(/[\\/]/).at(-1);}catch(error){if(error.code!=='ENOENT')throw error;}
  await writeFile(join(stage,'release.json'),JSON.stringify(manifest));await makePublic(stage);await rename(stage,target);
  await activateRelease({base,release:target,verify:()=>verifyRelease(manifest)});
  return makeReceipt(job,release,site,publicPath);
}
// The service keeps a private umask for its state; the web server reads releases as another user.
export async function publicModes(path){
  const info=await lstat(path);
  // A release contains independent public regular files only. Refuse links
  // and special files before chmod so permissions outside the build cannot change.
  if(info.isFile()&&info.nlink===1)return chmod(path,0o644);
  if(!info.isDirectory())throw Error('Unexpected file type in public release: '+path);
  await chmod(path,0o755);for(const name of await readdir(path))await publicModes(join(path,name));
}
function makeReceipt(job,release,site,publicPath){return {requestId:job.id,contentHash:job.packet.contentHash,packetHash:p.hash(job.packet),revision:job.packet.revision,operation:operation(job.packet),operationSequence:job.operationSequence,release,url:site.origin+job.packet.route,publicUrl:site.origin+'/'+publicPath};}
