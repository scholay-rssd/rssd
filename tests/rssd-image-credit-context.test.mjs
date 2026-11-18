import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import protocol from '../contracts/rssd-v1.cjs';
import {imageCreditContext,validateReusedImageCredits} from '../scripts/rssd-image-credit-context.mjs';
import {bindImagePlan,freezeImagePlan} from '../scripts/rssd-image-plan.mjs';
import {captureTaskSourceSnapshot,verifyEditionSourceSnapshot} from '../scripts/rssd-source-snapshot.mjs';
import {notebookMarkdown} from '../desktop/scripts/agent/notebook.mjs';
import {imageTranslationInstructions,orderedOriginalImages} from '../scripts/rssd-image-translation-prompt.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const alt='一张用于测试的合成图片并不表示任何真实研究或实验';
test('only the original licensed image caption receives its independently evidenced links',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'image-credit-context-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const claim={id:'claim-one',generation:1,workspaceId:'metho'},client={origin:'https://center.example'},articleUrl='https://papers.example/original',sourceUrl='https://rights.example/image',licenseUrl='https://creativecommons.org/licenses/by/4.0/';
 const slots=['hero','method'].map(blockId=>({blockId,requirement:'Synthetic diagram',alt,caption:'Synthetic caption'}));
 const notebook={version:2,kind:'article',title:'Fixture',skills:[],fields:{},groups:[],sources:[{id:'s1',title:'Source',url:articleUrl}],blockNotes:{},internalNotes:{},blocks:[{id:'body',type:'paragraph',state:'ready',text:'Verified body.',sourceIds:['s1']},...slots.flatMap(s=>[{id:s.blockId,type:'image',state:'placeholder',text:'',sourceIds:[]},{id:s.blockId+'-caption',type:'annotation',role:'caption',targetId:s.blockId,state:'placeholder',text:'',sourceIds:[]}])]};
 const plan=await freezeImagePlan({directory,claimId:claim.id,generation:1,workId:'work-one',locale:'zh-CN',result:{notebook,summary:'x',metadata:{},imagePlan:slots}});
 const bytes=Buffer.from('synthetic private image evidence'),digest=hash(bytes),manifest={sha256:digest,mime:'image/png',bytes:bytes.length,path:'/article-media/'+digest+'.png'};
 const scope={origin:client.origin,workspaceId:'metho',jobId:claim.id,blockId:'hero',requirement:slots[0].requirement,alt,caption:slots[0].caption},requestId='image-'+protocol.hash(scope).slice(0,48);
 const evidence={rightsVerified:true,thirdPartyExcluded:true,intendedUse:'commercial-web',sourceUrl,imageUrl:'https://rights.example/image.png',evidenceUrl:sourceUrl,creator:'A. Author',license:'CC BY 4.0',licenseUrl,quote:'Synthetic independent rights declaration',sourceSha256:'c'.repeat(64),imageSha256:digest};
 const reviewedBy='independent-fixture',reviewedAt='2026-11-03T00:00:00Z',registration={assetId:'asset-one',taskId:'task-one',sha256:digest};
 const provenance={kind:'licensed-source',sourceUrl,creator:evidence.creator,license:evidence.license,licenseUrl,changes:'unchanged',licenseEvidence:{url:sourceUrl,sha256:evidence.sourceSha256,quote:evidence.quote,reviewedBy,reviewedAt}};
 const original={requestId,blockId:'hero',id:'media-one',url:client.origin+'/api/rssd/v1/media/media-one/raw',manifest,alt,caption:slots[0].caption,registration,provenance};
 const other={requestId:'image-other',blockId:'method',id:'media-two',url:client.origin+'/api/rssd/v1/media/media-two/raw',manifest,alt,caption:slots[1].caption,registration,provenance:{kind:'generated'}};
 const images=[{...original,uploaded:true},{...other,uploaded:true}],receipt={version:1,planHash:protocol.hash(plan),origin:client.origin,workspaceId:'metho',images};
 const stagingDir=join(directory,'image-staging'),originalDir=join(directory,'cursor-gallery','original-first',protocol.hash(requestId));await mkdir(stagingDir,{recursive:true});await mkdir(originalDir,{recursive:true});
 const save=async(path,x)=>writeFile(path,JSON.stringify(x),{mode:0o600});
 await save(join(directory,'zh-CN.image-receipt.json'),receipt);
 const staging={version:1,scope,requestId,status:'staged',manifest,result:original};await save(join(stagingDir,protocol.hash([claim.id,'hero'])+'.json'),staging);
 const state={version:1,requestId,scopeHash:protocol.hash(scope),phase:'ready',evidence,reviewedBy,reviewedAt,manifest,registration};await save(join(originalDir,'state.json'),{...state,stateHash:protocol.hash(state)});await writeFile(join(originalDir,'source.image'),bytes,{mode:0o600});
 const bound=bindImagePlan({plan,images,origin:client.origin}),n=bound.notebook,edition={locale:'zh-CN',bodyMarkdown:notebookMarkdown(n,{site:null,locale:'zh-CN'}),sources:n.sources.map(({title,url})=>({title,url})),metadata:{notebook:n}};
 assert.equal(plan.version,4);const shortCredit=' A. Author, [rights.example]('+sourceUrl+')',longCredit=' · Source: A. Author ([source]('+sourceUrl+')); license: [CC BY 4.0]('+licenseUrl+'); unchanged original image';
 assert.equal(n.blocks.find(b=>b.id==='hero-caption').text,'Synthetic caption。A. Author，[rights.example]('+sourceUrl+')');
 assert.match(n.blockNotes.hero.notes.images,/许可：CC BY 4\.0（https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/）；改动：原图未修改。$/);
 const instructions=imageTranslationInstructions({edition,images,captionVersion:plan.version});assert(instructions.includes(JSON.stringify(shortCredit).slice(1,-1)));assert(!instructions.includes(licenseUrl));assert.doesNotMatch(instructions,/unchanged original image/);assert.match(instructions,/"requiredCaptionSuffix":" AI-generated illustration"/);
 // A plan frozen before version 4 keeps the long suffix its captions were written with.
 const legacyInstructions=imageTranslationInstructions({edition,images});assert.match(legacyInstructions,/Source: A\. Author/);assert(legacyInstructions.includes(licenseUrl));assert.match(legacyInstructions,/unchanged original image/);assert.match(instructions,/"originalBlockId":"hero"/);assert.match(instructions,/"originalBlockId":"method"/);
 const sourceText='Original source body. '.repeat(20),snapshot=await captureTaskSourceSnapshot({jobDirectory:directory,binding:{claimId:claim.id,generation:1,workspaceId:'metho',sectionId:'methods',demandHash:'d'.repeat(64)},verifiedSources:[{title:'Source',url:articleUrl,verified:true,verifiedTextSha256:hash(sourceText)}],fetchPage:async url=>({reachable:true,originalUrl:url,finalUrl:url,contentType:'text/plain',text:sourceText}),assessAccess:async()=>({readable:true,coverage:'full_text',reason:'Verified source'})});
 assert.throws(()=>verifyEditionSourceSnapshot({edition,snapshot}),/without verified source/);
 const context=await imageCreditContext({directory,claim,client,edition});assert.deepEqual(context.authorizedContextLinks.map(link=>link.url),[sourceUrl]);assert.equal(verifyEditionSourceSnapshot({edition,snapshot,...context}).ok,true);
 const english=structuredClone(edition);english.locale='en';const enBlocks=english.metadata.notebook.blocks;
 enBlocks.find(b=>b.id==='hero-caption').text='Figure: a label.'+shortCredit;
 enBlocks.find(b=>b.id==='method-caption').text='Figure: a method. AI-generated illustration';english.bodyMarkdown=notebookMarkdown(english.metadata.notebook,{site:null,locale:'en'});
 const version={captionVersion:plan.version};validateReusedImageCredits({edition:english,images,...version});
 assert.throws(()=>validateReusedImageCredits({edition:english,images}),{code:'image_pending'});
 {const legacy=structuredClone(english);legacy.metadata.notebook.blocks.find(b=>b.id==='hero-caption').text='A descriptive figure'+longCredit;legacy.metadata.notebook.blocks.find(b=>b.id==='method-caption').text='A figure · AI-generated illustration';validateReusedImageCredits({edition:legacy,images});assert.throws(()=>validateReusedImageCredits({edition:legacy,images,...version}),{code:'image_pending'});}
 const englishContext=await imageCreditContext({directory,claim,client,edition:english});assert.equal(verifyEditionSourceSnapshot({edition:english,snapshot,...englishContext}).ok,true);
 // Receipt order may differ from notebook order. Derive without modifying it.
 const reverseImages=[...images].reverse(),reversedReceipt={...receipt,images:reverseImages};await save(join(directory,'zh-CN.image-receipt.json'),reversedReceipt);
 const instructionsReversed=imageTranslationInstructions({edition,images:reverseImages});assert(instructionsReversed.indexOf('\"originalBlockId\":\"hero\"')<instructionsReversed.indexOf('\"originalBlockId\":\"method\"'));
 assert.deepEqual(orderedOriginalImages({edition,images:reverseImages}).map(x=>x.blockId),['hero','method']);assert.deepEqual(reverseImages.map(x=>x.blockId),['method','hero']);
 const reversedContext=await imageCreditContext({directory,claim,client,edition:english});assert.equal(verifyEditionSourceSnapshot({edition:english,snapshot,...reversedContext}).ok,true);
 await save(join(directory,'zh-CN.image-receipt.json'),receipt);
 for(const edit of [s=>s.replace('A. Author','Another Author'),s=>s+' CC BY 4.0',s=>s.replace('[rights.example]('+sourceUrl+')','rights.example'),s=>s.replace(sourceUrl,'https://rights.example/other'),s=>'Cropped image'+s]){
  const bad=structuredClone(english),caption=bad.metadata.notebook.blocks.find(b=>b.id==='hero-caption');caption.text=edit(caption.text);assert.throws(()=>validateReusedImageCredits({edition:bad,images,...version}),{code:'image_pending'});
 }
 const missingAI=structuredClone(english);missingAI.metadata.notebook.blocks.find(b=>b.id==='method-caption').text='An illustration';assert.throws(()=>validateReusedImageCredits({edition:missingAI,images,...version}),{code:'image_pending'});
 const illicit=structuredClone(edition);illicit.metadata.notebook.blocks.find(x=>x.id==='body').text+=' [unrelated]('+licenseUrl+')';illicit.bodyMarkdown=notebookMarkdown(illicit.metadata.notebook,{site:null,locale:'zh-CN'});assert.throws(()=>verifyEditionSourceSnapshot({edition:illicit,snapshot,...context}),/without verified source/);
 const bodyOnly=structuredClone(edition);bodyOnly.bodyMarkdown='[unexpected]('+licenseUrl+')\n\n'+bodyOnly.bodyMarkdown;assert.throws(()=>verifyEditionSourceSnapshot({edition:bodyOnly,snapshot,...context}),/does not match/);
 // Distinct licensed slots can legitimately share the same media URL. Each
 // caption must receive its own rights context, rather than the first match.
 const scope2={...scope,blockId:'method',requirement:slots[1].requirement,caption:slots[1].caption},requestId2='image-'+protocol.hash(scope2).slice(0,48),registration2={...registration,taskId:'task-two'};
 const second={...original,requestId:requestId2,blockId:'method',caption:slots[1].caption,registration:registration2};
 const duplicateImages=[{...original,uploaded:true},{...second,uploaded:true}],duplicateReceipt={...receipt,images:[...duplicateImages].reverse()};
 const originalDir2=join(directory,'cursor-gallery','original-first',protocol.hash(requestId2));await mkdir(originalDir2,{recursive:true});
 await save(join(stagingDir,protocol.hash([claim.id,'method'])+'.json'),{version:1,scope:scope2,requestId:requestId2,status:'staged',manifest,result:second});
 const state2={...state,requestId:requestId2,scopeHash:protocol.hash(scope2),registration:registration2};await save(join(originalDir2,'state.json'),{...state2,stateHash:protocol.hash(state2)});await writeFile(join(originalDir2,'source.image'),bytes,{mode:0o600});
 await save(join(directory,'zh-CN.image-receipt.json'),duplicateReceipt);
 const duplicateNotebook=bindImagePlan({plan,images:duplicateImages,origin:client.origin}).notebook,duplicateEdition={...edition,bodyMarkdown:notebookMarkdown(duplicateNotebook,{site:null,locale:'zh-CN'}),metadata:{notebook:duplicateNotebook}};
 const duplicateContext=await imageCreditContext({directory,claim,client,edition:duplicateEdition});assert.deepEqual([...new Set(duplicateContext.authorizedContextLinks.map(x=>x.blockId))],['hero-caption','method-caption']);assert.equal(verifyEditionSourceSnapshot({edition:duplicateEdition,snapshot,...duplicateContext}).ok,true);
 await save(join(directory,'zh-CN.image-receipt.json'),receipt);
 await save(join(originalDir,'state.json'),{...state,evidence:{...evidence,creator:'Forged'},stateHash:protocol.hash(state)});await assert.rejects(imageCreditContext({directory,claim,client,edition}),{code:'image_pending'});
 await save(join(originalDir,'state.json'),{...state,stateHash:protocol.hash(state)});await rm(join(originalDir,'source.image'));await assert.rejects(imageCreditContext({directory,claim,client,edition}),{code:'image_pending'});
});


