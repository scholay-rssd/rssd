import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {produceCenterEdition} from '../desktop/scripts/agent/center-producer.mjs';
import {prepareAndUploadRequiredImages} from '../scripts/rssd-image-staging.mjs';
import media from '../contracts/rssd-media.cjs';
import {fixtureImagePolicy,fixtureReferenceSha,approveSyntheticReviews} from './fixtures/rssd-image-policy.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNwKe/AihiGlgQAfJlQwQd75hcAAAAASUVORK5CYII=','base64');
const alt='一张用于测试的八乘八像素合成图片不代表任何真实研究';
const skills={snapshotHash:'a'.repeat(64),skills:[{id:'site-writing',version:'v1',contentHash:'b'.repeat(64),content:'Real frozen fixture skill'}]};
function draft(){const slots=['hero','body-image'].map(blockId=>({blockId,requirement:'Synthetic shapes',alt,caption:'AI 生成示意图'}));return {summary:'Summary',metadata:{},imagePlan:slots,notebook:{version:2,kind:'article',title:'Fixture',skills:[],fields:{},sources:[],blockNotes:{body:{notes:{supplement:'Private original'}}},internalNotes:{verification:'Private check'},blocks:[{id:'body',type:'paragraph',state:'ready',text:'Original complete body',sourceIds:[]},...slots.flatMap(s=>[{id:s.blockId,type:'image',state:'placeholder',text:'',sourceIds:[]},{id:s.blockId+'-caption',type:'annotation',role:'caption',targetId:s.blockId,state:'placeholder',text:'',sourceIds:[]}])]}};}
const claim={id:'demand-1',generation:3,workspaceId:'metho',sectionId:'methods',kind:'write',claimToken:'private-claim-token',title:'Synthetic',payload:{brief:'Synthetic brief',policy:{instructions:'Scoped rules'}}};

