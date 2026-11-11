import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import protocol from '../contracts/rssd-v1.cjs';
import {notebookEdition} from '../desktop/scripts/agent/center-notebook.mjs';
import {parseCenterEdition} from '../desktop/scripts/agent/center-producer.mjs';
import {prepareEditionMedia,stageMedia} from '../scripts/rssd-device-media.mjs';
import {parseCenterMediaRef,trustedCenterOrigin} from '../scripts/rssd-center-media-ref.mjs';
import {
  GENERATION_UNRECOVERABLE,authenticGenerationSignature,persistGenerationEvidence,recoverPersistedCenterEdition,sourceBindFrom,
} from '../scripts/rssd-center-generation-evidence.mjs';
import {requireReusedTranslationImages,runProductionTurn} from '../scripts/rssd-production-worker.mjs';
import {enqueueStoreOnlyTranslate,storeOnlyTranslateContract,translateContinuationContract} from '../scripts/rssd-translate-continuation.mjs';
import {createTranslateCenterFixture} from './fixtures/rssd-translate-center.mjs';
import {requireStoreOnlyFixtureTree} from '../scripts/rssd-store-only-fixture.mjs';

requireStoreOnlyFixtureTree();

const ORIGIN='https://center.example';
const WORKSPACE='enter';
const bothContracts={translateContinuation:translateContinuationContract(),storeOnlyTranslate:storeOnlyTranslateContract()};
const missing=()=>Object.assign(Error('not found'),{status:404});
async function temp(t){const home=await mkdtemp(join(tmpdir(),'rssd-reg-media-'));t.after(()=>rm(home,{recursive:true,force:true}));return home;}
async function webpPixel(background){return sharp({create:{width:4,height:4,channels:3,background}}).webp().toBuffer();}
function relativeRaw(id){return '/api/rssd/v1/media/'+id+'/raw';}
function absoluteRaw(id,origin=ORIGIN){return origin+'/api/rssd/v1/media/'+id+'/raw';}
function notebook(){return {version:2,kind:'article',title:'Fixture',skills:[],fields:{},sources:[],blocks:[{id:'body',type:'paragraph',state:'ready',text:'Complete bilingual prose about the same two figures.',sourceIds:[]}],internalNotes:{},blockNotes:{}};}
function notebookWithImages(title,urls){
  const n=notebook();n.title=title;
  urls.forEach((url,i)=>n.blocks.push(
    {id:'image-'+i,type:'image',state:'ready',text:url,alt:'Figure '+(i+1),sourceIds:[]},
    {id:'caption-'+i,type:'annotation',role:'caption',targetId:'image-'+i,state:'ready',text:'Caption '+(i+1),sourceIds:[]},
  ));
  return n;
}
function deviceSignature(agentId='codex'){
  return {runId:'run-synthetic-media',agentId,agentName:agentId,startedAt:'2026-11-07T00:00:00.000Z',completedAt:'2026-11-07T00:00:01.000Z',action:'translate',status:'completed',modelId:'labeled-mock',modelName:'labeled mock producer'};
}
const TASK={demandId:'demand-synthetic-media',generation:1,workerId:'device-a'};
function evidenceArgs(extra={}){return {origin:ORIGIN,workspaceId:WORKSPACE,sectionId:'forums',agentId:'codex',...TASK,...extra};}
function storeCenter(){return createTranslateCenterFixture({contracts:bothContracts});}
function withRegisteredMedia(client,assets){
  const stored=new Map(assets.map(asset=>[asset.id,asset]));
  let uploads=0;
  return {
    ...client,
    uploads:()=>uploads,
    request:async(path,opts={})=>{
      if((opts.method||'GET')==='POST'&&path==='/media'){uploads++;throw Error('must not re-upload registered source media');}
      const get=String(path).match(/^\/media\/([^/?]+)$/);
      if(get){
        const asset=stored.get(get[1]);
        if(!asset)throw missing();
        return {id:asset.id,workspaceId:WORKSPACE,manifest:asset.manifest};
      }
      return client.request(path,opts);
    },
  };
}

