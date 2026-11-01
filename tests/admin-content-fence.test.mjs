import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request as httpRequest} from 'node:http';
import {createHmac,randomUUID} from 'node:crypto';
import {createApp,secret} from '../admin/server.mjs';
import {digest} from '../admin/model.mjs';
import {SITE} from '../scripts/site-config.mjs';
import {createContentWriteFence} from '../admin/content-write-fence.mjs';

const origin='https://today.scholay.com';
const news={id:'fence-original',title:'Original',summary:'Summary',markdown:'# Original\n\nFull body.',date:'2026-11-01',author:'Synthetic author',category:'新闻聚合',assets:[]};
async function fixture(t,{community=false,marker}={}){
  const root=await mkdtemp(join(tmpdir(),'rssd-legacy-fence-')),dbPath=join(root,'admin.sqlite');
  const communityRoot=join(root,'community'),webRoot=join(root,'web'),webhookSecret='synthetic-community-signature-secret';
  const previous={root:process.env.SCHOLAY_COMMUNITY_LINKS_ROOT,secret:process.env.SCHOLAY_COMMUNITY_WEBHOOK_SECRET};
  if(community){
    await mkdir(communityRoot);await mkdir(join(webRoot,'news/source'),{recursive:true});await writeFile(join(webRoot,'news/source/index.html'),'Published source');
    await writeFile(join(communityRoot,'config.json'),JSON.stringify({mode:'pilot',sources:[origin+'/news/source/'],authors:['Synthetic'],sites:[{id:SITE.id,origin,webRoot}]}));
    process.env.SCHOLAY_COMMUNITY_LINKS_ROOT=communityRoot;process.env.SCHOLAY_COMMUNITY_WEBHOOK_SECRET=webhookSecret;
  }
  let app;
  try{app=await createApp({dbPath,origin,guestbookEnabled:true,contentFencePath:marker});}
  finally{
    for(const [key,value] of [['SCHOLAY_COMMUNITY_LINKS_ROOT',previous.root],['SCHOLAY_COMMUNITY_WEBHOOK_SECRET',previous.secret]])if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
  await app.listen({host:'127.0.0.1',port:0});const base='http://127.0.0.1:'+app.server.address().port;
  t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});
  const session=secret(),csrf=secret(),now=Date.now();
  app.db.prepare('INSERT INTO users VALUES(?,?,?,?)').run('test-owner','owner','unused-test-password',now);
  app.db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?,?)').run(digest(session),'test-owner',csrf,now,now,'127.0.0.1','fixture');
  const headers={origin,cookie:'__Secure-scholay-session='+session,'x-csrf-token':csrf,'content-type':'application/json'};
  const call=(path,{method='GET',data,headers:extra={}}={})=>fetch(base+path,{method,headers:{...headers,...extra},...(data===undefined?{}:{body:JSON.stringify(data)})});
  const fence=marker||dbPath+'.rssd-readonly';
  const freeze=async(value={version:1,siteId:SITE.id,readOnly:true})=>{await writeFile(fence+'.tmp',JSON.stringify(value));await rename(fence+'.tmp',fence);};
  return {root,dbPath,base,app,call,headers,fence,freeze,webhookSecret};
}
const totals=app=>Object.fromEntries(['documents','revisions','jobs','site_jobs','content_requests','content_drafts','content_actions','source_archives','document_tombstones'].map(table=>[table,app.db.prepare('SELECT count(*) AS n FROM '+table).get().n]));

test('a dynamic legacy content fence rejects every mutation entrypoint and preserves authenticated reads',async t=>{
  const f=await fixture(t);
  const created=await f.call('/manage/api/documents',{method:'POST',data:{kind:'news',data:news}});assert.equal(created.status,200);const doc=await created.json();
  assert.equal((await(await f.call('/manage/api/content-write-status')).json()).readOnly,false);
  const before=totals(f.app);await f.freeze();
  assert.deepEqual(await(await f.call('/manage/api/content-write-status')).json(),{siteId:SITE.id,readOnly:true,state:'read_only',inFlight:0});
  const mutations=[
    ['POST','/manage/api/documents'],['PUT','/manage/api/documents/'+doc.id],
    ...['review','restore','queue'].map(action=>['POST','/manage/api/documents/'+doc.id+'/'+action]),
    ['POST','/manage/api/import'],['POST','/manage/api/worker/claim'],['POST','/manage/api/worker/jobs/example/finish'],
    ['POST','/manage/api/jobs/example/cancel'],['POST','/manage/api/jobs/example/retry'],
    ['POST','/manage/api/news/drafts'],['POST','/manage/api/news/publish'],['POST','/manage/api/news/requests/example/retry'],
    ['POST','/manage/api/news/source-archives'],['POST','/manage/api/news/actions']
  ];
  for(const [method,path] of mutations){const response=await f.call(path,{method,data:{action:'delete'}});assert.equal(response.status,409,path);assert.equal((await response.json()).code,'legacy_content_read_only',path);}
  assert.deepEqual(totals(f.app),before);
  for(const path of ['/manage/health','/manage/api/session','/manage/api/status','/manage/api/documents','/manage/api/documents/'+doc.id,'/manage/api/jobs','/manage/api/news/catalog?scope=all','/manage/api/labels'])assert.equal((await f.call(path)).status,200,path);
  assert.equal((await f.call('/manage/api/tokens',{method:'POST',data:{name:'Synthetic draft credential'}})).status,200,'credential administration remains available');
  await rm(f.fence);
  const updated=await f.call('/manage/api/documents/'+doc.id,{method:'PUT',data:{version:1,data:{...news,title:'After unfreeze'}}});assert.equal(updated.status,200);assert.equal((await updated.json()).latest_revision,2);
});