test('image pending retains original draft and claim; resume checks original skills and never regenerates text or images',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'rssd-producer-image-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const script=join(directory,'acp.cjs'),launchMarker=join(directory,'launch-count');
 await writeFile(script,`const fs=require('node:fs'),{createInterface}=require('node:readline');fs.appendFileSync(${JSON.stringify(launchMarker)},'x');const send=x=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...x})+'\\n');createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1}});if(m.method==='session/new')send({id:m.id,result:{sessionId:'fixture'}});if(m.method==='session/prompt'){send({method:'session/update',params:{sessionId:'fixture',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:${JSON.stringify(JSON.stringify(draft()))}}}}});send({id:m.id,result:{stopReason:'end_turn'}});}});`);
 const args={directory,agentId:'fixture',claim,workId:'work-1',locale:'zh-CN',imagePlanRequired:true,writingPolicy:{version:'v1',instructions:'Frozen policy'}};
 let starts=0,lookups=0,uploads=0;const records=new Map();
 const provider={id:'synthetic',async start({scope}){starts++;return scope.blockId==='hero'?{status:'ready',bytes:png,registration:{assetId:'asset-1',taskId:'task-1',sha256:media.imageManifest(png).sha256},provenance:{kind:'generated'}}:{status:'pending'};},async lookup({scope}){lookups++;const n=scope.blockId==='hero'?1:2;return {status:'ready',bytes:png,registration:{assetId:'asset-'+n,taskId:'task-'+n,sha256:media.imageManifest(png).sha256},provenance:{kind:'generated'}};}};
 const client={origin:'https://center.example',async request(path,options){if(options?.method==='POST'){uploads++;const id='media-'+(await import('../contracts/rssd-v1.cjs')).default.hash([claim.workspaceId,options.body.sha256]).slice(0,48);const row={id,workspaceId:claim.workspaceId,manifest:{sha256:options.body.sha256,mime:options.body.mime,bytes:options.body.bytes,path:options.body.path}};records.set(id,row);return row;}const id=path.split('/').pop();if(!records.has(id))throw Object.assign(Error('missing'),{status:404});return records.get(id);}};
 const imageStage={origin:client.origin,async prepare(input){assert.equal('claim' in input,false);return prepareAndUploadRequiredImages({slots:input.plan.slots.map(s=>({...s,referenceSha256:fixtureReferenceSha})),jobId:claim.id,jobDirectory:directory,home:directory,client,siteId:'metho',workspaceId:claim.workspaceId,resolveImagePolicy:fixtureImagePolicy,provider});}};
 const dependencies={registry:{launch:async()=>({command:process.execPath,args:[script],env:{},agent:{name:'Fixture'}})},skillSnapshot:async()=>skills,imageStage,timeoutMs:10000};
 await assert.rejects(produceCenterEdition(args,dependencies),{code:'image_pending'});
 assert.equal(await readFile(launchMarker,'utf8'),'x');assert.equal(uploads,0);
 const frozen=JSON.parse(await readFile(join(directory,'zh-CN.image-plan.json'),'utf8'));assert.equal(frozen.draft.notebook.blocks[0].text,'Original complete body');assert.equal(frozen.binding.signature.writingSkillSnapshotHash,skills.snapshotHash);
 assert.doesNotMatch(await readFile(join(directory,'zh-CN.image-plan.json'),'utf8'),/private-claim-token/);
 const prompt=await readFile(join(directory,'zh-CN.prompt.txt'),'utf8');assert.match(prompt,/Real frozen fixture skill/);assert.match(prompt,/imagePlan/);
 const resumed={...dependencies,registry:{launch:async()=>{throw Error('must not restart ACP');}}};
 await approveSyntheticReviews(directory);await assert.rejects(produceCenterEdition(args,resumed),{code:'image_pending'});
 await assert.rejects(produceCenterEdition(args,resumed),{code:'image_pending'});await approveSyntheticReviews(directory);
 const result=await produceCenterEdition(args,resumed);
 assert.equal(await readFile(launchMarker,'utf8'),'x');assert.equal(starts,2);assert.equal(lookups,3);assert.equal(uploads,1);
 assert.match(result.bodyMarkdown,/Original complete body/);assert.match(result.bodyMarkdown,/!\[/);assert.doesNotMatch(result.bodyMarkdown,/Private original|Private check/);
 assert.equal(result.metadata.notebook.blockNotes.body.notes.supplement,'Private original');assert.equal(result.metadata.notebook.modelSignatures[0].writingSkillSnapshotHash,skills.snapshotHash);
 await assert.rejects(produceCenterEdition(args,{...dependencies,skillSnapshot:async()=>({...skills,snapshotHash:'c'.repeat(64)})}),/快照不匹配/);
});

test('explicit image plan without provider fails closed before launching ACP; skill failure also blocks',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'rssd-producer-image-'));t.after(()=>rm(directory,{recursive:true,force:true}));let launched=0;
 const args={directory,agentId:'fixture',claim,workId:'work-1',locale:'zh-CN',imagePlanRequired:true};
 const registry={launch:async()=>{launched++;throw Error('unexpected');}};
 await assert.rejects(produceCenterEdition(args,{registry,skillSnapshot:async()=>skills}),{code:'image_pending'});assert.equal(launched,0);
 await assert.rejects(produceCenterEdition(args,{registry,skillSnapshot:async()=>{throw Error('missing skill');},imageStage:{origin:'https://center.example',prepare:async()=>[]}}),/missing skill/);assert.equal(launched,0);
});

test('writing prompt injects frozen referenced rules without turning them into file permissions',async()=>{
 const {centerWritingPrompt}=await import('../desktop/scripts/agent/center-producer.mjs');
 const prompt=centerWritingPrompt({claim,locale:'zh-CN',writingPolicy:{version:'v1',instructions:'User policy'},writingSkills:{...skills,references:[{path:'references/image.md',contentHash:'d'.repeat(64),content:'Only use licensed source images when available.'}]}});
 assert.match(prompt,/references\/image\.md/);assert.match(prompt,/d{64}/);assert.match(prompt,/Only use licensed source images/);assert.match(prompt,/条件适用时/);assert.match(prompt,/不授予文件权限/);assert.match(prompt,/用户要求与写作协议优先/);
});