test('relative and absolute trusted Center media refs normalize; foreign origin and illegal paths fail closed',()=>{
  const id='media-'+'a'.repeat(48);
  const parsed=parseCenterMediaRef(relativeRaw(id),{origin:ORIGIN});
  assert.deepEqual(parsed,{id,origin:ORIGIN,relative:relativeRaw(id),absolute:absoluteRaw(id)});
  assert.deepEqual(parseCenterMediaRef(absoluteRaw(id),{origin:ORIGIN}),parsed);
  assert.equal(trustedCenterOrigin(ORIGIN+'/'),ORIGIN);
  assert.equal(parseCenterMediaRef('https://evil.example'+relativeRaw(id),{origin:ORIGIN}),null);
  assert.equal(parseCenterMediaRef('https://center.example'+relativeRaw(id)+'?token=1',{origin:ORIGIN}),null);
  assert.equal(parseCenterMediaRef('https://user:pass@center.example'+relativeRaw(id),{origin:ORIGIN}),null);
  assert.equal(parseCenterMediaRef('//center.example'+relativeRaw(id),{origin:ORIGIN}),null);
  assert.equal(parseCenterMediaRef('/api/rssd/v1/media/../media/'+id+'/raw',{origin:ORIGIN}),null);
  assert.equal(parseCenterMediaRef('/api/rssd/v1/media/'+id+'/raw#x',{origin:ORIGIN}),null);
  assert.equal(parseCenterMediaRef(absoluteRaw(id),{origin:'http://center.example'}),null);
  assert.equal(parseCenterMediaRef(relativeRaw(id)),null);
});

test('source-bound notebook accepts registered relative WebP URLs and rejects unregistered or cross-origin copies',async t=>{
  const home=await temp(t);
  const first=await stageMedia({directory:join(home,'media'),origin:ORIGIN,workspaceId:WORKSPACE,bytes:await webpPixel('#467f65'),name:'one.webp'});
  const second=await stageMedia({directory:join(home,'media'),origin:ORIGIN,workspaceId:WORKSPACE,bytes:await webpPixel('#b54433'),name:'two.webp'});
  assert.equal(first.manifest.mime,'image/webp');assert.equal(second.manifest.mime,'image/webp');
  const relative=[relativeRaw(first.id),relativeRaw(second.id)];
  const chinese=notebookEdition({notebook:notebookWithImages('合成中文标题',relative),summary:'摘要'},{locale:'zh-CN',origin:ORIGIN,workspaceId:WORKSPACE});
  assert.deepEqual(chinese.media.map(item=>item.id),[first.id,second.id]);
  assert.match(chinese.bodyMarkdown,new RegExp(first.id));
  const english=notebookEdition({notebook:notebookWithImages('Synthetic English title',relative),summary:'Summary'},{locale:'en',origin:ORIGIN,workspaceId:WORKSPACE,source:{payload:chinese,workId:'work-synthetic-media',locale:'zh-CN',revision:2}});
  assert.deepEqual(english.media.map(item=>item.id),[first.id,second.id]);
  const unregistered='media-'+'d'.repeat(48);
  assert.throws(()=>notebookEdition({notebook:notebookWithImages('Synthetic English title',[relativeRaw(unregistered),relative[1]]),summary:'Summary'},{locale:'en',origin:ORIGIN,source:{payload:chinese}}),/请先导入图片/);
  assert.throws(()=>notebookEdition({notebook:notebookWithImages('Synthetic English title',[absoluteRaw(first.id,'https://evil.example'),relative[1]]),summary:'Summary'},{locale:'en',origin:ORIGIN,source:{payload:chinese}}),/请先导入图片/);
  assert.throws(()=>notebookEdition({notebook:notebookWithImages('Synthetic English title',['https://images.example/public.webp',relative[1]]),summary:'Summary'},{locale:'en',origin:ORIGIN,source:{payload:chinese},strictRegisteredImages:true}),/请先导入图片/);
  const rewritten=notebookEdition({notebook:notebookWithImages('Synthetic rewrite',[relative[0],'https://images.example/public.webp']),summary:'Summary'},{locale:'zh-CN',origin:ORIGIN,source:{payload:chinese}});
  assert.match(rewritten.bodyMarkdown,/images\.example\/public\.webp/);
  assert.equal(rewritten.media.some(item=>item.id===first.id),true);
});

