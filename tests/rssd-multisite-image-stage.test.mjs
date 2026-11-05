import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createScopedWorkModeAdapter} from '../scripts/rssd-multisite-work-mode.mjs';
import {slotsForDay} from '../scripts/rssd-multisite-scheduler.mjs';
import {createCursorGalleryImageStage,createCursorGalleryImageStageFactory} from '../scripts/rssd-cursor-gallery-image-stage.mjs';
const plan={version:1,timezone:'Asia/Shanghai',sites:[{siteId:'one',sections:[{sectionId:'news',verified:true,dailyLimit:1,contentMode:'news',requireFlow:true,requiredLocales:['zh-CN'],slots:[{id:'morning',time:'08:00',count:1}]}]}]};
const profiles=[{id:'one',spaceId:'space-one'}],configs=[{siteId:'one',workspaceId:'space-one',sectionId:'news',destinationId:'site-one',enabled:true,verified:true,requiredLocales:['zh-CN'],maxDelayMinutes:120}];
test('scoped work explicitly injects matching image stage without exposing claim token to its factory',async t=>{
 const home=await mkdtemp(join(tmpdir(),'rssd-image-adapter-'));t.after(()=>rm(home,{recursive:true,force:true}));const [slot]=slotsForDay(plan,configs,{profiles,now:Date.parse('2026-11-02T00:00:00Z')});let got;
 const imageStage={origin:'https://center.example',prepare:async()=>[]},imageStageFactory=async input=>{got=input;return imageStage;};
 const producer=async(args,deps)=>{assert.equal(deps.imageStage,imageStage);assert.equal(args.claim.claimToken,'private-token');assert.equal(args.writingSkillScope.siteId,'one');return {};};
 const turn=async({producer,productionScope})=>{assert.equal(productionScope.imagePlanRequired,true);await producer({claim:{id:slot.id,claimToken:'private-token'},imagePlanRequired:true});return {state:'blocked'};};
 const adapter=createScopedWorkModeAdapter({client:{origin:'https://center.example'},home,plan,configs,profiles,ready:async()=>({ready:true}),producer,turn,imageStageFactory});
 assert.equal((await adapter({slot})).state,'blocked');assert.deepEqual(got,{siteId:'one',workspaceId:'space-one',sectionId:'news',jobId:slot.id});assert.doesNotMatch(JSON.stringify(got),/private-token/);
});
test('missing independent original-image rights dependencies blocks before opening a gallery',async t=>{
 const home=await mkdtemp(join(tmpdir(),'rssd-image-no-rights-'));t.after(()=>rm(home,{recursive:true,force:true}));const stage=createCursorGalleryImageStage({client:{origin:'https://center.example'},home,workspaceId:'space-one',jobId:'job-one',reference:{bytes:Buffer.from('fixture')}});
 await assert.rejects(stage.prepare({plan:{claimId:'job-one',slots:[{blockId:'hero'}]},directory:home}),{code:'image_pending'});
});
test('real image factory requires pinned runtime and explicit approved reference resolver',()=>{
 assert.throws(()=>createCursorGalleryImageStageFactory({client:{origin:'https://center.example'},home:'/tmp'}),/Pinned Cursor runtime/);
});

test('original-source search failure never falls through to image generation',async t=>{
 const {mkdir,realpath}=await import('node:fs/promises'),{inspectCursorGalleryOrphan}=await import('../scripts/rssd-cursor-bridge-lifecycle.mjs');
 const root=await realpath(await mkdtemp(join(tmpdir(),'rssd-source-first-'))),home=join(root,'host'),job=join(root,'job');t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(home,{mode:0o700});await mkdir(job,{mode:0o700});let reviews=0;
 const stage=createCursorGalleryImageStage({client:{origin:'https://center.example'},home,workspaceId:'space-one',jobId:'job-one',galleryRoot:root,bridgeOptions:{mode:'fixture',enabled:true,fixtureCommand:{command:process.execPath,args:[join(process.cwd(),'tests/fixtures/rssd-cursor-bridge/synthetic-bridge.cjs')]}},reference:{bytes:Buffer.from('fixture')},originalSource:{search:async()=>{throw Error('offline');},review:async()=>{reviews++;},registrar:{start:async()=>assert.fail(),lookup:async()=>assert.fail()}}});
 const slot={blockId:'hero',requirement:'synthetic image',alt:'一张用于测试的八乘八像素合成图片不代表任何真实研究',caption:'示意图'};
 await assert.rejects(stage.prepare({plan:{claimId:'job-one',slots:[slot]},directory:job}),{code:'image_pending'});assert.equal(reviews,0);const state=await inspectCursorGalleryOrphan(root);assert.equal(state.phase,'closed');assert.deepEqual(state.tasks,[]);
});
