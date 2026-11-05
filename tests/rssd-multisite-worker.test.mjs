import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,rename,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runProductionTurn} from '../scripts/rssd-production-worker.mjs';
import {CenterError,CenterOutbox} from '../scripts/rssd-center-client.mjs';
import protocol from '../contracts/rssd-v1.cjs';
import {ARTICLE_WRITING_INSTRUCTIONS,ARTICLE_WRITING_POLICY} from '../contracts/article-writing-policy.mjs';
import {centerWritingScope} from '../desktop/scripts/agent/center-skill-mounts.mjs';
import {fixtureImagePolicy,fixtureReferenceSha,approveSyntheticReviews} from './fixtures/rssd-image-policy.mjs';

const sha=text=>createHash('sha256').update(text).digest('hex');
const policy={version:ARTICLE_WRITING_POLICY,instructions:ARTICLE_WRITING_INSTRUCTIONS};
const scope=centerWritingScope({workspaceId:'enter',sectionId:'forums'});
const content='---\nname: site-writing\n---\nActual private fixture rule.';
const skill={id:'site-writing',name:'site-writing',version:'fixture',contentHash:sha(content),content};
const snapshotValue={version:1,demandId:'slot-one',generation:1,scope,policyVersion:policy.version,policyHash:sha(policy.instructions),skills:[skill]};
const snapshot={...snapshotValue,snapshotHash:protocol.hash(snapshotValue)};
const signature={agentId:'codex',status:'completed',modelId:'gpt-6.1-terra[max]',writingSkillSnapshotHash:snapshot.snapshotHash,writingSkills:[{id:skill.id,version:skill.version,contentHash:skill.contentHash}]};
const edition=locale=>({locale,title:locale,bodyMarkdown:`Body ${locale}\n\n## References\n\n- [Source](https://example.org/source)`,sources:[{title:'Source',url:'https://example.org/source'}],metadata:{notebook:{modelSignatures:[signature],sources:[{id:'source-1',title:'Source',url:'https://example.org/source'}],blocks:[{id:'body',sourceIds:['source-1']}]}}});
async function fixture(t){
 const home=await mkdtemp(join(tmpdir(),'rssd-multisite-worker-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const scope={siteId:'enter',workspaceId:'enter',sectionId:'forums',destinationId:'site-enter',demandId:'slot-one',agentId:'codex',modelId:'gpt-6.1-terra',requiredLocales:['zh-CN','en']};
 const task={id:scope.demandId,generation:1,workspaceId:scope.workspaceId,sectionId:scope.sectionId,state:'claimed',title:'Topic',kind:'write',claimToken:'original-token',payload:{requiredLocales:scope.requiredLocales,submittedLocales:[],policy:{version:1,targets:scope.requiredLocales.map(locale=>({destinationId:scope.destinationId,locale}))}}};
 const directory=join(home,'jobs',protocol.hash(task.id+':'+task.generation));await mkdir(directory,{recursive:true});
 await writeFile(join(directory,'claim.json'),JSON.stringify(task));await writeFile(join(directory,'context.json'),JSON.stringify({work:null,writingPolicy:policy,baseRevisions:{}}));await writeFile(join(directory,'writing-skills.json'),JSON.stringify(snapshot));
 await writeFile(join(home,'active-claim.json'),JSON.stringify({origin:'https://center.example',claim:task}));
 let active=null,claims=0;const packets=[],receipts=new Map(),checks=[];
 const client={origin:'https://center.example',activeClaim:async()=>active,claim:async input=>{claims++;assert.equal(input.demandId,scope.demandId);active=task;return task;},
  work:async()=>{throw new CenterError('not found',{status:404});},heartbeat:async()=>{},changeDemand:async(id,input)=>{if(active)active.state=input.action==='resume'?'claimed':input.action;},
  submission:async id=>{if(receipts.has(id))return receipts.get(id);throw new CenterError('not found',{status:404});},
  submit:async packet=>{packets.push(packet);task.payload.submittedLocales.push(...packet.editions.map(e=>e.locale));const done=scope.requiredLocales.every(l=>task.payload.submittedLocales.includes(l));const receipt={requestId:packet.requestId,workId:packet.workId,workspaceId:packet.workspaceId,status:'accepted',demandState:done?'completed':'claimed',publicationIds:[`publication-${packet.editions[0].locale}`],editions:packet.editions.map(e=>({locale:e.locale,revision:1,hash:protocol.hash(e)}))};receipts.set(packet.requestId,receipt);if(done)active=null;return receipt;}};
 const verifyReady=async input=>{checks.push(input.phase);return {ready:true};};
 const producer=async({locale,expectedModel})=>{assert.equal(expectedModel,'gpt-6.1-terra');return edition(locale);};
 const sourceStage={restore:async()=>({snapshot:{snapshotHash:'c'.repeat(64)},selectionHash:'d'.repeat(64),bindingHash:'e'.repeat(64),prompt:'Frozen source fixture, untrusted data.'}),verifyEdition:async()=>({ok:true})};
 const input={client,home,producer,agentId:'codex',workspaceIds:['enter'],sectionIds:['forums'],demandId:scope.demandId,productionScope:scope,verifyReady,sourceStage};
 return {scope,task,client,packets,receipts,checks,input,setActive:value=>{active=value;},getClaims:()=>claims};
}
async function bindPacket(f,packet){const directory=join(f.input.home,'jobs',protocol.hash(f.scope.demandId+':1')),value=protocol.submission(packet);await writeFile(join(directory,value.editions[0].locale+'.packet-source-binding.json'),JSON.stringify({version:1,snapshotHash:'c'.repeat(64),selectionHash:'d'.repeat(64),bindingHash:'e'.repeat(64),contentHash:protocol.hash(value)}));}

test('a verified site scope produces both languages using one original claim and distinct receipts',async t=>{
 const f=await fixture(t);const result=await runProductionTurn(f.input);
 assert.equal(result.state,'accepted');assert.equal(f.getClaims(),1);assert.equal(f.packets.length,2);
 assert.equal(f.packets[0].workId,f.packets[1].workId);assert.equal(f.packets[0].claimToken,'original-token');assert.equal(f.packets[1].claimToken,'original-token');
 assert.deepEqual(f.packets[1].editions[0].translationOf,{workId:result.workId,locale:'zh-CN',revision:1});
 assert(f.checks.filter(x=>x==='before_submission').length>=2);assert(f.checks.includes('before_claim'));
});

test('unready sites and mismatched claim targets stop before writing or publication',async t=>{
 const f=await fixture(t);await assert.rejects(runProductionTurn({...f.input,verifyReady:async()=>({ready:false})}),/尚未确认/);assert.equal(f.getClaims(),0);assert.equal(f.packets.length,0);
 f.task.payload.policy.targets.push({destinationId:'social',locale:'en'});
 await assert.rejects(runProductionTurn(f.input),/发布目标不匹配/);assert.equal(f.packets.length,0);
 assert.equal(JSON.parse(await readFile(join(f.input.home,'active-claim.json'),'utf8')).claim.id,f.scope.demandId);
});

test('readiness revoked after Chinese submission preserves the original claim for explicit resume',async t=>{
 const f=await fixture(t);let first=true;
 const verifyReady=async({phase})=>{if(phase==='before_submission'&&f.packets.length&&first){first=false;return {ready:false};}return {ready:true};};
 let calls=0;const producer=async input=>{calls++;return f.input.producer(input);};
 await assert.rejects(runProductionTurn({...f.input,verifyReady,producer}),/尚未确认/);assert.equal(f.packets.length,1);assert.equal(f.task.state,'blocked');
 const result=await runProductionTurn({...f.input,verifyReady,producer,resume:true});assert.equal(result.state,'accepted');assert.equal(f.packets.length,2);assert.equal(f.getClaims(),1);assert.equal(calls,2);
});

test('an unrelated active claim or unverified model never gets flushed or resumed',async t=>{
 const f=await fixture(t);f.task.id='other';f.task.state='blocked';f.setActive(f.task);let changes=0;f.client.changeDemand=async()=>{changes++;};
 await assert.rejects(runProductionTurn({...f.input,resume:true}),/范围或发布目标不匹配/);assert.equal(changes,0);assert.equal(f.packets.length,0);
 const g=await fixture(t);const bad=async()=>({title:'bad',bodyMarkdown:'body',metadata:{notebook:{modelSignatures:[{...signature,modelId:'different'}]}}});
 await assert.rejects(runProductionTurn({...g.input,producer:bad}),/未确认由 Codex/);assert.equal(g.packets.length,0);
});

test('without an active claim an uncertain original packet is queried but never reposted or replaced',async t=>{
 const f=await fixture(t),box=new CenterOutbox({directory:join(f.input.home,'outbox'),client:f.client});let posts=0;
 const packet={requestId:'original-request',workId:'work-one',workspaceId:'enter',sectionId:'forums',demandId:f.scope.demandId,claimToken:'original-token',editions:[edition('zh-CN')]};
 await box.enqueue(packet);await bindPacket(f,packet);f.client.submit=async()=>{posts++;};
 const result=await runProductionTurn(f.input);assert.equal(result.state,'pending');assert.equal(posts,0);assert.equal(f.getClaims(),0);
});

test('without an active claim an existing original completed receipt is reconciled without claiming',async t=>{
 const f=await fixture(t),box=new CenterOutbox({directory:join(f.input.home,'outbox'),client:f.client});
 const packet=protocol.submission({requestId:'original-request',workId:'work-one',workspaceId:'enter',sectionId:'forums',demandId:f.scope.demandId,claimToken:'original-token',editions:[edition('zh-CN')]});await box.enqueue(packet);await bindPacket(f,packet);
 f.receipts.set(packet.requestId,{requestId:packet.requestId,workId:packet.workId,workspaceId:packet.workspaceId,status:'accepted',demandState:'completed',publicationIds:['publication-one'],editions:[{locale:'zh-CN',revision:1,hash:protocol.hash(packet.editions[0])}]});
 const result=await runProductionTurn(f.input);assert.equal(result.state,'accepted');assert.equal(result.demandId,f.scope.demandId);assert.equal(f.getClaims(),0);assert.equal(f.packets.length,0);
});

test('a receipt disappearing between two reads cannot trigger a POST without a claim',async t=>{
 const f=await fixture(t),box=new CenterOutbox({directory:join(f.input.home,'outbox'),client:f.client});
 const packet={requestId:'original-request',workId:'work-one',workspaceId:'enter',sectionId:'forums',demandId:f.scope.demandId,claimToken:'original-token',editions:[edition('zh-CN')]};await box.enqueue(packet);await bindPacket(f,packet);let reads=0,posts=0;
 f.client.submission=async()=>{if(++reads===1)return {status:'accepted'};throw new CenterError('not found',{status:404});};f.client.submit=async()=>{posts++;};
 const result=await runProductionTurn(f.input);assert.equal(result.state,'pending');assert.equal(posts,0);assert.equal(f.getClaims(),0);
});

test('reference failure preserves the generated result and blocks submission',async t=>{
 const f=await fixture(t),producer=async({locale})=>({...edition(locale),bodyMarkdown:'Body without references'});
 await assert.rejects(runProductionTurn({...f.input,producer}),/参考文献/);assert.equal(f.packets.length,0);assert.equal(f.task.state,'blocked');
 const directory=join(f.input.home,'jobs',protocol.hash(f.scope.demandId+':1'));
 assert.match((await readFile(join(directory,'zh-CN.result.json'),'utf8')),/Body without references/);
});

test('a recovered packet with invalid references is never flushed',async t=>{
 const f=await fixture(t),box=new CenterOutbox({directory:join(f.input.home,'outbox'),client:f.client});
 const packet={requestId:'original-request',workId:'work-one',workspaceId:'enter',sectionId:'forums',demandId:f.scope.demandId,claimToken:'original-token',editions:[{...edition('zh-CN'),bodyMarkdown:'Missing references'}]};
 await box.enqueue(packet);f.setActive(f.task);await assert.rejects(runProductionTurn(f.input),/参考文献/);assert.equal(f.packets.length,0);
});

test('missing skill evidence blocks new and recovered packets without discarding them',async t=>{
 const f=await fixture(t),missing=locale=>{const value=edition(locale);value.metadata.notebook.modelSignatures=[{agentId:'codex',status:'completed',modelId:'gpt-6.1-terra'}];return value;};
 await assert.rejects(runProductionTurn({...f.input,producer:async({locale})=>missing(locale)}),/缺少本次写作技能快照/);
 assert.equal(f.packets.length,0);assert.equal(f.task.state,'blocked');
 const g=await fixture(t),box=new CenterOutbox({directory:join(g.input.home,'outbox'),client:g.client});
 await box.enqueue({requestId:'original-request',workId:'work-one',workspaceId:'enter',sectionId:'forums',demandId:g.scope.demandId,claimToken:'original-token',editions:[missing('zh-CN')]});
 g.setActive(g.task);await assert.rejects(runProductionTurn(g.input),/缺少本次写作技能快照/);
 assert.equal(g.packets.length,0);assert.equal((await box.list())[0].state,'pending');
});

test('recovered outbox requires the original complete snapshot, policy and signature before any flush',async t=>{
 for(const failure of ['old-without-snapshot','corrupt-content','replaced-snapshot','changed-policy']){
  const f=await fixture(t),box=new CenterOutbox({directory:join(f.input.home,'outbox'),client:f.client});
  const packet={requestId:'original-request',workId:'work-one',workspaceId:'enter',sectionId:'forums',demandId:f.scope.demandId,claimToken:'original-token',editions:[edition('zh-CN')]};
  await box.enqueue(packet);f.setActive(f.task);
  const directory=join(f.input.home,'jobs',protocol.hash(f.scope.demandId+':1')),file=join(directory,'writing-skills.json');
  if(failure==='old-without-snapshot')await rm(file);
  if(failure==='corrupt-content')await writeFile(file,JSON.stringify({...snapshot,skills:[{...skill,content:skill.content+' tampered'}]}));
  if(failure==='replaced-snapshot'){
   const changed={...skill,content:skill.content+' replaced'};changed.contentHash=sha(changed.content);
   const value={...snapshotValue,skills:[changed]};await writeFile(file,JSON.stringify({...value,snapshotHash:protocol.hash(value)}));
  }
  if(failure==='changed-policy')await writeFile(join(directory,'context.json'),JSON.stringify({work:null,writingPolicy:{...policy,instructions:policy.instructions+' changed'},baseRevisions:{}}));
  await assert.rejects(runProductionTurn(f.input),/技能快照/);assert.equal(f.packets.length,0,failure);
  const preserved=(await box.list())[0];assert.equal(preserved.state,'pending');assert.equal(preserved.requestId,'original-request');
 }
});

test('a saved packet is held when its original snapshot is missing, then resumes with the same packet after restoration',async t=>{
 const f=await fixture(t),directory=join(f.input.home,'jobs',protocol.hash(f.scope.demandId+':1')),file=join(directory,'writing-skills.json');
 const packet=protocol.submission({requestId:'original-request',workId:'work-one',workspaceId:'enter',sectionId:'forums',demandId:f.scope.demandId,claimToken:'original-token',baseRevisions:{'zh-CN':0},editions:[edition('zh-CN')]});
 await writeFile(join(directory,'zh-CN.packet.json'),JSON.stringify(packet));await bindPacket(f,packet);await rm(file);f.setActive(f.task);
 await assert.rejects(runProductionTurn(f.input),/缺少可验证的写作技能快照/);assert.equal(f.packets.length,0);
 assert.equal(JSON.parse(await readFile(join(directory,'zh-CN.packet.json'),'utf8')).requestId,'original-request');
 await writeFile(file,JSON.stringify(snapshot));const result=await runProductionTurn({...f.input,resume:true});
 assert.equal(result.state,'accepted');assert.equal(f.packets[0].requestId,'original-request');
});

test('scoped required images preserve the original claim through pending, upload, binding and bilingual reuse',async t=>{
 const {produceCenterEdition}=await import('../desktop/scripts/agent/center-producer.mjs');
 const {prepareAndUploadRequiredImages}=await import('../scripts/rssd-image-staging.mjs');
 const {notebookMarkdown}=await import('../desktop/scripts/agent/notebook.mjs');
 const media=(await import('../contracts/rssd-media.cjs')).default;
 const f=await fixture(t);f.scope.imagePlanRequired=true;
 const directory=join(f.input.home,'jobs',protocol.hash(f.task.id+':'+f.task.generation));
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNwKe/AihiGlgQAfJlQwQd75hcAAAAASUVORK5CYII=','base64');
 const alt='一张用于测试的八乘八像素合成图片不代表任何真实研究';
 const slots=['hero','body-image'].map(blockId=>({blockId,requirement:'Synthetic shapes',alt,caption:'AI 生成示意图'}));
 const draft={summary:'Summary',metadata:{},imagePlan:slots,notebook:{version:2,kind:'article',title:'Fixture',skills:[],fields:{},sources:[{id:'source-1',title:'Source',url:'https://example.org/source',summary:'Synthetic source',acquiredVia:'web',reviewed:false}],blockNotes:{body:{notes:{supplement:'Private original'}}},internalNotes:{verification:'Private check'},blocks:[{id:'body',type:'paragraph',state:'ready',text:'Original complete body',sourceIds:['source-1']},...slots.flatMap(s=>[{id:s.blockId,type:'image',state:'placeholder',text:'',sourceIds:[]},{id:s.blockId+'-caption',type:'annotation',role:'caption',targetId:s.blockId,state:'placeholder',text:'',sourceIds:[]}])]}};
 const script=join(directory,'fake-acp.cjs'),marker=join(directory,'launches');
 await writeFile(script,`const fs=require('node:fs'),{createInterface}=require('node:readline');fs.appendFileSync(${JSON.stringify(marker)},'x');const send=x=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...x})+'\\n');createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1}});if(m.method==='session/new')send({id:m.id,result:{sessionId:'fixture',models:{currentModelId:'gpt-6.1-terra[max]'}}});if(m.method==='session/prompt'){send({method:'session/update',params:{sessionId:'fixture',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:${JSON.stringify(JSON.stringify(draft))}}}}});send({id:m.id,result:{stopReason:'end_turn'}});}});`);
 let starts=0,lookups=0,uploads=0,enCalls=0;const records=new Map();
 const provider={id:'synthetic',async start({scope}){starts++;return scope.blockId==='hero'?{status:'ready',bytes:png,registration:{assetId:'asset-1',taskId:'task-1',sha256:media.imageManifest(png).sha256},provenance:{kind:'generated'}}:{status:'pending'};},async lookup({scope}){lookups++;const n=scope.blockId==='hero'?1:2;return {status:'ready',bytes:png,registration:{assetId:'asset-'+n,taskId:'task-'+n,sha256:media.imageManifest(png).sha256},provenance:{kind:'generated'}};}};
 f.client.request=async(path,options)=>{if(options?.method==='POST'){uploads++;const id='media-'+protocol.hash([f.task.workspaceId,options.body.sha256]).slice(0,48);const row={id,workspaceId:f.task.workspaceId,manifest:{sha256:options.body.sha256,mime:options.body.mime,bytes:options.body.bytes,path:options.body.path}};records.set(id,row);return row;}const id=path.split('/').pop();if(!records.has(id))throw new CenterError('not found',{status:404});return records.get(id);};
 const imageStage={origin:f.client.origin,async prepare(input){assert.equal('claim' in input,false);return prepareAndUploadRequiredImages({slots:input.plan.slots.map(s=>({...s,referenceSha256:fixtureReferenceSha})),jobId:f.task.id,jobDirectory:directory,home:f.input.home,client:f.client,siteId:'enter',workspaceId:f.task.workspaceId,resolveImagePolicy:fixtureImagePolicy,provider});}};
 const dependencies={registry:{launch:async()=>({command:process.execPath,args:[script],env:{},agent:{name:'Codex'}})},pilotEnvironment:async env=>env,skillSnapshot:async()=>snapshot,imageStage,timeoutMs:10000};
 const producer=async input=>{if(input.locale==='zh-CN'){assert.equal(input.imagePlanRequired,true);return produceCenterEdition(input,dependencies);}enCalls++;assert.equal(input.imagePlanRequired,undefined);assert.match(input.imageTranslationInstructions,/AI-generated illustration/);assert.match(input.imageTranslationInstructions,/originalBlockId/);assert.match(input.imageTranslationInstructions,/media-/);const output=structuredClone(input.source.payload);output.locale='en';for(const block of output.metadata.notebook.blocks)if(block.role==='caption')block.text='Synthetic image · AI-generated illustration';output.bodyMarkdown=notebookMarkdown(output.metadata.notebook,{site:null,locale:'en'});return output;};
 await assert.rejects(runProductionTurn({...f.input,producer}),{code:'image_pending'});
 assert.equal(f.task.state,'blocked');assert.equal(f.task.claimToken,'original-token');assert.equal(f.task.generation,1);assert.equal(f.getClaims(),1);assert.equal(f.packets.length,0);assert.equal(uploads,0);
 const plan=JSON.parse(await readFile(join(directory,'zh-CN.image-plan.json'),'utf8'));assert.equal(plan.draft.notebook.blocks[0].text,'Original complete body');
 await approveSyntheticReviews(directory);await assert.rejects(runProductionTurn({...f.input,producer,resume:true}),{code:'image_pending'});
 await assert.rejects(runProductionTurn({...f.input,producer,resume:true}),{code:'image_pending'});await approveSyntheticReviews(directory);
 // An uncertain first POST leaves the complete original packet in outbox.
 // Loss of its visual receipt must prevent a second POST until restored.
 const realSubmit=f.client.submit;let originalRequest;
 f.client.submit=async packet=>{originalRequest=packet.requestId;throw new CenterError('network unavailable',{status:503});};
 await assert.rejects(runProductionTurn({...f.input,producer,resume:true}));
 const outbox=new CenterOutbox({directory:join(f.input.home,'outbox'),client:f.client}),pending=(await outbox.list()).find(e=>e.requestId===originalRequest);
 assert.equal(pending.state,'pending');assert.equal(f.packets.length,0);
 const reviews=join(directory,'image-visual-review'),name=(await readdir(reviews)).find(n=>n.endsWith('.receipt.json'));await rename(join(reviews,name),join(reviews,name+'.held'));
 f.client.submit=realSubmit;await assert.rejects(runProductionTurn({...f.input,producer,resume:true}),{code:'image_pending'});
 assert.equal(f.packets.length,0);assert.equal((await outbox.list()).find(e=>e.requestId===originalRequest).state,'pending');
 await rename(join(reviews,name+'.held'),join(reviews,name));
 const result=await runProductionTurn({...f.input,producer,resume:true});
 assert.equal(result.state,'accepted');assert.equal(f.getClaims(),1);assert.equal(f.packets.length,2);assert.equal(f.packets[0].claimToken,'original-token');assert.equal(f.packets[1].claimToken,'original-token');assert.equal(await readFile(marker,'utf8'),'x');assert.equal(starts,2);assert.equal(lookups,3);assert.equal(uploads,1);assert.equal(enCalls,1);
 assert.equal(f.packets[0].requestId,originalRequest);
 assert.deepEqual(f.packets[0].editions[0].metadata.notebook.blocks.filter(b=>b.type==='image').map(b=>b.text),f.packets[1].editions[0].metadata.notebook.blocks.filter(b=>b.type==='image').map(b=>b.text));
 assert.equal(JSON.parse(await readFile(join(directory,'zh-CN.image-receipt.json'),'utf8')).images.every(i=>i.uploaded),true);
});

test('translation image guard rejects missing, reordered, uncaptioned, or undescribed images',async()=>{
 const {requireReusedTranslationImages}=await import('../scripts/rssd-production-worker.mjs');
 const image=(id,url)=>[{id,type:'image',state:'ready',text:url,alt:'Image description'}, {id:id+'-caption',type:'annotation',role:'caption',targetId:id,state:'ready',text:'Caption'}];
 const source={metadata:{notebook:{blocks:[...image('a','https://center.example/media/one'),...image('b','https://center.example/media/two')]}}};
 const translated=structuredClone(source);translated.metadata.notebook.blocks[0].alt='Translated description';translated.metadata.notebook.blocks[1].text='Translated caption';
 assert.doesNotThrow(()=>requireReusedTranslationImages(source,translated));
 for(const mutate of [b=>b.splice(2,2),b=>b.push(...b.splice(0,2)),b=>{b[1].text='';},b=>{b[0].alt='';},b=>{b[0].text='https://center.example/media/other';}]){
  const bad=structuredClone(translated);mutate(bad.metadata.notebook.blocks);assert.throws(()=>requireReusedTranslationImages(source,bad));
 }
});

test('a required-image scoped recovered packet without image proof is retained and never submitted',async t=>{
 const f=await fixture(t);f.scope.imagePlanRequired=true;f.setActive(f.task);
 const box=new CenterOutbox({directory:join(f.input.home,'outbox'),client:f.client});
 const packet={requestId:'original-request',workId:'work-one',workspaceId:'enter',sectionId:'forums',demandId:f.scope.demandId,claimToken:'original-token',editions:[edition('zh-CN')]};await box.enqueue(packet);await bindPacket(f,packet);
 await assert.rejects(runProductionTurn(f.input),/配图计划和上传回执/);assert.equal(f.packets.length,0);const saved=(await box.list())[0];assert.equal(saved.requestId,'original-request');assert.equal(saved.state,'pending');assert.equal(f.getClaims(),0);
});

test('an already accepted image-scoped original is reconciled by receipt only even without a local image proof',async t=>{
 const f=await fixture(t);f.scope.imagePlanRequired=true;const box=new CenterOutbox({directory:join(f.input.home,'outbox'),client:f.client});
 const packet=protocol.submission({requestId:'original-request',workId:'work-one',workspaceId:'enter',sectionId:'forums',demandId:f.scope.demandId,claimToken:'original-token',editions:[edition('zh-CN')]});await box.enqueue(packet);await bindPacket(f,packet);
 // A legacy accepted original may have a partial licensed-image receipt but
 // no remaining local copyright evidence. It must only be queried, never sent.
 const directory=join(f.input.home,'jobs',protocol.hash(f.task.id+':'+f.task.generation));
 await writeFile(join(directory,'zh-CN.image-receipt.json'),JSON.stringify({images:[{provenance:{kind:'licensed-source'}}]}),{mode:0o600});
 f.receipts.set(packet.requestId,{requestId:packet.requestId,workId:packet.workId,workspaceId:packet.workspaceId,status:'accepted',demandState:'completed',publicationIds:['publication-one'],editions:[{locale:'zh-CN',revision:1,hash:protocol.hash(packet.editions[0])}]});
 const result=await runProductionTurn(f.input);assert.equal(result.state,'accepted');assert.equal(f.getClaims(),0);assert.equal(f.packets.length,0);assert.equal((await box.list())[0].state,'accepted');
});

test('a disappearing image-scoped receipt cannot cause a new publication or replacement claim',async t=>{
 const f=await fixture(t);f.scope.imagePlanRequired=true;const box=new CenterOutbox({directory:join(f.input.home,'outbox'),client:f.client});
 const packet={requestId:'original-request',workId:'work-one',workspaceId:'enter',sectionId:'forums',demandId:f.scope.demandId,claimToken:'original-token',editions:[edition('zh-CN')]};await box.enqueue(packet);await bindPacket(f,packet);let reads=0,posts=0;
 f.client.submission=async()=>{if(++reads===1)return {status:'accepted'};throw new CenterError('not found',{status:404});};f.client.submit=async()=>{posts++;};
 const result=await runProductionTurn(f.input);assert.equal(result.state,'pending');assert.equal(posts,0);assert.equal(f.getClaims(),0);assert.equal((await box.list())[0].requestId,'original-request');
});

test('English writing does not start when the accepted Chinese packet lacks original image evidence',async t=>{
 const f=await fixture(t);f.scope.imagePlanRequired=true;f.task.payload.submittedLocales=['zh-CN'];f.setActive(f.task);
 const directory=join(f.input.home,'jobs',protocol.hash(f.task.id+':'+f.task.generation));
 const withImages=locale=>{const e=edition(locale);e.metadata.notebook.blocks.push(...['one','two'].flatMap(id=>[{id,type:'image',state:'ready',text:'https://center.example/media/'+id,alt:'Meaningful image description',sourceIds:[]},{id:id+'-caption',type:'annotation',role:'caption',targetId:id,state:'ready',text:'Meaningful caption',sourceIds:[]} ]));return e;};
 const chinese=protocol.submission({requestId:'chinese-original',workId:'work-'+protocol.hash(f.task.id).slice(0,32),workspaceId:'enter',sectionId:'forums',demandId:f.scope.demandId,claimToken:'original-token',baseRevisions:{'zh-CN':0},editions:[withImages('zh-CN')]});
 await writeFile(join(directory,'zh-CN.packet.json'),JSON.stringify(chinese));f.receipts.set(chinese.requestId,{requestId:chinese.requestId,workId:chinese.workId,workspaceId:chinese.workspaceId,status:'accepted',editions:[{locale:'zh-CN',revision:1,hash:protocol.hash(chinese.editions[0])}]});
 let calls=0;const producer=async()=>{calls++;throw Error('must not generate');};
 await assert.rejects(runProductionTurn({...f.input,producer}),/缺少匹配的来源绑定/);assert.equal(calls,0);assert.equal(f.packets.length,0);assert.equal(f.task.state,'blocked');
 await assert.rejects(readFile(join(directory,'en.packet.json')),{code:'ENOENT'});
});