test('prepareEditionMedia inherits registered relative refs with zero re-upload and rejects foreign Center-shaped URLs',async t=>{
  const home=await temp(t),job=join(home,'job');
  await mkdir(job,{recursive:true,mode:0o700});
  const first=await stageMedia({directory:join(home,'media'),origin:ORIGIN,workspaceId:WORKSPACE,bytes:await webpPixel('#467f65'),name:'one.webp'});
  const second=await stageMedia({directory:join(home,'media'),origin:ORIGIN,workspaceId:WORKSPACE,bytes:await webpPixel('#b54433'),name:'two.webp'});
  const chinese=notebookEdition({notebook:notebookWithImages('合成中文标题',[relativeRaw(first.id),relativeRaw(second.id)]),summary:'摘要'},{locale:'zh-CN',origin:ORIGIN,workspaceId:WORKSPACE});
  const english=notebookEdition({notebook:notebookWithImages('Synthetic English title',[relativeRaw(first.id),relativeRaw(second.id)]),summary:'Summary'},{locale:'en',origin:ORIGIN,source:{payload:chinese}});
  let fetches=0;
  const prepared=await prepareEditionMedia({edition:{...english,media:[]},home,directory:job,client:{origin:ORIGIN},workspaceId:WORKSPACE,source:chinese,fetchBytes:async()=>{fetches++;throw Error('must not fetch public bytes for registered media');}});
  assert.equal(fetches,0);
  assert.deepEqual(prepared.media.map(item=>item.id).sort(),[first.id,second.id].sort());
  protocol.edition({...prepared,locale:'en'});
  const evil={...english,bodyMarkdown:english.bodyMarkdown.replaceAll(ORIGIN,'https://evil.example')};
  await assert.rejects(prepareEditionMedia({edition:evil,home,directory:join(home,'evil'),client:{origin:ORIGIN},workspaceId:WORKSPACE,source:chinese}),{code:'media_ref_invalid'});
});

test('requireReusedTranslationImages treats relative and absolute trusted URLs as the same registered pair',()=>{
  const id='media-'+'e'.repeat(48),other='media-'+'f'.repeat(48);
  const asEdition=urls=>({metadata:{notebook:notebookWithImages('title',urls)}});
  const zh=asEdition([relativeRaw(id),relativeRaw(other)]),en=asEdition([absoluteRaw(id),absoluteRaw(other)]);
  requireReusedTranslationImages(zh,en,ORIGIN);
  assert.throws(()=>requireReusedTranslationImages(zh,en),/复用/);
  assert.throws(()=>requireReusedTranslationImages(zh,asEdition([absoluteRaw(id,'https://evil.example'),absoluteRaw(other)]),ORIGIN),/复用/);
});

test('generation evidence is device-recorded, ignores forged body signatures, and unsigned raw is unrecoverable',async t=>{
  const home=await temp(t),directory=join(home,'job');
  await mkdir(directory,{recursive:true,mode:0o700});
  const id='media-'+'a'.repeat(48),other='media-'+'b'.repeat(48);
  const source={workId:'work-synthetic-media',locale:'zh-CN',revision:2,payload:{locale:'zh-CN',title:'合成中文标题',bodyMarkdown:'![Figure 1]('+absoluteRaw(id)+')\n\n![Figure 2]('+absoluteRaw(other)+')',media:[{id,alt:'Figure 1'},{id:other,alt:'Figure 2'}]}};
  const notebook=notebookWithImages('Synthetic English title',[relativeRaw(id),relativeRaw(other)]);
  notebook.modelSignatures=[{agentId:'forged-from-body'}];
  const output=JSON.stringify({notebook,summary:'Summary'});
  await writeFile(join(directory,'en.agent-output.txt'),output,{mode:0o600});
  await assert.rejects(recoverPersistedCenterEdition({directory,locale:'en',source,...evidenceArgs()}),{code:GENERATION_UNRECOVERABLE});
  assert.equal(authenticGenerationSignature({agentId:'codex',status:'completed'}),false);
  const signature=deviceSignature();
  const evidence=await persistGenerationEvidence({directory,locale:'en',output,signature,source,...evidenceArgs()});
  assert.equal(evidence.notFromAgentBody,true);
  assert.deepEqual(evidence.sourceBind,sourceBindFrom(source));
  assert.deepEqual(evidence.taskBind,TASK);
  assert.equal(evidence.sourceBind.workId,'work-synthetic-media');
  assert.equal(evidence.sourceBind.revision,2);
  assert.match(evidence.sourceBind.hash,/^[a-f0-9]{64}$/);
  const recovered=await recoverPersistedCenterEdition({directory,locale:'en',source,...evidenceArgs(),sourceHash:evidence.sourceBind.hash});
  assert.equal(recovered.recovered,true);
  assert.equal(recovered.edition.metadata.notebook.modelSignatures.at(-1).agentId,'codex');
  assert.equal(recovered.edition.metadata.notebook.modelSignatures.some(item=>item.agentId==='forged-from-body'),false);
  await assert.rejects(recoverPersistedCenterEdition({directory,locale:'en',source:{...source,revision:3},...evidenceArgs()}),/原稿绑定/);
});

