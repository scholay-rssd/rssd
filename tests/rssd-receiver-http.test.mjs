import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat,realpath,mkdir,writeFile,symlink,link,chmod} from 'node:fs/promises';
import {createServer} from 'node:http';
import {execFileSync,spawnSync} from 'node:child_process';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {profiles} from '../scripts/site-config.mjs';
import {sectionsForSite} from '../contracts/site-sections.mjs';
import {contentKey} from '../contracts/rssd-publication.cjs';
import p from '../contracts/rssd-v1.cjs';
import mediaProtocol from '../contracts/rssd-media.cjs';
const artifact=resolve(process.env.RSSD_RECEIVER_ARTIFACT_DIR||'.');
const {createReceiver}=await import(pathToFileURL(join(artifact,'receiver/server.mjs')));
const {buildAndActivate,publicModes,preparePublicParents}=await import(pathToFileURL(join(artifact,'receiver/build.mjs')));
const {verifyLive}=await import(pathToFileURL(join(artifact,'admin/release-verification.mjs')));

test('HTTP receiver builds bilingual pages and applies recoverable withdraw/delete/restore without stale revival',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'rssd-http-')),base=join(dir,'public'),current=join(base,'current');
  // Production runs the receiver with UMask=0027 while the web server reads as another user.
  const mask=process.umask(0o027);t.after(()=>process.umask(mask));
  // A root-run Linux fixture can check real web-server-user access.
  const checkWebUser=process.platform==='linux'&&process.getuid?.()===0;
  if(checkWebUser)await chmod(dir,0o755);
  const server=createServer(async(req,res)=>{try{
    const pathname=new URL(req.url,'http://localhost').pathname,path=resolve(current,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
    if(!path.startsWith(current+sep))throw Error('Invalid path');const data=await readFile(path);res.writeHead(200,{'Content-Type':path.endsWith('.json')?'application/json':'text/plain'});res.end(data);
  }catch{res.writeHead(404);res.end();}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const site={...profiles.find(x=>x.id==='metho'),origin:'http://127.0.0.1:'+server.address().port,languages:['zh-CN','en']};
  const token='fixture-site-credential-not-real-1234567890',sectionId=sectionsForSite(site)[0].id;
  let failVerification=false,failModes=false;
  const receiver=await createReceiver({config:{home:join(dir,'state'),source:artifact,sites:[{site,publicRoot:base,tokenHash:p.hash(token)}]},
    build:options=>buildAndActivate({...options,makePublic:async path=>{if(failModes)throw Object.assign(Error('Simulated permission failure'),{code:'EPERM'});return publicModes(path);},verify:manifest=>{if(failVerification)throw Error('Simulated public verification failure');return verifyLive(manifest,site.origin,false);}})});
  t.after(async()=>{await receiver.app.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const endpoint='/api/rssd-receiver/v1/sites/metho/submissions',headers={authorization:'Bearer '+token};
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aYZkAAAAASUVORK5CYII=','base64'),asset=mediaProtocol.imageManifest(png);
  const mediaUrl='/api/rssd-receiver/v1/sites/metho/media/'+asset.sha256;
  assert.equal((await receiver.app.inject({url:mediaUrl,headers})).statusCode,404);
  assert.equal((await receiver.app.inject({method:'POST',url:mediaUrl,headers,payload:{...asset,data:png.toString('base64')}})).statusCode,200);
  const packet={version:1,requestId:'request-en',siteId:site.id,workspaceId:site.spaceId,sectionId,workId:'example',locale:'en',revision:1,contentHash:'a'.repeat(64),route:'/en/news/example/',assets:[asset],content:{locale:'en',title:'English first',bodyMarkdown:'Complete English body.\n\n![Evidence]('+asset.path+')',metadata:{date:'2026-10-31'}}};
  assert.equal((await receiver.app.inject({method:'POST',url:endpoint,payload:packet})).statusCode,401);
  const received=await receiver.app.inject({method:'POST',url:endpoint,headers,payload:packet});assert.equal(received.statusCode,200);assert.equal(received.json().state,'queued');
  await receiver.tick();const receipt=(await receiver.app.inject({url:endpoint+'/'+packet.requestId,headers})).json();assert.equal(receipt.state,'success',receipt.error);
  assert.match(await (await fetch(site.origin+packet.route)).text(),/Complete English body/);
  const release=await realpath(current);assert.equal((await stat(release)).mode&0o777,0o755);
  for(const path of ['en','en/news','en/news/example','rssd-content','article-media'])assert.equal((await stat(join(release,path))).mode&0o777,0o755,path);
  for(const path of ['release.json',packet.route.slice(1)+'index.html','rssd-content/'+contentKey(packet)+'.json',asset.path.slice(1)])assert.equal((await stat(join(release,path))).mode&0o777,0o644,path);
  assert.equal((await stat(join(dir,'state',site.id,'receiver.sqlite'))).mode&0o007,0,'private receiver database');
  for(const parent of [base,join(base,'releases')])assert.equal((await stat(parent)).mode&0o777,0o755,parent);
  if(checkWebUser){
    const canRead=path=>spawnSync('runuser',['-u','www-data','--','test','-r',path]).status;
    assert.equal(canRead(join(current,packet.route.slice(1),'index.html')),0,'web user can read the published article');
    assert.equal(canRead(join(dir,'state',site.id,'receiver.sqlite')),1,'web user cannot read the private receiver database');
  }
  assert.deepEqual(Buffer.from(await(await fetch(site.origin+asset.path)).arrayBuffer()),png);
  const visible=await(await fetch(site.origin+'/rssd-content/'+contentKey(packet)+'.json')).json();assert.equal(visible.requestId,packet.requestId);
  const prior=JSON.parse(await readFile(join(current,'release.json'),'utf8'));
  const update={...packet,requestId:'request-en-2',revision:2,contentHash:'b'.repeat(64),content:{...packet.content,title:'Revised English'}};
  await receiver.app.inject({method:'POST',url:endpoint,headers,payload:update});failModes=true;await receiver.tick();
  assert.equal((await receiver.app.inject({url:endpoint+'/'+update.requestId,headers})).json().state,'failed');
  assert.equal(JSON.parse(await readFile(join(current,'release.json'),'utf8')).release,prior.release);
  failModes=false;failVerification=true;await receiver.app.inject({method:'POST',url:endpoint+'/'+update.requestId+'/retry',headers,payload:{}});await receiver.tick();
  assert.equal((await receiver.app.inject({url:endpoint+'/'+update.requestId,headers})).json().state,'failed');
  assert.equal(JSON.parse(await readFile(join(current,'release.json'),'utf8')).release,prior.release);
  failVerification=false;await receiver.app.inject({method:'POST',url:endpoint+'/'+update.requestId+'/retry',headers,payload:{}});await receiver.tick();
  assert.equal((await receiver.app.inject({url:endpoint+'/'+update.requestId,headers})).json().state,'success');
  const chinese={...packet,requestId:'request-zh',locale:'zh-CN',route:'/news/example/',content:{locale:'zh-CN',title:'后补中文',bodyMarkdown:'完整的中文正文。',metadata:{date:'2026-10-31'}}};
  await receiver.app.inject({method:'POST',url:endpoint,headers,payload:chinese});await receiver.tick();
  assert.equal((await receiver.app.inject({url:endpoint+'/'+chinese.requestId,headers})).json().state,'success');
  assert.match(await (await fetch(site.origin+packet.route)).text(),/hreflang="zh-CN"/);
  assert.match(await (await fetch(site.origin+chinese.route)).text(),/完整的中文正文/);
  const headUrl='/api/rssd-receiver/v1/sites/metho/heads/'+packet.workId+'/en';
  assert.equal((await receiver.app.inject({url:headUrl})).statusCode,401);
  assert.equal((await receiver.app.inject({url:headUrl.replace('/metho/','/other/'),headers})).statusCode,401);
  assert.equal((await receiver.app.inject({url:headUrl.replace('/example/','/unknown/'),headers})).statusCode,404);
  const head=(await receiver.app.inject({url:headUrl,headers})).json();assert.equal(head.revision,2);assert.equal(head.operationSequence,2);
  const withdraw={...update,requestId:'withdraw-en',operation:'withdraw',operationSequence:3,expectedOperationSequence:2,expectedRevision:2};
  assert.equal((await receiver.app.inject({method:'POST',url:endpoint,headers,payload:withdraw})).statusCode,200);await receiver.tick();
  let actionReceipt=(await receiver.app.inject({url:endpoint+'/'+withdraw.requestId,headers})).json();
  assert.equal(actionReceipt.state,'success',actionReceipt.error);assert.equal(actionReceipt.operation,'withdraw');assert.equal(actionReceipt.operationSequence,3);
  assert.equal((await fetch(site.origin+packet.route)).status,404);
  assert.equal((await receiver.app.inject({method:'POST',url:endpoint,headers,payload:{...update,requestId:'unintentional-revival',revision:3}})).json().code,'edition_hidden');
  const tombstone=await(await fetch(site.origin+'/rssd-content/'+contentKey(packet)+'.json')).json();assert.equal(tombstone.operation,'withdraw');assert.equal(tombstone.content,undefined);
  // Another language's build must keep the English tombstone masking baseline.
  await receiver.app.inject({method:'POST',url:endpoint,headers,payload:{...chinese,requestId:'zh-update',revision:2}});await receiver.tick();
  assert.equal((await fetch(site.origin+packet.route)).status,404);
  const restore={...update,requestId:'restore-en',operation:'restore',operationSequence:4,expectedOperationSequence:3,expectedRevision:2};
  assert.equal((await receiver.app.inject({method:'POST',url:endpoint,headers,payload:restore})).statusCode,200);await receiver.tick();
  actionReceipt=(await receiver.app.inject({url:endpoint+'/'+restore.requestId,headers})).json();assert.equal(actionReceipt.state,'success',actionReceipt.error);assert.equal(actionReceipt.revision,2);
  assert.match(await(await fetch(site.origin+packet.route)).text(),/Complete English body/);
  const beforeDelete=JSON.parse(await readFile(join(current,'release.json'),'utf8'));
  const deletion={...update,requestId:'delete-en',operation:'delete',operationSequence:5,expectedOperationSequence:4,expectedRevision:2};
  await receiver.app.inject({method:'POST',url:endpoint,headers,payload:deletion});failVerification=true;await receiver.tick();
  assert.equal((await receiver.app.inject({url:endpoint+'/'+deletion.requestId,headers})).json().state,'failed');
  assert.equal(JSON.parse(await readFile(join(current,'release.json'),'utf8')).release,beforeDelete.release);assert.equal((await fetch(site.origin+packet.route)).status,200);
  failVerification=false;await receiver.app.inject({method:'POST',url:endpoint+'/'+deletion.requestId+'/retry',headers,payload:{}});await receiver.tick();
  actionReceipt=(await receiver.app.inject({url:endpoint+'/'+deletion.requestId,headers})).json();assert.equal(actionReceipt.state,'success',actionReceipt.error);assert.equal(actionReceipt.operation,'delete');assert.equal((await fetch(site.origin+packet.route)).status,404);
  // Replaying the original publication only returns its receipt; it is not queued.
  await receiver.app.inject({method:'POST',url:endpoint,headers,payload:packet});await receiver.tick();assert.equal((await fetch(site.origin+packet.route)).status,404);
  // Activation can finish before its SQLite acknowledgement. The resumed
  // restore must recover that exact artifact instead of creating a new one.
  const restoredAgain={...restore,requestId:'restore-after-lost-ack',operationSequence:6,expectedOperationSequence:5};
  await receiver.app.inject({method:'POST',url:endpoint,headers,payload:restoredAgain});
  const entry=receiver.sites.get(site.id),interrupted=entry.store.claim();
  const activated=await buildAndActivate({job:interrupted,site:entry.site,source:artifact,base,baseline:entry.baseline,media:entry.media});
  assert.equal(entry.store.receipt(interrupted.id).state,'building');await receiver.tick();
  const recovered=(await receiver.app.inject({url:endpoint+'/'+interrupted.id,headers})).json();
  assert.equal(recovered.state,'success',recovered.error);assert.equal(recovered.release,activated.release);assert.equal(recovered.operationSequence,6);
});

test('public release permissions reject links without touching their targets', {skip:process.platform==='win32'},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'rssd-public-modes-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const stage=join(dir,'stage'),outside=join(dir,'private');await mkdir(stage);await writeFile(outside,'private',{mode:0o600});await chmod(outside,0o600);
 await symlink(outside,join(stage,'link'));
 await assert.rejects(publicModes(stage),/Unexpected file type in public release/);
 assert.equal((await stat(outside)).mode&0o777,0o600);assert.equal(await readFile(outside,'utf8'),'private');
 await rm(join(stage,'link'));await link(outside,join(stage,'hard-link'));
 await assert.rejects(publicModes(stage),/Unexpected file type in public release/);
 assert.equal((await stat(outside)).mode&0o777,0o600);assert.equal(await readFile(outside,'utf8'),'private');
});

test('public parent preparation rejects symlinks without changing their targets', {skip:process.platform==='win32'},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'rssd-public-parents-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const outside=join(dir,'outside'),base=join(dir,'public');await mkdir(outside,{mode:0o700});await chmod(outside,0o700);
 await symlink(outside,base);await assert.rejects(preparePublicParents(base),/Invalid public release directory/);
 assert.equal((await stat(outside)).mode&0o777,0o700);await rm(base);await mkdir(base);await symlink(outside,join(base,'releases'));
 await assert.rejects(preparePublicParents(base),/Invalid public release directory/);assert.equal((await stat(outside)).mode&0o777,0o700);
});

test('public release permissions reject special files', {skip:process.platform==='win32'},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'rssd-public-modes-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 execFileSync('mkfifo',[join(dir,'pipe')]);
 await assert.rejects(publicModes(dir),/Unexpected file type in public release/);
});

