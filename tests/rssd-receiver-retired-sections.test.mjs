import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ReceiverStore} from '../receiver/store.mjs';
import {contentKey} from '../contracts/rssd-publication.cjs';

const site={id:'demo',spaceId:'research',sections:[{id:'methods',name:'Methods'}]};
const packet={version:1,requestId:'english-request',siteId:'demo',workspaceId:'research',sectionId:'archive',workId:'imported-work',locale:'en',revision:1,
 contentHash:'a'.repeat(64),route:'/en/news/imported/',content:{locale:'en',title:'English edition',bodyMarkdown:'Complete English body.'}};
async function fixture(t,kind='news',data={id:'original',title:'Original',markdown:'Original body.'}){
 const dir=await mkdtemp(join(tmpdir(),'rssd-retired-')),store=new ReceiverStore(join(dir,'receiver.sqlite'),site);
 t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
 const baseline={rssdIdentity:{[contentKey({workId:packet.workId,locale:'zh-CN'})]:{kind,id:'original',documentId:'original-document',route:'/news/original/',revision:1,...(kind==='openSource'?{url:data.url}:{})}},
  news:kind==='news'?[data]:[],data:{year:kind==='year'?[data]:[],history:kind==='history'?[data]:[]},openSource:{items:kind==='openSource'?[data]:[]}};
 store.seedLegacyHeads(baseline);return {store,baseline};
}
test('English continuation of a known migrated work retains its retired section and idempotent receipt',async t=>{
 const {store,baseline}=await fixture(t);
 assert.equal(store.accept(packet).state,'queued');
 assert.equal(store.accept(packet).requestId,packet.requestId);
 store.seedLegacyHeads(baseline);
 assert.equal(store.receipt(packet.requestId).state,'queued');
 assert.deepEqual(site.sections.map(s=>s.id),['methods']);
});
test('legacy identity cannot authorize another work, section, workspace, or Chinese write',async t=>{
 const {store}=await fixture(t);
 for(const change of [{workId:'unrelated'},{sectionId:'invented'},{locale:'zh-CN',content:{...packet.content,locale:'zh-CN'}}])
  assert.throws(()=>store.accept({...packet,...change}),/Unknown site section/);
 assert.throws(()=>store.accept({...packet,workspaceId:'another'}),{status:403});
 assert.equal(store.status().requests.length,0);
});
test('retired section comes from the exact baseline record using the migration rules',async t=>{
 for(const [kind,data,sectionId] of [
  ['news',{id:'original',sectionId:'old-column'},'old-column'],
  ['year',{id:'original'},'calendar'],
  ['history',{id:'original'},'history'],
  ['openSource',{id:'original',url:'https://example.test/project'},'open-source']
 ]){
  const {store}=await fixture(t,kind,data);
  assert.throws(()=>store.accept({...packet,sectionId:'archive'}),/Unknown site section/);
  assert.equal(store.accept({...packet,sectionId}).state,'queued');
 }
});
test('an incomplete identity map and an active source column cannot invent a retired section',async t=>{
 const active=await fixture(t,'news',{id:'original',category:'Methods'});
 assert.throws(()=>active.store.accept(packet),/Unknown site section/);
 const missing=await fixture(t,'news',{id:'different'});
 assert.throws(()=>missing.store.accept(packet),/Unknown site section/);
 const english=await fixture(t,'news',{id:'original',locale:'en'});
 assert.throws(()=>english.store.accept(packet),/Unknown site section/);
});
