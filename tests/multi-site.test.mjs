import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {profiles,validateOrigin,publicationDirectory} from '../scripts/site-config.mjs';
import {registry,spaceContext,selectSpace,importSite} from '../scripts/space-registry.mjs';
import {createWebsitePublisher} from '../scripts/website-publication.mjs';
test('spaces preserve academic paths and isolate workspaces, subscriptions and publication files',async t=>{
 const data=await mkdtemp(join(tmpdir(),'site-spaces-'));t.after(()=>rm(data,{recursive:true,force:true}));
 await writeFile(join(data,'editorial-workspace.json'),JSON.stringify({path:join(data,'original-editorial')}));
 const legacy=spaceContext(data);assert.equal(legacy.workspaceRoot,join(data,'original-editorial'));assert.equal(legacy.stateDirectory,data);
 const first=importSite(data,profiles.find(s=>s.spaceId==='lingxi')),second=importSite(data,profiles.find(s=>s.spaceId==='pets'));assert.notEqual(first.workspaceRoot,second.workspaceRoot);assert.notEqual(first.stateDirectory,second.stateDirectory);
 assert.equal(publicationDirectory(legacy.workspaceRoot),join(legacy.workspaceRoot,'.local/today'));
 assert.equal(publicationDirectory(first.workspaceRoot),join(first.workspaceRoot,'.local/sites/lingxi'));
 const before=await readFile(join(first.workspaceRoot,'_ops/inventory/article-index.json'),'utf8');selectSpace(data,'pets');selectSpace(data,'academic');assert.equal(await readFile(join(first.workspaceRoot,'_ops/inventory/article-index.json'),'utf8'),before);
 assert.throws(()=>importSite(data,{...profiles[1],origin:'https://elsewhere.example'}),/已存在/);
 assert.throws(()=>validateOrigin('https://example.com/path'),/HTTPS/);assert.throws(()=>validateOrigin('http://example.com'),/HTTPS/);
});
test('a mismatched site descriptor stops the publisher before sending credentials',async t=>{
 const data=await mkdtemp(join(tmpdir(),'site-handshake-'));t.after(()=>rm(data,{recursive:true,force:true}));const ctx=importSite(data,profiles.find(s=>s.spaceId==='pets')),calls=[];
 const client=createWebsitePublisher({root:ctx.workspaceRoot,fetcher:async(url,options)=>{calls.push(options);return Response.json({protocol:'scholay-content',version:1,siteId:'wrong-site',origin:ctx.site.origin});}});
 await assert.rejects(client.catalog(),/身份/);assert.equal(calls.length,1);assert.equal(calls[0].headers,undefined);
});
for(const site of profiles.slice(1))test(`${site.id}: independent seed, public build, protocol and default retention`,async t=>{
 const data=await mkdtemp(join(tmpdir(),'site-roundtrip-'));t.after(()=>rm(data,{recursive:true,force:true}));const context=importSite(data,site);const seedCount=JSON.parse(await readFile(new URL('../sites/seeds/'+site.id+'.json',import.meta.url),'utf8')).length;
 const result=spawnSync(process.execPath,['--input-type=module','-'],{cwd:process.cwd(),encoding:'utf8',env:{...process.env,SCHOLAY_SITE_CONFIG:context.configFile,SCHOLAY_SITE_ID:site.id,SCHOLAY_SITE_JSON:JSON.stringify(site),SCHOLAY_EDITORIAL_ROOT:context.workspaceRoot,SCHOLAY_ADMIN_DB:join(data,'admin.sqlite'),MULTI_SITE_TEST_ROOT:data},input:`
 import assert from 'node:assert/strict';import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';import {join} from 'node:path';
 import {seedSite} from './scripts/seed-site.mjs';import {SITE} from './scripts/site-config.mjs';import {openStore,claim,finish,snapshot} from './admin/store.mjs';import {buildRelease} from './admin/worker.mjs';import {createApp,secret} from './admin/server.mjs';import {digest} from './admin/model.mjs';import {createWebsitePublisher} from './scripts/website-publication.mjs';import {createDraft} from './scripts/editorial-workspace.mjs';import {verifyWebsite} from './desktop/scripts/runtime/verify-website.mjs';
 const first=await seedSite(SITE);assert.equal(first.created,${seedCount});assert.equal((await seedSite(SITE)).created,0);
 const db=openStore(process.env.SCHOLAY_ADMIN_DB),job=claim(db)||{id:'empty-preview',snapshot:snapshot(db),snapshot_hash:'empty-preview'},target=join(process.env.MULTI_SITE_TEST_ROOT,'public');
 const source=join(process.env.MULTI_SITE_TEST_ROOT,'source');await mkdir(source,{recursive:true});await cp('sites',join(source,'sites'),{recursive:true});await mkdir(join(source,'web/themes'),{recursive:true});await cp('web/themes/content.css',join(source,'web/themes/content.css'));
 if(['portfolio','personal'].includes(SITE.themeId)){const {byteHash}=await import('./web/engine/theme-homepage.mjs');const root=join(source,'theme-homepages',SITE.themeId);await mkdir(join(root,'public'),{recursive:true});const html='<h1>Existing homepage</h1>';await writeFile(join(root,'public/index.html'),html);const files={'index.html':byteHash(html)};if(SITE.id==='personal')for(const slug of ['rimes','scholay-today','scholay','skills','scholay-wiki']){const p='projects/'+slug+'/index.html';await mkdir(join(root,'public/projects',slug),{recursive:true});await writeFile(join(root,'public',p),html);files[p]=byteHash(html);}await writeFile(join(root,'manifest.json'),JSON.stringify({version:1,siteId:SITE.id,origin:SITE.origin,themeId:SITE.themeId,files}));}
 const manifest=await buildRelease({job,target,source});assert.equal(manifest.siteId,SITE.id);assert.equal(manifest.counts.records,${seedCount});
 for(const file of ['journal/index.html','archive/index.html','calendar/index.html','sitemap-content.xml']){const html=await readFile(join(target,file),'utf8');assert(!html.includes('https://today.scholay.com'));}
 if(first.jobId)finish(db,job.id,{ok:true,hash:job.snapshot_hash,release:manifest.release});db.close();
 const app=await createApp({dbPath:process.env.SCHOLAY_ADMIN_DB});const token=secret();app.db.prepare('INSERT INTO tokens(id,name,hash,scope,created) VALUES(?,?,?,?,?)').run('test-token','test',digest(token),'editorial_publish',Date.now());
 let publicRoot=target;const fetcher=async(url,options={})=>{if(!new URL(url).pathname.startsWith('/manage/'))return new Response(await readFile(join(publicRoot,new URL(url).pathname,'index.html'),'utf8'));const res=await app.inject({method:options.method||'GET',url:new URL(url).pathname+new URL(url).search,headers:options.headers,payload:options.body});return new Response(res.body,{status:res.statusCode,headers:res.headers});};
 assert((await verifyWebsite(token,fetcher)).connected);const catalog=await fetcher(SITE.origin+'/manage/api/news/catalog?scope=all',{headers:{Authorization:'Bearer '+token,'X-Scholay-Site':SITE.id}});assert.equal((await catalog.json()).items.length,${seedCount});
 const bad=await fetcher(SITE.origin+'/manage/api/news/catalog?scope=all',{headers:{Authorization:'Bearer '+token,'X-Scholay-Site':'wrong'}});assert.equal(bad.status,409);
 process.env.SCHOLAY_TODAY_TOKEN=token;const client=createWebsitePublisher({fetcher});await createDraft({id:'new-local-post',title:'空间文章',column:SITE.columns[1],archiveCategory:SITE.columns[1],markdown:'# 空间文章\\n\\n只属于这个空间。'});
 const packet=await client.prepare('new-local-post',{intent:'draft',releaseLocal:false,metadata:{date:'2026-10-13',summary:'独立空间的测试摘要',author:SITE.author,category:SITE.columns[1]}});assert.equal(packet.stage,'prepared');await client.saveCloud('new-local-post',{packetSha256:packet.prepared.packetSha256});
 const detail=await client.releaseLocal('new-local-post');assert(!detail.localReleased);assert.equal(detail.stage,'draft_saved');const ready=await client.prepare('new-local-post',{intent:'publish',releaseLocal:false});await client.publish('new-local-post',{packetSha256:ready.prepared.packetSha256});const queued=claim(app.db);publicRoot=join(process.env.MULTI_SITE_TEST_ROOT,'public-next');const next=await buildRelease({job:queued,target:publicRoot,source});finish(app.db,queued.id,{ok:true,hash:queued.snapshot_hash,release:next.release});const done=await client.status('new-local-post');assert.equal(done.stage,'published');assert.equal(done.receipt.publicReadback,true);assert(!done.localReleased);await app.close();
 `});assert.equal(result.status,0,result.stderr||result.stdout);
});
