import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {profiles} from '../scripts/site-config.mjs';
import {createCloudQueue,cloudJobId} from '../scripts/cloud-queue.mjs';
import {recordMarkdown} from '../scripts/editorial-record.mjs';
import {protectPrivateFile} from '../scripts/private-file.mjs';

const site={...profiles.find(value=>value.id==='scholay-today'),languages:['zh-CN','en']};
const documentId='0b0c1d2e-3f40-4a51-8b62-73849a5b6c7d',articleId='record-'+documentId;
const ownerId='91e52c25-5d3b-4911-9b24-769157a52079',link='https://example.org/project';
const hash=value=>createHash('sha256').update(value).digest('hex');
const asset=()=>{const bytes=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.from('one')]);return {path:'/article-media/'+hash(bytes)+'.png',data:bytes.toString('base64')};};
const duplicate={error:'该资源链接已有记录，请更新已有记录，不要新建',code:'duplicate_source',existing:{documentId:ownerId,articleId:'record-'+ownerId,path:'/open-source/existing/'}};

async function fixture(t,{post=()=>Response.json(duplicate,{status:409}),lookup=()=>Response.json({error:'missing'},{status:404}),owners=[{key:'openSource:'+link,documentId:ownerId}]}={}){
 const root=await mkdtemp(join(tmpdir(),'cloud-duplicate-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const tokenFile=join(root,'token');await writeFile(tokenFile,'DUPLICATE_TOKEN',{mode:0o600});await protectPrivateFile(tokenFile);
 const fields={title:'结构化记录',summary:'完整项目介绍。'.repeat(800),date:'2020-01-01',category:site.sourceCategories[0],value:'保留完整价值与限制。',url:link,relatedUrl:'https://example.org/source',status:'公开收录'};
 const data={id:articleId,title:fields.title,summary:'客户端短摘要。',markdown:recordMarkdown('openSource',fields),date:'2020-01-01',category:'客户端栏目',author:'原客户端作者',assets:[asset()],record:{documentId,kind:'openSource',fields}};
 const packet={siteId:site.id,spaceId:site.spaceId,origin:site.origin,intent:'publish',requestKey:'duplicate-link-original-request',expectedVersion:0,expectedPublishedVersion:null,sourceSha256:'a'.repeat(64),data};
 const calls={post:0,lookup:0,catalog:0};let time=1000000;
 const fetcher=async(url,options={})=>{
  const path=new URL(url).pathname;
  if(path==='/manage/api/site')return Response.json({protocol:'scholay-content',version:1,siteId:site.id,origin:site.origin});
  if(options.method==='POST'){calls.post++;return post();}
  if(path==='/manage/api/news/catalog'){calls.catalog++;return Response.json({items:owners,next:null});}
  if(path.includes('/requests/')){calls.lookup++;return lookup();}
  throw Error('Unexpected fake website route '+path);
 };
 const directory=join(root,'queue'),config={directory,sites:[{site,tokenFile}],fetcher,now:()=>time},queue=createCloudQueue(config),accepted=await queue.enqueue(site.id,packet);
 return {queue,config,accepted,packet,calls,directory,state:async()=>JSON.parse(await readFile(join(directory,'jobs',accepted.jobId,'state.json'),'utf8')),advance:()=>time+=300000};
}

test('a duplicate_source answer rejects the job after one send and never retries',async t=>{
 const f=await fixture(t);
 for(let i=0;i<4;i++){f.advance();await createCloudQueue(f.config).tick();}
 assert.equal(f.calls.post,1);
 const state=await f.state();
 assert.equal(state.status,'rejected');assert.equal(state.duplicateOf,'record-'+ownerId);assert.match(state.error,/update that record/);
 const view=await f.queue.get(site.id,f.accepted.jobId);assert.equal(view.status,'rejected');assert.equal(view.duplicateOf,'record-'+ownerId);
});

async function stuck(f){
 // The shape the production jobs had: three sends that failed with a server error.
 for(let i=0;i<4;i++){f.advance();await createCloudQueue(f.config).tick();}
 assert.equal((await f.state()).status,'needs_review');
}
const serverError=()=>Response.json({error:'unavailable'},{status:500});

test('closing a held job needs the website to have no such request and another record to own the link',async t=>{
 const f=await fixture(t,{post:serverError});await stuck(f);
 assert.equal(f.calls.post,3);
 const closed=await f.queue.close(site.id,f.accepted.jobId,{reason:'duplicate_source'});
 assert.equal(closed.status,'rejected');assert.equal(closed.duplicateOf,'record-'+ownerId);
 const state=await f.state();assert.equal(state.closedReason,'duplicate_source');assert.ok(state.closedAt);
 assert.equal(JSON.parse(await readFile(join(f.directory,'jobs',f.accepted.jobId,'packet.json'),'utf8')).requestKey,f.packet.requestKey);
 assert.equal(f.calls.post,3);
 assert.equal((await f.queue.close(site.id,f.accepted.jobId,{reason:'duplicate_source'})).status,'rejected');
});

test('closing refuses when the website already has the request, when no record owns the link, or for an unknown reason',async t=>{
 const held=await fixture(t,{post:serverError});await stuck(held);
 // The website now answers the original request lookup: the job must be verified, never closed.
 const accepted=url=>new URL(url).pathname==='/manage/api/site'?Response.json({protocol:'scholay-content',version:1,siteId:site.id,origin:site.origin}):Response.json({revision:1});
 await assert.rejects(createCloudQueue({...held.config,fetcher:async url=>accepted(url)}).close(site.id,held.accepted.jobId,{reason:'duplicate_source'}),/already has this request/);
 assert.equal((await held.state()).status,'needs_review');
 const unowned=await fixture(t,{post:serverError,owners:[]});await stuck(unowned);
 await assert.rejects(unowned.queue.close(site.id,unowned.accepted.jobId,{reason:'duplicate_source'}),/No other record owns this link/);
 assert.equal((await unowned.state()).status,'needs_review');
 await assert.rejects(unowned.queue.close(site.id,unowned.accepted.jobId,{reason:'other'}),/closing reason/);
});

test('only an unsent held open-source job can be closed',async t=>{
 const f=await fixture(t);
 await assert.rejects(f.queue.close(site.id,f.accepted.jobId,{reason:'duplicate_source'}),/Only an unsent open-source record held for review/);
 assert.equal(cloudJobId(site.id,f.packet.requestKey),f.accepted.jobId);
});