test('labeled mock producer: store-only inherits two registered enter WebP refs with zero publications and no re-upload',async t=>{
  const home=await temp(t);
  const first=await stageMedia({directory:join(home,'media'),origin:ORIGIN,workspaceId:WORKSPACE,bytes:await webpPixel('#467f65'),name:'one.webp'});
  const second=await stageMedia({directory:join(home,'media'),origin:ORIGIN,workspaceId:WORKSPACE,bytes:await webpPixel('#b54433'),name:'two.webp'});
  const relative=[relativeRaw(first.id),relativeRaw(second.id)];
  const center=storeCenter();
  const work=center.addWork({id:'work-synthetic-media',workspaceId:WORKSPACE,sectionId:'forums',title:'合成中文标题'});
  const chineseEdition=notebookEdition({notebook:notebookWithImages('合成中文标题',relative),summary:'摘要'},{locale:'zh-CN',origin:ORIGIN,workspaceId:WORKSPACE});
  center.putEdition(center.works.get(work.id),{locale:'zh-CN',revision:2,payload:{...chineseEdition,locale:'zh-CN'}});
  const live=center.client('device-a');
  const client=withRegisteredMedia(live,[first,second]);
  const queued=await enqueueStoreOnlyTranslate({client,workId:work.id,revision:2});
  let produced=0;
  const labeledMockProducer=async({locale,source,origin})=>{
    produced++;
    assert.equal(locale,'en');
    assert.equal(origin,ORIGIN);
    assert.equal(source.workId,'work-synthetic-media');
    assert.equal(source.revision,2);
    assert.equal(sourceBindFrom(source).hash,queued.sourceHash);
    return notebookEdition({notebook:notebookWithImages('Synthetic English title',relative),summary:'Summary'},{locale:'en',origin,workspaceId:WORKSPACE,source,signature:deviceSignature()});
  };
  const result=await runProductionTurn({client,home,agentId:'codex',workspaceIds:[WORKSPACE],sectionIds:['forums'],demandId:queued.id,storeOnly:true,producer:labeledMockProducer});
  assert.equal(produced,1);
  assert.equal(result.state,'accepted');
  assert.deepEqual(result.submissions[0].receipt.publicationIds,[]);
  assert.equal(client.uploads(),0);
  const packet=JSON.parse(await readFile(join(home,'jobs',(await readdir(join(home,'jobs')))[0],'en.packet.json'),'utf8'));
  assert.deepEqual(packet.editions[0].media.map(item=>item.id).sort(),[first.id,second.id].sort());
  protocol.edition(packet.editions[0]);
});

test('same-task resume recovers persisted evidence without re-running the labeled mock producer',async t=>{
  const home=await temp(t);
  const first=await stageMedia({directory:join(home,'media'),origin:ORIGIN,workspaceId:WORKSPACE,bytes:await webpPixel('#467f65'),name:'one.webp'});
  const second=await stageMedia({directory:join(home,'media'),origin:ORIGIN,workspaceId:WORKSPACE,bytes:await webpPixel('#b54433'),name:'two.webp'});
  const relative=[relativeRaw(first.id),relativeRaw(second.id)];
  const center=storeCenter();
  const work=center.addWork({id:'work-synthetic-resume',workspaceId:WORKSPACE,sectionId:'forums',title:'合成中文标题'});
  const chineseEdition=notebookEdition({notebook:notebookWithImages('合成中文标题',relative),summary:'摘要'},{locale:'zh-CN',origin:ORIGIN,workspaceId:WORKSPACE});
  center.putEdition(center.works.get(work.id),{locale:'zh-CN',revision:2,payload:{...chineseEdition,locale:'zh-CN'}});
  const live=center.client('device-a');
  const client=withRegisteredMedia(live,[first,second]);
  const queued=await enqueueStoreOnlyTranslate({client,workId:work.id,revision:2});
  let produced=0;
  const labeledMockProducer=async({locale,source,origin,directory,claim})=>{
    produced++;
    const notebookJson=notebookWithImages('Synthetic English title',relative);
    notebookJson.modelSignatures=[{agentId:'forged-from-body'}];
    const output=JSON.stringify({notebook:notebookJson,summary:'Summary'});
    await writeFile(join(directory,locale+'.agent-output.txt'),output,{mode:0o600});
    await persistGenerationEvidence({directory,locale,sectionId:claim.sectionId,origin,workspaceId:claim.workspaceId,output,signature:deviceSignature(),source,agentId:'codex',demandId:claim.id,generation:claim.generation,workerId:claim.workerId||claim.payload?.storeOnlyWorkerId});
    throw Error('crash after evidence before result.json');
  };
  await assert.rejects(runProductionTurn({client,home,agentId:'codex',workspaceIds:[WORKSPACE],sectionIds:['forums'],demandId:queued.id,storeOnly:true,producer:labeledMockProducer}),/crash after evidence/);
  assert.equal(produced,1);
  const job=join(home,'jobs',(await readdir(join(home,'jobs')))[0]);
  assert.match(await readFile(join(job,'en.agent-output.txt'),'utf8'),/Synthetic English title/);
  await assert.rejects(readFile(join(job,'en.result.json')));
  await assert.rejects(readFile(join(job,'en.packet.json')));
  const recovered=await runProductionTurn({client,home,agentId:'codex',workspaceIds:[WORKSPACE],sectionIds:['forums'],demandId:queued.id,storeOnly:true,resume:true,producer:async()=>{produced++;throw Error('must not re-run labeled mock producer');}});
  assert.equal(produced,1);
  assert.equal(recovered.state,'accepted');
  assert.deepEqual(recovered.submissions[0].receipt.publicationIds,[]);
  const edition=JSON.parse(await readFile(join(job,'en.result.json'),'utf8'));
  assert.equal(edition.metadata.notebook.modelSignatures.at(-1).agentId,'codex');
  assert.equal(edition.metadata.notebook.modelSignatures.some(item=>item.agentId==='forged-from-body'),false);
});