test('each translated image slot is checked even when multiple slots use the same media URL',()=>{
 const url='https://center.example/api/rssd/v1/media/media-one/raw';
 const disclosures={'zh-CN':'Scholay 原创手绘示意（AI 辅助生成）',en:'Scholay original illustration (AI-generated)'};
 const images=[{blockId:'hero',url,provenance:{kind:'generated',disclosures}},{blockId:'method',url,provenance:{kind:'generated',disclosures}}];
 const blocks=[{id:'en-hero',type:'image',state:'ready',text:url},{id:'cap-a',type:'annotation',role:'caption',targetId:'en-hero',state:'ready',text:'First figure · Scholay original illustration (AI-generated)'},{id:'en-method',type:'image',state:'ready',text:url},{id:'cap-b',type:'annotation',role:'caption',targetId:'en-method',state:'ready',text:'Second figure omits disclosure'}];
 const edition={metadata:{notebook:{blocks}}};
 assert.throws(()=>validateReusedImageCredits({edition,images}),{code:'image_pending'});
 blocks[3].text='Second figure · Scholay original illustration (AI-generated)';assert.doesNotThrow(()=>validateReusedImageCredits({edition,images}));
 blocks[3].text='Not AI-generated · Scholay original illustration (AI-generated)';assert.throws(()=>validateReusedImageCredits({edition,images}),{code:'image_pending'});
 blocks[3].text='Second figure · AI-generated illustration';assert.throws(()=>validateReusedImageCredits({edition,images}),{code:'image_pending'});
 blocks[3].text='Second figure · Scholay original illustration (AI-generated)';blocks[2].text='https://center.example/api/rssd/v1/media/other/raw';assert.throws(()=>validateReusedImageCredits({edition,images}),{code:'image_pending'});
});