test('a request whose body started before the freeze is rejected before its content handler runs',async t=>{
  const f=await fixture(t),payload=JSON.stringify({kind:'news',data:news}),before=totals(f.app);
  let request;
  const result=new Promise((resolve,reject)=>{
    request=httpRequest(f.base+'/manage/api/documents',{method:'POST',headers:{...f.headers,'transfer-encoding':'chunked'}},response=>{
      let text='';response.setEncoding('utf8');response.on('data',chunk=>text+=chunk);response.on('end',()=>resolve({status:response.statusCode,body:JSON.parse(text)}));
    });request.on('error',reject);request.write(payload.slice(0,12));
  });
  for(let i=0;i<100;i++){if((await(await f.call('/manage/api/content-write-status')).json()).inFlight===1)break;await new Promise(resolve=>setTimeout(resolve,5));}
  assert.equal((await(await f.call('/manage/api/content-write-status')).json()).inFlight,1);
  await f.freeze();request.end(payload.slice(12));
  assert.deepEqual(await result,{status:409,body:{error:'旧内容写入已暂停，请保留原请求并通过 RSSD 中心提交。',code:'legacy_content_read_only'}});
  assert.deepEqual(totals(f.app),before);assert.equal((await(await f.call('/manage/api/content-write-status')).json()).inFlight,0);
});

test('frozen content does not interrupt visitor messages, moderation or the signed Discourse webhook',async t=>{
  const f=await fixture(t,{community:true});await f.freeze();
  const session=await f.call('/guestbook/api/session'),guest=await session.json(),form=guest.config.forms[0];
  const submitted=await f.call('/guestbook/api/messages',{method:'POST',headers:{cookie:session.headers.get('set-cookie').split(';')[0],'x-guestbook-csrf':guest.csrf},data:{kind:form.id,name:'Synthetic visitor',message:'Public message',contact:'',details:Object.fromEntries(form.fields.map(field=>[field.key,'Synthetic detail'])),requestKey:randomUUID()}});
  assert.equal(submitted.status,201);const message=await submitted.json();
  assert.equal((await f.call('/manage/api/guestbook/'+message.id+'/review',{method:'POST',data:{status:'approved'}})).status,200);
  assert.equal((await(await f.call('/guestbook/api/messages')).json()).messages.length,1);
  const raw=JSON.stringify({post:{topic_id:415123,post_number:1,username:'Synthetic',cooked:'<hr><small>这是一个从 <a href="'+origin+'/news/source/">原文</a> 下的原始话题分离的讨论话题</small>'}});
  const response=await fetch(f.base+'/manage/api/community/discourse',{method:'POST',headers:{'content-type':'application/json','x-discourse-event-signature':'sha256='+createHmac('sha256',f.webhookSecret).update(raw).digest('hex'),'x-discourse-event-id':'fence-test-event','x-discourse-event':'post_created','x-discourse-instance':'https://enterscholar.com'},body:raw});
  assert.equal(response.status,200);assert.equal((await response.json()).status,'linked');
  assert.equal(totals(f.app).documents,0);
});

test('markers are database-scoped, fail closed when invalid, and custom locations must be absolute',async t=>{
  const first=await fixture(t),second=await fixture(t);await first.freeze();
  assert.equal((await(await second.call('/manage/api/content-write-status')).json()).readOnly,false);
  assert.equal((await second.call('/manage/api/documents',{method:'POST',data:{kind:'news',data:news}})).status,200);
  await first.freeze({version:1,siteId:'different-site',readOnly:true});
  assert.equal((await(await first.call('/manage/api/content-write-status')).json()).state,'invalid_marker');
  assert.equal((await first.call('/manage/api/documents',{method:'POST',data:{kind:'news',data:news}})).status,409);
  await writeFile(first.fence,'PRIVATE_MARKER_SENTINEL invalid JSON');
  const blocked=await first.call('/manage/api/documents',{method:'POST',data:{kind:'news',data:news}});assert.equal(blocked.status,409);assert(!(await blocked.text()).includes('PRIVATE_MARKER_SENTINEL'));
  assert.throws(()=>createContentWriteFence({dbPath:first.dbPath,siteId:SITE.id,path:'relative-marker.json'}),/absolute path/);
});
