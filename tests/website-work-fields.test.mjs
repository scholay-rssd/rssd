import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWebsitePublisher} from '../scripts/website-publication.mjs';
import {createDraft,sha} from '../scripts/editorial-workspace.mjs';
import {DEFAULT_SITE,publicationDirectory} from '../scripts/site-config.mjs';
import {renderArticle} from '../scripts/article-format.mjs';
import {samePublishedContent} from '../scripts/editorial-cloud-release.mjs';
import {normalizeTags,applyWorkFields,checkWorkFields,workFieldsForCenter,sectionPolicyFor} from '../scripts/work-fields.mjs';

const token='rssd_device_'+'w'.repeat(48),site=DEFAULT_SITE,page='/news/work-fields/';
// A Center that keeps a work field a save leaves out, clears it on null (an empty tag list clears the tags) and
// drops a note's source when the work stops being a note, as center/rssd/editorial.cjs does.
async function fixture(t,{capable=true}={}){
  const root=await mkdtemp(join(tmpdir(),'rssd-work-fields-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const directory=join(root,'center');await mkdir(directory);
  await writeFile(join(directory,'connection.json'),JSON.stringify({origin:'https://center.example',token}));
  await mkdir(join(root,'_ops/inventory'),{recursive:true});
  await writeFile(join(root,'_ops/inventory/article-index.json'),JSON.stringify({annexColumns:['新闻聚合'],articles:{}}));
  const state={capable,version:0,publishedVersion:null,data:null,stored:{},posts:[],receipt:null,archives:{}};
  const fetcher=async(url,options={})=>{
    const parsed=new URL(url),route=parsed.pathname;
    if(parsed.origin===site.origin)return new Response('<link rel="canonical" href="'+site.origin+page+'"><div class="article-body">'+renderArticle(state.data.markdown.replace(/^# [^\n]+\n+/,''))+'</div>');
    if(route==='/api/rssd/v1/registry')return Response.json({workspaces:[{id:site.spaceId,siteId:site.id,writable:true,sections:[{id:'briefings',name:'学界犀闻'},{id:'calendar',name:'今日学术'}]}]});
    if(route.endsWith('/site'))return Response.json({protocol:'scholay-content',version:1,siteId:site.id,spaceId:site.spaceId,origin:site.origin,centerManaged:true,capabilities:['language-editions-v1',...(state.capable?['work-types-v1']:[])]});
    if(route.endsWith('/publish')||route.endsWith('/drafts')){
      const packet=JSON.parse(options.body),{workType,adaptedFrom,tags,...content}=packet.data;state.posts.push(packet);
      if(Object.hasOwn(packet.data,'workType')){if(workType===null)delete state.stored.workType;else state.stored.workType=workType;}
      if(Object.hasOwn(packet.data,'adaptedFrom')){if(adaptedFrom===null)delete state.stored.adaptedFrom;else state.stored.adaptedFrom=adaptedFrom;}
      if(state.stored.workType!=='note')delete state.stored.adaptedFrom;
      if(Object.hasOwn(packet.data,'tags')){if(tags?.length)state.stored.tags=tags;else delete state.stored.tags;}
      state.version++;state.data={...content,...state.stored};
      state.receipt={requestKey:packet.requestKey,articleId:content.id,revision:state.version,version:state.version,publishedVersion:state.publishedVersion,url:page,centerManaged:true,...(route.endsWith('/drafts')?{status:'draft_saved'}:{job:{id:packet.requestKey,status:'queued'}})};
      return Response.json(state.receipt);
    }
    if(route.includes('/requests/'))return Response.json(state.receipt);
    if(route.includes('/source-archives/private-notes/'))return Response.json({articleId:state.data?.id,revision:null,privateEditorial:null});
    if(route.endsWith('/source-archives')){const bundle=JSON.parse(options.body),archiveId=sha(JSON.stringify(bundle));state.archives[archiveId]=bundle;return Response.json({archiveId});}
    if(route.includes('/source-archives/')){const archiveId=route.split('/').pop();return Response.json({archiveSha256:archiveId,bundle:state.archives[archiveId]});}
    if(route.includes('/editorial/'))return Response.json({version:state.version,publishedVersion:state.publishedVersion,url:page,data:state.data,published:state.publishedVersion?state.data:null,centerManaged:true});
    throw Error('Unexpected route '+route);
  };
  const client=createWebsitePublisher({root,site,centerDirectory:directory,fetcher,queueKick:async()=>{}});
  const metadata={date:'2026-11-19',summary:'测试摘要',author:'测试作者',category:'学界犀闻',sectionId:'briefings'};
  const draft=id=>createDraft({id,title:'作品类型测试',markdown:'# 作品类型测试\n\n正文。'},root);
  const save=async(id,extra={})=>{const prepared=await client.prepare(id,{intent:'draft',metadata:{...metadata,...extra}});await client.publish(id,{packetSha256:prepared.prepared.packetSha256,intent:'draft'});return state.posts.at(-1);};
  return {root,state,client,metadata,draft,save,fetcher,directory};
}

test('writer tags are trimmed, lose the leading # and repeats, and are refused past the contract limits',()=>{
  assert.deepEqual(normalizeTags(' #AI，教育, #AI\n##研究 方法 '),['AI','教育','研究 方法']);
  assert.deepEqual(normalizeTags('#AI #教育'),['AI','教育']);
  assert.deepEqual(normalizeTags(['  ',' #x ']),['x']);
  assert.deepEqual(normalizeTags(''),[]);
  assert.throws(()=>normalizeTags(Array.from({length:11},(_,i)=>'t'+i)),/最多 10 个标签/);
  assert.throws(()=>normalizeTags(['长'.repeat(41)]),/最多 40 个字/);
  assert.throws(()=>normalizeTags([3]),/文字/);
});

test('work fields are refused when the section, the type or the record kind cannot keep them',()=>{
  assert.deepEqual(sectionPolicyFor(site,'briefings').workTypes,['article','note']);
  // A Center catalog lists sections without work types; the site's own declaration still applies.
  assert.deepEqual(sectionPolicyFor({...site,sectionCatalog:{sections:[{id:'briefings',name:'学界犀闻'}]}},'briefings').workTypes,['article','note']);
  assert.throws(()=>checkWorkFields({workType:'note'},{site,sectionId:'calendar'}),/「今日学术」不收笔记，可选：长文/);
  assert.throws(()=>checkWorkFields({workType:'note'},{site}),/「未归栏」不收笔记/);
  assert.throws(()=>checkWorkFields({workType:'essay'},{site,sectionId:'briefings'}),/长文或笔记/);
  assert.throws(()=>checkWorkFields({workType:'article',adaptedFrom:{articleId:'source-article',revision:1}},{site,sectionId:'briefings'}),/只有笔记/);
  assert.throws(()=>checkWorkFields({workType:'note',adaptedFrom:{articleId:'same-note',revision:1}},{site,sectionId:'briefings',articleId:'same-note'}),/自身/);
  assert.throws(()=>checkWorkFields({workType:'note',adaptedFrom:{articleId:'source-article',revision:0}},{site,sectionId:'briefings'}),/版本/);
  assert.throws(()=>checkWorkFields({workType:'article'},{site,sectionId:'briefings',record:true}),/结构化记录/);
  assert.deepEqual(checkWorkFields({tags:['a']},{site,sectionId:'calendar',record:true}),{tags:['a']});
  // Switching a note to an article drops its source; leaving a key out keeps it.
  const note={workType:'note',adaptedFrom:{articleId:'source-article',revision:2},tags:['a']};
  assert.deepEqual(applyWorkFields(note,{workType:'article'}),{workType:'article',tags:['a']});
  assert.deepEqual(applyWorkFields(note,{tags:'#b'}),{...note,tags:['b']});
  assert.deepEqual(workFieldsForCenter(note,{record:true}),{tags:['a']});
  assert.deepEqual(workFieldsForCenter({workType:'article',tags:[]}),{workType:'article',tags:[]});
});

test('content comparisons check only the work fields the expected copy states',()=>{
  const base={id:'a-work',title:'T',summary:'S',markdown:'# T',date:'2026-11-19',category:'c',author:'a',assets:[]};
  assert(samePublishedContent(base,{...base,workType:'note',tags:['kept']}));
  assert(samePublishedContent({...base,tags:[]},base));
  assert(!samePublishedContent({...base,tags:[]},{...base,tags:['still there']}));
  assert(!samePublishedContent({...base,workType:'article'},{...base,workType:'note'}));
  assert(samePublishedContent({...base,workType:'note',tags:['x']},{...base,tags:['x'],workType:'note'}));
});

test('a Center without work-types-v1 receives none of the work fields, and screens read them as fixed',async t=>{
  const f=await fixture(t,{capable:false});await f.draft('plain-center-work');
  const sent=await f.save('plain-center-work',{workType:'note',tags:['AI']});
  for(const key of ['workType','adaptedFrom','tags'])assert(!Object.hasOwn(sent.data,key),key);
  assert.equal(sent.workFields,undefined);
  const detail=await f.client.inspect('plain-center-work');
  assert.equal(detail.workFields,false);assert.equal(detail.metadata.workType,'note');assert.deepEqual(detail.metadata.tags,['AI']);
  assert.equal(detail.stale,false);
  assert.equal((await f.client.snapshot()).connection.workFields,undefined);
});

test('a work-types-v1 Center receives the stated fields, frozen with the request, and the cached capability opens the editors',async t=>{
  const f=await fixture(t);await f.draft('typed-center-work');
  const sent=await f.save('typed-center-work',{workType:'note',tags:[' #AI ','教育','AI']});
  assert.equal(sent.workFields,true);assert.equal(sent.data.workType,'note');assert.deepEqual(sent.data.tags,['AI','教育']);
  const detail=await f.client.inspect('typed-center-work');
  assert.equal(detail.workFields,true);assert.equal(detail.stale,false);assert.equal(detail.stage,'draft_saved');
  const snapshot=await f.client.snapshot();
  assert.equal(snapshot.connection.workFields,true);assert.equal(snapshot.articles[0].workFields,true);assert.equal(snapshot.articles[0].metadata.workType,'note');
  // The Center's section list leaves out work types; the cached catalog keeps the site's declaration for the screens.
  const catalog=JSON.parse(await readFile(join(f.root,'.local/site-section-catalog.json'),'utf8'));
  assert.deepEqual(catalog.sections.find(section=>section.id==='briefings').workTypes,['article','note']);
  // Removing every tag sends an empty list, which clears them at the Center.
  const cleared=await f.save('typed-center-work',{tags:[]});
  assert.deepEqual(cleared.data.tags,[]);assert.equal(cleared.data.workType,'note');
  assert.equal(f.state.data.tags,undefined);assert.equal((await f.client.inspect('typed-center-work')).stale,false);
});

test('pull keeps a note\'s type, source and tags; switching it to an article drops the source on the next save',async t=>{
  const f=await fixture(t),id='pulled-note-work';
  f.state.version=3;f.state.stored={workType:'note',adaptedFrom:{articleId:'source-article',revision:2},tags:['AI']};
  f.state.data={id,title:'取回的笔记',summary:'摘要',markdown:'# 取回的笔记\n\n正文。',date:'2026-11-18',author:'作者',category:'学界犀闻',sectionId:'briefings',assets:[],...f.state.stored};
  await f.client.pull(id,{source:'cloud'});
  const saved=JSON.parse(await readFile(join(publicationDirectory(f.root),id,'metadata.json'),'utf8'));
  assert.equal(saved.workType,'note');assert.deepEqual(saved.adaptedFrom,{articleId:'source-article',revision:2});assert.deepEqual(saved.tags,['AI']);
  let detail=await f.client.inspect(id);assert.equal(detail.sync.state,'synced');
  // A form that predates the work fields keeps them when it saves the other metadata.
  const {workType,adaptedFrom,tags,...form}=detail.metadata;
  detail=await f.client.localAction(id,{action:'metadata',metadata:{...form,summary:'新的摘要'},expectedSourceSha256:detail.sourceSha256,expectedMetadataSha256:detail.metadataSha256});
  assert.equal(detail.metadata.workType,'note');assert.deepEqual(detail.metadata.adaptedFrom,{articleId:'source-article',revision:2});
  // So does setting the section from the work's settings.
  await f.client.localAction(id,{action:'category',sectionId:'briefings',expectedFingerprint:detail.sync.fingerprint});
  detail=await f.client.inspect(id);assert.equal(detail.metadata.workType,'note');assert.deepEqual(detail.metadata.tags,['AI']);
  await assert.rejects(f.client.localAction(id,{action:'work_fields',workType:'article',adaptedFrom:{articleId:'source-article',revision:2},expectedFingerprint:detail.sync.fingerprint}),/只有笔记/);
  await assert.rejects(f.client.localAction(id,{action:'work_fields',tags:Array.from({length:11},(_,i)=>'t'+i),expectedFingerprint:detail.sync.fingerprint}),/最多 10 个标签/);
  await assert.rejects(f.client.localAction(id,{action:'work_fields',workType:'article',expectedFingerprint:'stale'}),/已变化/);
  const changed=await f.client.localAction(id,{action:'work_fields',workType:'article',tags:'#AI, 方法',expectedFingerprint:detail.sync.fingerprint});
  const {adaptedFrom:dropped,...kept}=detail.metadata;assert(dropped);
  assert.deepEqual(changed.metadata,{...kept,workType:'article',tags:['AI','方法']});
  const prepared=await f.client.prepare(id,{intent:'draft'});
  await f.client.publish(id,{packetSha256:prepared.prepared.packetSha256,intent:'draft'});
  const sent=f.state.posts.at(-1).data;
  assert.equal(sent.workType,'article');assert.equal(Object.hasOwn(sent,'adaptedFrom'),false);assert.deepEqual(sent.tags,['AI','方法']);
  assert.equal(f.state.data.adaptedFrom,undefined);assert.equal(f.state.data.workType,'article');
});

test('a section that does not take the chosen type stops the save before anything is sent',async t=>{
  const f=await fixture(t);await f.draft('wrong-section-work');
  await assert.rejects(f.client.prepare('wrong-section-work',{intent:'draft',metadata:{...f.metadata,sectionId:'calendar',category:'今日学术',workType:'note'}}),/「今日学术」不收笔记/);
  assert.equal(f.state.posts.length,0);
});

test('a type and tags kept by the Center but not stated locally still let the published copy release the local one',async t=>{
  const f=await fixture(t);await f.draft('kept-type-work');
  f.state.stored={workType:'note',tags:['kept']};
  const prepared=await f.client.prepare('kept-type-work',{metadata:f.metadata,releaseLocal:true});
  await f.client.publish('kept-type-work',{packetSha256:prepared.prepared.packetSha256});
  const sent=f.state.posts.at(-1).data;assert.equal(Object.hasOwn(sent,'workType'),false);assert.equal(Object.hasOwn(sent,'tags'),false);
  assert.equal(f.state.data.workType,'note');
  f.state.receipt.job.status='success';f.state.publishedVersion=f.state.version;
  const published=await f.client.status('kept-type-work');
  assert.equal(published.cleanupError,undefined);assert.equal(published.receipt.readbackError,undefined);assert.equal(published.stage,'published');assert.equal(published.localReleased,true);
});