test('a malformed note wrapper resumes the original claim without another model run',async t=>{
  const home=await temp(t),center=storeCenter();
  const work=center.addWork({id:'work-note-resume',workspaceId:WORKSPACE,sectionId:'forums',title:'合成中文标题'});
  const chinese=notebookEdition({notebook:notebook(),summary:'摘要'},{locale:'zh-CN',origin:ORIGIN,workspaceId:WORKSPACE});
  center.putEdition(center.works.get(work.id),{locale:'zh-CN',revision:2,payload:{...chinese,locale:'zh-CN'}});
  const client=center.client('device-a'),queued=await enqueueStoreOnlyTranslate({client,workId:work.id,revision:2});
  let produced=0;const events=[];
  const producer=async({directory,locale,source,origin,claim})=>{
    produced++;
    const value=notebook();value.blockNotes.body={supplement:'A private note'};
    const output=JSON.stringify({notebook:value,summary:'Summary'});
    await writeFile(join(directory,locale+'.agent-output.txt'),output,{mode:0o600});
    await persistGenerationEvidence({directory,locale,sectionId:claim.sectionId,origin,workspaceId:claim.workspaceId,output,signature:deviceSignature(),source,agentId:'codex',demandId:claim.id,generation:claim.generation,workerId:claim.workerId||claim.payload?.storeOnlyWorkerId});
    return parseCenterEdition(output,{source,locale,origin,workspaceId:WORKSPACE,signature:deviceSignature()});
  };
  const options={client,home,agentId:'codex',workspaceIds:[WORKSPACE],sectionIds:['forums'],demandId:queued.id,storeOnly:true,producer,onEvent:event=>events.push(event)};
  await assert.rejects(runProductionTurn(options),/行间备注格式无效/);
  const result=await runProductionTurn({...options,resume:true});
  assert.equal(produced,1);assert.equal(result.state,'accepted');
  assert.equal(events.filter(event=>event.type==='notebook_repaired').length,1);
  const job=join(home,'jobs',(await readdir(join(home,'jobs')))[0]);
  const edition=JSON.parse(await readFile(join(job,'en.result.json'),'utf8'));
  assert.equal(edition.metadata.notebook.blockNotes.body.notes.supplement,'A private note');
  assert.equal(edition.metadata.notebook.modelSignatures.at(-1).runId,'run-synthetic-media');
});

