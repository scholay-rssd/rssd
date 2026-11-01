import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ReceiverStore} from '../receiver/store.mjs';
import p from '../contracts/rssd-v1.cjs';
import {publication,contentKey} from '../contracts/rssd-publication.cjs';
import {profiles} from '../scripts/site-config.mjs';
import {sectionsForSite} from '../contracts/site-sections.mjs';
const site={...profiles.find(s=>s.id==='scholay-today')};site.sections=sectionsForSite(site);
const packet={version:1,requestId:'qa',siteId:site.id,workspaceId:site.spaceId,sectionId:'briefings',workId:'qa-work',locale:'zh-CN',revision:1,contentHash:'a'.repeat(64),route:'/news/qa/',content:{locale:'zh-CN',title:'有效标题',summary:'有效摘要',bodyMarkdown:'完整正文',metadata:{date:'2026-10-31'}}};
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'rssd-academic-preflight-'));t.after(()=>rm(dir,{recursive:true,force:true}));return join(dir,'state.sqlite');}
test('old accepted failed/queued request replay is returned before new field guard',async t=>{
 const file=await fixture(t),store=new ReceiverStore(file,site),value={...packet,content:{...packet.content,summary:''}},failed={...value,requestId:'qa-failed',workId:'qa-failed',route:'/news/qa-failed/'};t.after(()=>store.close());
 // Rows accepted by an earlier version must keep their v1 packet hash and receipt.
 for(const [item,state] of [[value,'failed'],[failed,'queued']]){const canonical=publication(item);store.db.prepare('INSERT INTO requests(id,hash,work_key,revision,payload,state,created,operation_sequence) VALUES(?,?,?,?,?,?,?,?)').run(item.requestId,p.hash(canonical),contentKey(canonical),item.revision,JSON.stringify(canonical),state,1,1);}
 assert.equal(store.accept(value).state,'failed');assert.equal(store.accept(failed).state,'queued');
 assert.throws(()=>store.accept({...value,content:{...value.content,summary:'changed'}}),{code:'request_conflict'});
 assert.throws(()=>store.accept({...value,requestId:'new-id'}),{code:'invalid_academic_news'});
 assert.equal(store.status().requests.reduce((a,x)=>a+x.count,0),2);
});
test('new invalid academic ordinary-news fields are rejected before any head or request',async t=>{
 const file=await fixture(t),store=new ReceiverStore(file,site);t.after(()=>store.close());
 for(const content of [{summary:''},{summary:'   '},{title:'x'.repeat(501)},{summary:'x'.repeat(4001)},{bodyMarkdown:'x'.repeat(160001)},{metadata:{date:'2026-02-30'}},{metadata:{author:'a'.repeat(101)}},{metadata:{category:'b'.repeat(81)}}]){
  const input={...packet,content:{...packet.content,...content}};assert.throws(()=>store.accept(input),{code:'invalid_academic_news'});
 }
 assert.throws(()=>store.accept({...packet,route:'/news/bad_slug/'}),{code:'invalid_academic_news'});assert.throws(()=>store.accept({...packet,route:'/news/nested/wrong/'}),{code:'invalid_academic_news'});
 assert.equal(store.status().requests.length,0);assert.throws(()=>store.head(packet.workId,packet.locale),{code:'not_found'});
 assert.equal(store.accept(packet).state,'queued');
});
test('English and structured Chinese preserve optional summary and hidden operations remain allowed',async t=>{
 const file=await fixture(t),store=new ReceiverStore(file,site);t.after(()=>store.close());
 const english={...packet,requestId:'en',locale:'en',route:'/en/news/qa/',content:{...packet.content,locale:'en',summary:''}};assert.equal(store.accept(english).state,'queued');
 const record={...packet,requestId:'record',workId:'record',sectionId:'calendar',route:'/calendar/record/',content:{locale:'zh-CN',title:'日程',summary:'',bodyMarkdown:'# 日程\n\n## 摘要\n\n摘要\n\n## 正文\n\n正文',metadata:{record:{kind:'year',fields:{category:'学术会议',tags:[],start:'2026-10-31',sourceName:'Fixture',sourceUrl:'https://example.org'}}}}};assert.equal(store.accept(record).state,'queued');
 const chinese=store.accept(packet);assert.equal(chinese.state,'queued');
 const withdraw={...packet,requestId:'withdraw',operation:'withdraw',operationSequence:2,expectedOperationSequence:1,expectedRevision:1};delete withdraw.content;assert.equal(store.accept(withdraw).state,'queued');
});

test('exact academic field boundaries persist without truncation',async t=>{
 const file=await fixture(t),store=new ReceiverStore(file,site);t.after(()=>store.close());
 const content={...packet.content,title:'t'.repeat(500),summary:'s'.repeat(4000),bodyMarkdown:'b'.repeat(160000),metadata:{author:'a'.repeat(100),category:'c'.repeat(80),date:'2026-12-31'}};
 assert.equal(store.accept({...packet,content}).state,'queued');
 const stored=JSON.parse(store.db.prepare('SELECT payload FROM requests WHERE id=?').get(packet.requestId).payload).content;
 for(const key of ['title','summary','bodyMarkdown'])assert.equal(stored[key],content[key]);
 assert.equal(stored.metadata.author,content.metadata.author);assert.equal(stored.metadata.category,content.metadata.category);
});

test('field checks agree with academic renderer validation for ordinary Chinese text',async()=>{
 const {preflightAcademicNews}=await import('../receiver/academic-preflight.mjs');
 const {validateNews}=await import('../admin/news.mjs');
 const {publication}=await import('../contracts/rssd-publication.cjs');
 const cases=[{}, {summary:''}, {title:'x'.repeat(501)}, {summary:'x'.repeat(4001)}, {bodyMarkdown:'x'.repeat(160001)}, {metadata:{author:'x'.repeat(101),date:'2026-10-31'}}, {metadata:{date:'2026-02-30'}}, {metadata:{category:'x'.repeat(81),date:'2026-10-31'}}];
 for(const changes of cases){
  const content={...packet.content,...changes},value=publication({...packet,content});
  const data={id:'rssd-12345',title:value.content.title,summary:value.content.summary,markdown:value.content.bodyMarkdown,author:value.content.metadata.author||site.author,category:value.content.metadata.category||site.sections[0].name,date:value.content.metadata.date||'1970-01-01',assets:[],sectionId:'briefings'};
  let rendered=true,preflight=true;try{validateNews(data,null,site);}catch{rendered=false;}try{preflightAcademicNews(value,site);}catch{preflight=false;}
  assert.equal(preflight,rendered,JSON.stringify(Object.keys(changes)));
 }
});
