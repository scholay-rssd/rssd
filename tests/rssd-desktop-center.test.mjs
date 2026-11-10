import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {centerDesktopCall} from '../desktop/scripts/rssd-center.mjs';
import {CenterOutbox,writeCenterJson} from '../scripts/rssd-center-client.mjs';
import {withFileLock} from '../scripts/editorial-lock.mjs';
import protocol from '../contracts/rssd-v1.cjs';

test('native center bridge preserves paging and search through the HTTP client',async t=>{
  const home=await mkdtemp(join(tmpdir(),'rssd-desktop-center-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const requests=[];
  const server=createServer((request,response)=>{
    requests.push(new URL(request.url,'http://localhost'));
    response.setHeader('Content-Type','application/json');
    response.end(JSON.stringify([{id:'second-page-item'}]));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  await writeCenterJson(join(home,'connection.json'),{
    origin:'http://127.0.0.1:'+server.address().port,
    token:'rssd_device_'+'a'.repeat(48),identity:{orgId:'example'}
  });
  for(const method of ['works','demands','publications']){
    const result=await centerDesktopCall(method,{workspaceId:'example',limit:51,offset:50,search:'research methods'},home);
    assert.deepEqual(result,[{id:'second-page-item'}]);
    const url=requests.at(-1);
    assert.equal(url.pathname,'/api/rssd/v1/'+method);
    assert.deepEqual(Object.fromEntries(url.searchParams),{
      workspaceId:'example',limit:'51',offset:'50',...(method==='publications'?{}:{search:'research methods'})
    });
  }
});

test('desktop reconciles a completed cached claim only with its matching accepted receipt',async t=>{
  const home=await mkdtemp(join(tmpdir(),'rssd-completed-claim-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const origin='https://center.example';
  await writeCenterJson(join(home,'connection.json'),{origin,identity:{orgId:'example',workerId:'device'}});
  const claim={id:'demand-one',claimToken:'claim-one',workspaceId:'research',sectionId:'methods',generation:1};
  const packet={requestId:'request-one',demandId:claim.id,claimToken:claim.claimToken,workId:'work-one',workspaceId:claim.workspaceId,sectionId:claim.sectionId,editions:[{locale:'zh-CN',title:'标题',bodyMarkdown:'正文'}]};
  const client={origin,submission:async()=>({requestId:packet.requestId,workId:packet.workId,workspaceId:packet.workspaceId,status:'accepted',demandState:'completed',publicationIds:[],editions:[{locale:'zh-CN',revision:1,hash:protocol.hash(protocol.submission(packet).editions[0])}]})};
  const outbox=new CenterOutbox({directory:join(home,'outbox'),client});
  await outbox.enqueue(packet);await outbox.flushOne(packet.requestId);
  const activeFile=join(home,'active-claim.json');
  await writeCenterJson(activeFile,{origin,claim:{...claim,claimToken:'newer-claim',generation:2}});
  assert.equal((await centerDesktopCall('status',{},home)).activeClaim.id,claim.id);
  assert.equal(JSON.parse(await readFile(activeFile,'utf8')).claim.claimToken,'newer-claim');
  await writeCenterJson(activeFile,{origin,claim});
  await outbox.enqueue({...packet,requestId:'pending-request'});
  assert.equal((await centerDesktopCall('status',{},home)).activeClaim.id,claim.id);
  await rm(outbox.path('pending-request'));
  await withFileLock(join(home,'worker.lock'),async()=>{
    assert.equal((await centerDesktopCall('status',{},home)).activeClaim.id,claim.id);
  });
  assert.equal((await centerDesktopCall('status',{},home)).activeClaim,null);
  assert.equal(JSON.parse(await readFile(activeFile,'utf8')).claim,null);
  assert.equal((await outbox.list())[0].state,'accepted');
});

test('the demand bridge accepts only confirmed research-methods columns and does not return credential data',async t=>{
  const home=await mkdtemp(join(tmpdir(),'rssd-desktop-demand-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const token='rssd_device_'+'a'.repeat(48),received=[];
  const server=createServer(async(request,response)=>{
    let body='';for await(const chunk of request)body+=chunk;
    received.push({method:request.method,path:request.url,authorization:request.headers.authorization,body:JSON.parse(body)});
    response.setHeader('Content-Type','application/json');
    response.end(JSON.stringify({...received.at(-1).body,payload:received.at(-1).body,state:'queued',token}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  await writeCenterJson(join(home,'connection.json'),{origin:'http://127.0.0.1:'+server.address().port,token,identity:{orgId:'example'}});
  const input={id:'topic-123',workspaceId:'metho',sectionId:'methods',kind:'write',title:'如何评估样本偏差',brief:'核查来源',requiredLocales:['zh-CN']};
  const result=await centerDesktopCall('create_demand',input,home);
  const payload={...input,source:null,priority:0};
  assert.deepEqual(result,{id:input.id,workspaceId:'metho',sectionId:'methods',title:input.title,state:'queued',payload});
  assert.equal(received.length,1);assert.equal(received[0].method,'POST');assert.equal(received[0].path,'/api/rssd/v1/demands');
  assert.equal(received[0].authorization,'Bearer '+token);assert.deepEqual(received[0].body,payload);
  assert(!JSON.stringify(result).includes(token));
  for(const sectionId of ['statistics','experiments','frontiers']){
    const column={...input,id:'topic-'+sectionId,sectionId};
    assert.equal((await centerDesktopCall('create_demand',column,home)).sectionId,sectionId);
    assert.deepEqual(received.at(-1).body,{...column,source:null,priority:0});
  }
  for(const changes of [{workspaceId:'other'},{workspaceId:'academic',sectionId:'history'},{sectionId:'news'},{sectionId:'resources'},{sectionId:'toString'},{kind:'translate'}, {requiredLocales:['en']},{id:''},{title:''},{source:{}},{priority:1},{token}]){
    await assert.rejects(centerDesktopCall('create_demand',{...input,...changes},home));
  }
  assert.equal(received.length,4,'invalid requests must not reach the server');
});

test('the demand bridge does not retry an uncertain POST and preserves its original ID',async t=>{
  const home=await mkdtemp(join(tmpdir(),'rssd-desktop-demand-'));
  t.after(()=>rm(home,{recursive:true,force:true}));let posts=0,receivedId;
  const server=createServer(async(request,response)=>{
    let body='';for await(const chunk of request)body+=chunk;
    posts++;receivedId=JSON.parse(body).id;request.socket.destroy();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  await writeCenterJson(join(home,'connection.json'),{origin:'http://127.0.0.1:'+server.address().port,token:'rssd_device_'+'a'.repeat(48),identity:{orgId:'example'}});
  const input={id:'topic-recovery-1',workspaceId:'metho',sectionId:'methods',kind:'write',title:'如何评估样本偏差',brief:'核查来源',requiredLocales:['zh-CN']};
  await assert.rejects(centerDesktopCall('create_demand',input,home),{code:'network_error'});
  assert.equal(posts,1);assert.equal(receivedId,input.id);
});

test('website retry uses the workspace editorial path and never the owner publication retry',async t=>{
  const home=await mkdtemp(join(tmpdir(),'rssd-desktop-retry-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const received=[];
  const server=createServer(async(request,response)=>{
    received.push({method:request.method,path:request.url});
    response.setHeader('Content-Type','application/json');
    response.end(JSON.stringify({queued:true,centerManaged:true}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  await writeCenterJson(join(home,'connection.json'),{origin:'http://127.0.0.1:'+server.address().port,token:'rssd_device_'+'a'.repeat(48),identity:{orgId:'example',workspaceIds:['pets']}});
  const result=await centerDesktopCall('retry_website',{workspaceId:'pets',requestKey:'editorial-request-one',jobId:'job-one'},home);
  assert.deepEqual(result,{queued:true,centerManaged:true});
  assert.deepEqual(received,[{method:'POST',path:'/api/rssd/v1/editorial/pets/requests/editorial-request-one/retry'}]);
  await assert.rejects(centerDesktopCall('retry_website',{workspaceId:'other',requestKey:'editorial-request-one',jobId:'job-one'},home),/Workspace access denied/);
  assert.equal(received.length,1);
});

test('desktop submit fills omitted media manifests from body-referenced center assets',async t=>{
  const home=await mkdtemp(join(tmpdir(),'rssd-desktop-submit-media-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const mediaId='media-'+'c'.repeat(48);let submitted=null;
  const server=createServer(async(request,response)=>{
    const url=new URL(request.url,'http://127.0.0.1');
    response.setHeader('Content-Type','application/json');
    if(request.method==='GET'&&url.pathname==='/api/rssd/v1/media/'+mediaId){
      response.end(JSON.stringify({id:mediaId,workspaceId:'pets',manifest:{sha256:'a'.repeat(64)}}));return;
    }
    if(request.method==='GET'&&url.pathname.startsWith('/api/rssd/v1/submissions/')){
      response.statusCode=404;response.end(JSON.stringify({message:'Not found',code:'not_found'}));return;
    }
    if(request.method==='POST'&&url.pathname==='/api/rssd/v1/submissions'){
      let body='';for await(const chunk of request)body+=chunk;
      submitted=JSON.parse(body);
      response.end(JSON.stringify({status:'accepted',requestId:submitted.requestId,workId:submitted.workId,workspaceId:submitted.workspaceId,editions:[{locale:'en',revision:1,hash:protocol.hash(submitted.editions[0])}]}));return;
    }
    response.statusCode=404;response.end(JSON.stringify({message:'Not found'}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin='http://127.0.0.1:'+server.address().port;
  await writeCenterJson(join(home,'connection.json'),{origin,token:'rssd_device_'+'a'.repeat(48),identity:{orgId:'example',workspaceIds:['pets']}});
  const packet={requestId:'desktop-title-fix',workId:'work-pets',workspaceId:'pets',sectionId:'pet-news',editions:[{locale:'en',title:'English title',bodyMarkdown:'Complete prose.\n\n![Figure]('+origin+'/api/rssd/v1/media/'+mediaId+'/raw)',media:[]}]};
  const result=await centerDesktopCall('submit',{packet},home);
  assert.equal(result.state,'accepted');
  assert.equal(submitted.editions[0].media[0].id,mediaId);
  assert.equal(submitted.editions[0].media.length,1);
});