test('unsigned retained raw fails closed as unrecoverable and does not re-run the model',async t=>{
  const home=await temp(t);
  const first=await stageMedia({directory:join(home,'media'),origin:ORIGIN,workspaceId:WORKSPACE,bytes:await webpPixel('#467f65'),name:'one.webp'});
  const second=await stageMedia({directory:join(home,'media'),origin:ORIGIN,workspaceId:WORKSPACE,bytes:await webpPixel('#b54433'),name:'two.webp'});
  const relative=[relativeRaw(first.id),relativeRaw(second.id)];
  const center=storeCenter();
  const work=center.addWork({id:'work-synthetic-unsigned',workspaceId:WORKSPACE,sectionId:'forums',title:'合成中文标题'});
  const chineseEdition=notebookEdition({notebook:notebookWithImages('合成中文标题',relative),summary:'摘要'},{locale:'zh-CN',origin:ORIGIN,workspaceId:WORKSPACE});
  center.putEdition(center.works.get(work.id),{locale:'zh-CN',revision:2,payload:{...chineseEdition,locale:'zh-CN'}});
  const live=center.client('device-a');
  const client=withRegisteredMedia(live,[first,second]);
  const queued=await enqueueStoreOnlyTranslate({client,workId:work.id,revision:2});
  let produced=0;
  await assert.rejects(runProductionTurn({client,home,agentId:'codex',workspaceIds:[WORKSPACE],sectionIds:['forums'],demandId:queued.id,storeOnly:true,producer:async({directory,locale})=>{
    produced++;
    await writeFile(join(directory,locale+'.agent-output.txt'),JSON.stringify({notebook:notebookWithImages('Synthetic English title',relative),summary:'Summary'}),{mode:0o600});
    throw Error('parse failed before evidence');
  }}),/parse failed before evidence/);
  assert.equal(produced,1);
  await assert.rejects(runProductionTurn({client,home,agentId:'codex',workspaceIds:[WORKSPACE],sectionIds:['forums'],demandId:queued.id,storeOnly:true,resume:true,producer:async()=>{produced++;throw Error('must not re-run labeled mock producer');}}),{code:GENERATION_UNRECOVERABLE});
  assert.equal(produced,1);
});

test('parseCenterEdition with origin accepts the diagnostic relative shape that publicUrl previously rejected',()=>{
  const id='media-'+'a'.repeat(48);
  const raw=JSON.stringify({notebook:notebookWithImages('Synthetic English title',[relativeRaw(id)]),summary:'Summary'});
  assert.throws(()=>parseCenterEdition(raw,{locale:'en'}),/请先导入图片/);
  const edition=parseCenterEdition(raw,{locale:'en',origin:ORIGIN,workspaceId:WORKSPACE});
  assert.equal(edition.media[0].id,id);
});

test('trusted Center origin comes from the client, not from model metadata or image hosts',()=>{
  const id='media-'+'a'.repeat(48);
  const raw=JSON.stringify({
    notebook:notebookWithImages('Synthetic English title',[relativeRaw(id)]),
    summary:'Summary',
    metadata:{origin:'https://evil.example',centerOrigin:'https://evil.example'},
  });
  const edition=parseCenterEdition(raw,{locale:'en',origin:ORIGIN,workspaceId:WORKSPACE});
  assert.match(edition.bodyMarkdown,new RegExp(ORIGIN.replace(/[.]/g,'\\.')));
  assert.doesNotMatch(edition.bodyMarkdown,/evil\.example/);
  assert.throws(()=>parseCenterEdition(JSON.stringify({notebook:notebookWithImages('Synthetic English title',[absoluteRaw(id,'https://evil.example')]),summary:'Summary'}),{locale:'en',origin:ORIGIN}),/请先导入图片/);
});

test('cross-workspace registered WebP IDs are not inherited on an enter source bind',async t=>{
  const home=await temp(t);
  const enter=await stageMedia({directory:join(home,'media'),origin:ORIGIN,workspaceId:WORKSPACE,bytes:await webpPixel('#467f65'),name:'enter.webp'});
  const other=await stageMedia({directory:join(home,'media'),origin:ORIGIN,workspaceId:WORKSPACE,bytes:await webpPixel('#2b6cb0'),name:'enter-two.webp'});
  const pets=await stageMedia({directory:join(home,'media'),origin:ORIGIN,workspaceId:'pets',bytes:await webpPixel('#b54433'),name:'pets.webp'});
  const chinese=notebookEdition({notebook:notebookWithImages('合成中文标题',[relativeRaw(enter.id),relativeRaw(other.id)]),summary:'摘要'},{locale:'zh-CN',origin:ORIGIN,workspaceId:WORKSPACE});
  assert.throws(()=>notebookEdition({notebook:notebookWithImages('Synthetic English title',[relativeRaw(pets.id),relativeRaw(other.id)]),summary:'Summary'},{locale:'en',origin:ORIGIN,source:{payload:chinese}}),/请先导入图片/);
  const english=notebookEdition({notebook:notebookWithImages('Synthetic English title',[relativeRaw(enter.id),relativeRaw(other.id)]),summary:'Summary'},{locale:'en',origin:ORIGIN,source:{payload:chinese}});
  await assert.rejects(prepareEditionMedia({
    edition:{...english,bodyMarkdown:english.bodyMarkdown.replaceAll(enter.id,pets.id),media:[]},
    home,directory:join(home,'job'),client:{origin:ORIGIN},workspaceId:WORKSPACE,source:chinese,
    fetchBytes:async()=>{throw Error('must not fetch');},
  }),{code:'media_ref_invalid'});
});