test('paused site intake exposes authenticated status and refuses new submissions',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'rssd-paused-')),site=profiles.find(s=>s.id==='metho'),token='fixture-only-paused-site-token';
 const receiver=await createReceiver({config:{home:join(dir,'state'),source:artifact,sites:[{site,publicRoot:join(dir,'public'),tokenHash:p.hash(token),accepting:false}]}});
 t.after(async()=>{await receiver.app.close();await rm(dir,{recursive:true,force:true});});
 const base='/api/rssd-receiver/v1/sites/metho',headers={authorization:'Bearer '+token};
 assert.equal((await receiver.app.inject({url:base+'/status'})).statusCode,401);
 const status=await receiver.app.inject({url:base+'/status',headers});assert.equal(status.json().accepting,false);assert.equal(status.json().publications,0);
 const rejected=await receiver.app.inject({method:'POST',url:base+'/submissions',headers,payload:{}});assert.equal(rejected.statusCode,409);assert.equal(rejected.json().code,'site_paused');
});

test('academic intake rejects incomplete new news without reserving its request or work',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'rssd-academic-intake-')),site=profiles.find(s=>s.id==='scholay-today'),token='fixture-only-academic-token';
 const receiver=await createReceiver({config:{home:join(dir,'state'),source:artifact,sites:[{site,publicRoot:join(dir,'public'),tokenHash:p.hash(token)}]}});
 t.after(async()=>{await receiver.app.close();await rm(dir,{recursive:true,force:true});});
 const base='/api/rssd-receiver/v1/sites/scholay-today',headers={authorization:'Bearer '+token},sectionId=sectionsForSite(site)[0].id;
 const packet={version:1,requestId:'academic-request',siteId:site.id,workspaceId:site.spaceId,sectionId,workId:'academic-work',locale:'zh-CN',revision:1,contentHash:'a'.repeat(64),route:'/news/academic-work/',content:{locale:'zh-CN',title:'测试文章',summary:'',bodyMarkdown:'正文',metadata:{date:'2026-11-01'}}};
 const invalid=await receiver.app.inject({method:'POST',url:base+'/submissions',headers,payload:packet});
 assert.equal(invalid.statusCode,400);assert.equal(invalid.json().code,'invalid_academic_news');
 assert.equal((await receiver.app.inject({url:base+'/submissions/'+packet.requestId,headers})).statusCode,404);
 assert.equal(receiver.sites.get(site.id).store.db.prepare('SELECT count(*) AS n FROM heads').get().n,0);
 const valid={...packet,content:{...packet.content,summary:'完整摘要'}};
 assert.equal((await receiver.app.inject({method:'POST',url:base+'/submissions',headers,payload:valid})).json().state,'queued');
 assert.equal((await receiver.app.inject({method:'POST',url:base+'/submissions',headers,payload:valid})).json().state,'queued');
});
