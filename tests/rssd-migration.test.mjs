import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../admin/store.mjs';
import {exportLegacySite} from '../scripts/rssd-migrate-site.mjs';
import {profiles} from '../scripts/site-config.mjs';
import {sourceContentSha256} from '../contracts/language-editions.mjs';
import {snapshotForPackets} from '../receiver/build.mjs';
import {ReceiverStore} from '../receiver/store.mjs';
import p from '../contracts/rssd-v1.cjs';
import {contentKey,publication} from '../contracts/rssd-publication.cjs';

test('migration retains original revisions, explicit bilingual links, deleted records and unpublished drafts',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'rssd-migration-'));let store;t.after(async()=>{store?.close();await rm(directory,{recursive:true,force:true});});
 const database=join(directory,'legacy.sqlite'),db=openStore(database),time=Date.parse('2026-01-01');
 const zh={id:'original-article',title:'Same title',summary:'Summary',markdown:'Original body',date:'2026-01-01',author:'Synthetic author',sectionId:'statistics',assets:[]};
 const insert=(id,kind,items,published,route)=>{
  db.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?)').run(id,kind,kind+':'+items[0].id,route,items.length,null,published,'draft',time);
  items.forEach((item,i)=>db.prepare('INSERT INTO revisions VALUES(?,?,?,?,?,?)').run(id,i+1,JSON.stringify(item),'fixture','Original note',time+i));
 };
 insert('doc-original','news',[zh,{...zh,markdown:'Unpublished revision'}],1,'/news/original-article/');
 insert('doc-english','news',[{...zh,id:'english-article',locale:'en',markdown:'English full body',translationOf:{articleId:zh.id,revision:1,sha256:sourceContentSha256(zh)}}],1,'/en/news/original-article/');
 insert('doc-unrelated','news',[{...zh,id:'unrelated-article',markdown:'Different work with the same title'}],null,'/news/unrelated-article/');
 insert('doc-deleted','news',[{...zh,id:'deleted-article'}],null,'/news/deleted-article/');db.prepare('INSERT INTO document_tombstones VALUES(?,?,?)').run('doc-deleted',time,'owner');
 db.prepare('INSERT INTO source_archives VALUES(?,?,?,?,?,?)').run('source-1','owner','doc-original',1,Buffer.from('Private source evidence'),time);
 db.prepare('INSERT INTO content_requests VALUES(?,?,?,?,?,?,?)').run('original-request','owner','original-hash','doc-original',1,'job-1',time);
 db.close();
 const output=join(directory,'export'),result=await exportLegacySite({database,site:profiles.find(s=>s.id==='metho'),output});
 assert.deepEqual(result.counts,{documents:4,revisions:5,published:2,deleted:1,media:0});
 const [original,english,unrelated]=['doc-original','doc-english','doc-unrelated'].map(id=>result.documents.find(d=>d.documentId===id));
 assert.equal(original.workId,english.workId);assert.notEqual(original.workId,unrelated.workId);
 const body=JSON.parse(await readFile(join(output,original.path),'utf8'));assert.equal(body.editions[1].payload.bodyMarkdown,'Unpublished revision');assert.equal(body.source.requests[0].key,'original-request');assert.equal(Buffer.from(body.source.sourceArchives[0].payload,'base64').toString(),'Private source evidence');
 assert.equal(body.sourceHash,p.hash(body.source));
 const baseline=JSON.parse(await readFile(join(output,'baseline.json'),'utf8'));assert.equal(baseline.news.length,2);assert.equal(baseline.news.find(x=>x.id===zh.id).markdown,'Original body');
 store=new ReceiverStore(join(directory,'receiver.sqlite'),{id:'metho',spaceId:result.site.spaceId,sections:[{id:'statistics'}]});store.seedLegacyHeads(baseline);
 const packet={version:1,requestId:'new-request',siteId:'metho',workspaceId:result.site.spaceId,sectionId:'statistics',workId:original.workId,locale:'zh-CN',revision:3,contentHash:'a'.repeat(64),route:'/news/original-article/',content:{locale:'zh-CN',title:'Edited title',bodyMarkdown:'Center update',metadata:{date:'2026-01-02'}}};
 assert.throws(()=>store.accept({...packet,workId:'wrong-work'}),{code:'route_conflict'});
 store.accept(packet);const updated=snapshotForPackets([publication(packet)],{...result.site,sections:[{id:'statistics',name:'Statistics'}]},baseline);assert.equal(updated.news.length,2);assert.equal(updated.news.find(x=>x.id===zh.id).markdown,'Center update');
});

test('structured calendar updates retain their native collection, fields and original route',()=>{
 const workId='legacy-calendar',key=contentKey({workId,locale:'zh-CN'}),record={kind:'year',fields:{id:'year:original',category:'Deadline',tags:['Research'],start:'2026-11-01',end:'2026-11-02',sourceName:'Fixture',sourceUrl:'https://example.org',dateBasis:'Announcement',privateSecret:'must not ship'}};
 const input={version:1,requestId:'calendar-update',siteId:'metho',workspaceId:'metho',sectionId:'calendar',workId,locale:'zh-CN',revision:2,contentHash:'a'.repeat(64),route:'/calendar/original/',content:{locale:'zh-CN',title:'Updated deadline',bodyMarkdown:'# Updated deadline\n\n## 摘要\n\nUpdated summary\n\n## 正文\n\nComplete details',metadata:{date:'2026-11-01',record}}};
 const packet=publication(input);assert.equal(packet.content.metadata.record.fields.privateSecret,undefined);
 const baseline={news:[],data:{year:[{...record.fields,title:'Previous',summary:'Old',body:'Old body'}],history:[]},openSource:{items:[]},permalinks:{'year:year:original':input.route},editorialRecords:[{documentId:'original-doc',kind:'year',key:'year:year:original'}],rssdIdentity:{[key]:{kind:'year',id:'year:original',documentId:'original-doc',key:'year:year:original'}}};
 const updated=snapshotForPackets([packet],{sections:[{id:'calendar',name:'Calendar'}],columns:['a','b'],author:'Fixture'},baseline);
 assert.equal(updated.news.length,0);assert.equal(updated.data.year.length,1);assert.equal(updated.data.year[0].body,'Complete details');assert.equal(updated.data.year[0].start,'2026-11-01');assert.equal(updated.editorialRecords[0].documentId,'original-doc');
 assert.throws(()=>publication({...input,content:{...input.content,bodyMarkdown:'Unstructured rewrite that would discard dates'}}),/heading/);
});