test('tampered, truncated, replayed, or incomplete evidence is unrecoverable and does not re-run the model',async t=>{
  const home=await temp(t),directory=join(home,'job');
  await mkdir(directory,{recursive:true,mode:0o700});
  const id='media-'+'a'.repeat(48),other='media-'+'b'.repeat(48);
  const source={workId:'work-synthetic-media',locale:'zh-CN',revision:2,payload:{locale:'zh-CN',title:'合成中文标题',bodyMarkdown:'![Figure 1]('+absoluteRaw(id)+')\n\n![Figure 2]('+absoluteRaw(other)+')',media:[{id,alt:'Figure 1'},{id:other,alt:'Figure 2'}]}};
  const output=JSON.stringify({notebook:notebookWithImages('Synthetic English title',[relativeRaw(id),relativeRaw(other)]),summary:'Summary'});
  const signature=deviceSignature();
  await writeFile(join(directory,'en.agent-output.txt'),output,{mode:0o600});
  const evidence=await persistGenerationEvidence({directory,locale:'en',output,signature,source,...evidenceArgs()});
  const file=join(directory,'en.generation-evidence.json');
  const mutate=async patch=>{await writeFile(file,JSON.stringify({...evidence,...patch},null,2)+'\n');};
  await mutate({outputSha256:protocol.hash('tampered')});
  await assert.rejects(recoverPersistedCenterEdition({directory,locale:'en',source,...evidenceArgs()}),{code:GENERATION_UNRECOVERABLE});
  await mutate({taskBind:{...TASK,demandId:'demand-other-job'}});
  await assert.rejects(recoverPersistedCenterEdition({directory,locale:'en',source,...evidenceArgs()}),{code:GENERATION_UNRECOVERABLE});
  await writeFile(file,JSON.stringify(evidence,null,2)+'\n');
  await assert.rejects(recoverPersistedCenterEdition({directory,locale:'en',source,...evidenceArgs(),demandId:'demand-other-job'}),{code:GENERATION_UNRECOVERABLE});
  await assert.rejects(recoverPersistedCenterEdition({directory,locale:'en',source,...evidenceArgs(),generation:2}),{code:GENERATION_UNRECOVERABLE});
  await assert.rejects(recoverPersistedCenterEdition({directory,locale:'en',source,...evidenceArgs(),workerId:'device-b'}),{code:GENERATION_UNRECOVERABLE});
  await writeFile(join(directory,'en.agent-output.txt'),output.slice(0,40),{mode:0o600});
  await assert.rejects(recoverPersistedCenterEdition({directory,locale:'en',source,...evidenceArgs()}),{code:GENERATION_UNRECOVERABLE});
  await writeFile(join(directory,'en.agent-output.txt'),output,{mode:0o600});
  await writeFile(file,'{"kind":"center-generation-evidence","version":1',{mode:0o600});
  await assert.rejects(recoverPersistedCenterEdition({directory,locale:'en',source,...evidenceArgs()}),{code:GENERATION_UNRECOVERABLE});
  await rm(file,{force:true});
  await writeFile(join(directory,'en.agent-output.txt'),output,{mode:0o600});
  await writeFile(join(directory,'en.image-plan.json'),JSON.stringify({version:1,draft:{notebook:{version:2}}})+'\n');
  const deferred=await recoverPersistedCenterEdition({directory,locale:'en',source,...evidenceArgs()});
  assert.equal(deferred.recovered,false);assert.equal(deferred.edition,null);
});

test('existing result.json and packet.json resume without re-running the labeled mock producer',async t=>{
  const home=await temp(t);
  const first=await stageMedia({directory:join(home,'media'),origin:ORIGIN,workspaceId:WORKSPACE,bytes:await webpPixel('#467f65'),name:'one.webp'});
  const second=await stageMedia({directory:join(home,'media'),origin:ORIGIN,workspaceId:WORKSPACE,bytes:await webpPixel('#b54433'),name:'two.webp'});
  const relative=[relativeRaw(first.id),relativeRaw(second.id)];
  const center=storeCenter();
  const work=center.addWork({id:'work-synthetic-result',workspaceId:WORKSPACE,sectionId:'forums',title:'合成中文标题'});
  const chineseEdition=notebookEdition({notebook:notebookWithImages('合成中文标题',relative),summary:'摘要'},{locale:'zh-CN',origin:ORIGIN,workspaceId:WORKSPACE});
  center.putEdition(center.works.get(work.id),{locale:'zh-CN',revision:2,payload:{...chineseEdition,locale:'zh-CN'}});
  const client=withRegisteredMedia(center.client('device-a'),[first,second]);
  const queued=await enqueueStoreOnlyTranslate({client,workId:work.id,revision:2});
  let produced=0;
  const labeledMockProducer=async({locale,source,origin,directory})=>{
    produced++;
    const edition=notebookEdition({notebook:notebookWithImages('Synthetic English title',relative),summary:'Summary'},{locale:'en',origin,workspaceId:WORKSPACE,source,signature:deviceSignature()});
    await writeFile(join(directory,locale+'.result.json'),JSON.stringify(edition));
    throw Error('crash after result.json before packet');
  };
  await assert.rejects(runProductionTurn({client,home,agentId:'codex',workspaceIds:[WORKSPACE],sectionIds:['forums'],demandId:queued.id,storeOnly:true,producer:labeledMockProducer}),/crash after result/);
  assert.equal(produced,1);
  const recovered=await runProductionTurn({client,home,agentId:'codex',workspaceIds:[WORKSPACE],sectionIds:['forums'],demandId:queued.id,storeOnly:true,resume:true,producer:async()=>{produced++;throw Error('must not re-run labeled mock producer');}});
  assert.equal(produced,1);
  assert.equal(recovered.state,'accepted');
  assert.deepEqual(recovered.submissions[0].receipt.publicationIds,[]);
  const again=await runProductionTurn({client,home,agentId:'codex',workspaceIds:[WORKSPACE],sectionIds:['forums'],demandId:queued.id,storeOnly:true,resume:true,producer:async()=>{produced++;throw Error('must not re-run labeled mock producer');}});
  assert.equal(produced,1);
  assert.equal(again.state,'accepted');
  assert.deepEqual(again.submissions[0].receipt.publicationIds,[]);
});

test('worker resume after evidence tamper or cross-job replay does not re-run the model',async t=>{
  const home=await temp(t);
  const first=await stageMedia({directory:join(home,'media'),origin:ORIGIN,workspaceId:WORKSPACE,bytes:await webpPixel('#467f65'),name:'one.webp'});
  const second=await stageMedia({directory:join(home,'media'),origin:ORIGIN,workspaceId:WORKSPACE,bytes:await webpPixel('#b54433'),name:'two.webp'});
  const relative=[relativeRaw(first.id),relativeRaw(second.id)];
  const center=storeCenter();
  const work=center.addWork({id:'work-synthetic-tamper',workspaceId:WORKSPACE,sectionId:'forums',title:'合成中文标题'});
  const chineseEdition=notebookEdition({notebook:notebookWithImages('合成中文标题',relative),summary:'摘要'},{locale:'zh-CN',origin:ORIGIN,workspaceId:WORKSPACE});
  center.putEdition(center.works.get(work.id),{locale:'zh-CN',revision:2,payload:{...chineseEdition,locale:'zh-CN'}});
  const client=withRegisteredMedia(center.client('device-a'),[first,second]);
  const queued=await enqueueStoreOnlyTranslate({client,workId:work.id,revision:2});
  let produced=0;
  await assert.rejects(runProductionTurn({client,home,agentId:'codex',workspaceIds:[WORKSPACE],sectionIds:['forums'],demandId:queued.id,storeOnly:true,producer:async({directory,locale,source,origin,claim})=>{
    produced++;
    const output=JSON.stringify({notebook:notebookWithImages('Synthetic English title',relative),summary:'Summary'});
    await writeFile(join(directory,locale+'.agent-output.txt'),output,{mode:0o600});
    await persistGenerationEvidence({directory,locale,sectionId:claim.sectionId,origin,workspaceId:claim.workspaceId,output,signature:deviceSignature(),source,agentId:'codex',demandId:claim.id,generation:claim.generation,workerId:claim.workerId||claim.payload?.storeOnlyWorkerId});
    throw Error('crash after evidence');
  }}),/crash after evidence/);
  assert.equal(produced,1);
  const job=join(home,'jobs',(await readdir(join(home,'jobs')))[0]);
  const file=join(job,'en.generation-evidence.json');
  const evidence=JSON.parse(await readFile(file,'utf8'));
  evidence.outputSha256=protocol.hash('cross-job-or-tamper');
  await writeFile(file,JSON.stringify(evidence,null,2)+'\n');
  await assert.rejects(runProductionTurn({client,home,agentId:'codex',workspaceIds:[WORKSPACE],sectionIds:['forums'],demandId:queued.id,storeOnly:true,resume:true,producer:async()=>{produced++;throw Error('must not re-run labeled mock producer');}}),{code:GENERATION_UNRECOVERABLE});
  assert.equal(produced,1);
});

