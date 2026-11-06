import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CENTER_IMAGE_PLAN_OUTPUT,freezeImagePlan,bindImagePlan} from '../scripts/rssd-image-plan.mjs';
import {notebookEdition} from '../desktop/scripts/agent/center-notebook.mjs';
const alt='一张用于测试的八乘八像素合成图片不代表任何真实研究';
function draft(){const slots=['hero','body-image'].map(blockId=>({blockId,requirement:'Synthetic shapes',alt,caption:'AI 生成示意图'}));return {summary:'Summary',metadata:{},imagePlan:slots,notebook:{version:2,kind:'article',title:'Fixture',skills:[],fields:{},sources:[],blockNotes:{body:{notes:{supplement:'Private existing'}}},internalNotes:{verification:'Private check'},blocks:[{id:'body',type:'paragraph',state:'ready',text:'Public body',sourceIds:[]},...slots.flatMap(s=>[{id:s.blockId,type:'image',state:'placeholder',text:'',sourceIds:[]},{id:s.blockId+'-caption',type:'annotation',role:'caption',targetId:s.blockId,state:'placeholder',text:'',sourceIds:[]}])]}};}
test('image plan prompt requires each caption to immediately follow its image',()=>assert.match(CENTER_IMAGE_PLAN_OUTPUT,/紧接对应图片行[\s\S]*图片和图注之间不要插入其他行/));
test('frozen image plan preserves body and binds only all uploaded registered slots before notebook validation',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'rssd-image-plan-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const x={directory,claimId:'claim-1',generation:0,workId:'work-1',locale:'zh-CN',result:draft()};
 assert.throws(()=>notebookEdition(x.result),/未完成/);
 const plan=await freezeImagePlan(x);assert.deepEqual(await freezeImagePlan(x),plan);
 const image=slot=>({blockId:slot.blockId,id:'media-'+slot.blockId,url:'https://center.example/api/rssd/v1/media/media-'+slot.blockId+'/raw',alt:slot.alt,caption:slot.caption,uploaded:true,manifest:{sha256:'a'.repeat(64)},registration:{taskId:'task-1'},provenance:{kind:'generated'}});
 const images=plan.slots.map(image);
 assert.throws(()=>bindImagePlan({plan,images:images.slice(0,1),origin:'https://center.example'}),/missing/);
 assert.throws(()=>bindImagePlan({plan,images:[images[0],{...images[1],uploaded:false}],origin:'https://center.example'}),/not been uploaded/);
 const bound=bindImagePlan({plan,images,origin:'https://center.example'}),edition=notebookEdition(bound,{sectionId:'methods',locale:'zh-CN'});
 assert.equal(bound.notebook.blocks[0].text,'Public body');assert.equal(bound.notebook.blockNotes.body.notes.supplement,'Private existing');assert.equal(bound.notebook.internalNotes.verification,'Private check');
 assert.match(edition.bodyMarkdown,/!\[/);assert.doesNotMatch(edition.bodyMarkdown,/Private existing|Private check/);assert.ok(edition.metadata.notebookBodyHash);
 assert.equal(edition.media.length,2);assert.equal(edition.media[0].id,images[0].id);
 await assert.rejects(freezeImagePlan({...x,result:{...draft(),summary:'Different'}}),/different content/);
});
test('fake image URLs and non-image placeholders cannot enter the plan',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'rssd-image-plan-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const x={directory,claimId:'claim-1',generation:0,workId:'work-1',locale:'zh-CN',result:draft()};x.result.notebook.blocks[1].text='https://invented.example/image.png';
 await assert.rejects(freezeImagePlan(x),/slot or caption/);
});
test('public captions distinguish AI images and independently evidenced originals',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'rssd-image-credit-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const result=draft();for(const slot of result.imagePlan)slot.caption='说明画面内容';
 const plan=await freezeImagePlan({directory,claimId:'claim-credit',generation:0,workId:'work-credit',locale:'zh-CN',result});
 const image=(slot,provenance)=>({blockId:slot.blockId,id:'media-'+slot.blockId,url:'https://center.example/api/rssd/v1/media/media-'+slot.blockId+'/raw',alt:slot.alt,caption:slot.caption,uploaded:true,manifest:{sha256:'a'.repeat(64)},registration:{taskId:'task-1'},provenance});
 const generated=image(plan.slots[0],{kind:'generated'}),source=image(plan.slots[1],{kind:'licensed-source',creator:'Example Author',sourceUrl:'https://rights.example/original',license:'CC BY 4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/',changes:'unchanged',licenseEvidence:{url:'https://rights.example/original',sha256:'c'.repeat(64),quote:'Synthetic verified declaration',reviewedBy:'fixture reviewer',reviewedAt:'2026-11-03T00:00:00Z'}});
 const bound=bindImagePlan({plan,images:[generated,source],origin:'https://center.example'}),body=notebookEdition(bound,{sectionId:'methods',locale:'zh-CN'}).bodyMarkdown;
 assert.match(body,/AI 生成示意图/);assert.match(body,/Example Author/);assert.match(body,/https:\/\/rights\.example\/original/);assert.match(body,/CC BY 4\.0/);assert.match(body,/原图未修改/);
 assert.equal(plan.slots[0].caption,'说明画面内容');assert.equal(plan.draft.notebook.blocks[2].text,'');
 assert.throws(()=>bindImagePlan({plan,images:[generated,{...source,provenance:{...source.provenance,licenseEvidence:null}}],origin:'https://center.example'}),{code:'image_pending'});
});
test('legacy frozen plan preserves original caption and exact recovery identity',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'rssd-image-legacy-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const result=draft();for(const slot of result.imagePlan)slot.caption='原来的图注';
 const args={directory,claimId:'legacy-claim',generation:0,workId:'legacy-work',locale:'zh-CN',result};
 const current=await freezeImagePlan(args),legacy={...current,version:1};await writeFile(join(directory,'zh-CN.image-plan.json'),JSON.stringify(legacy));
 assert.deepEqual(await freezeImagePlan(args),legacy);
 const images=legacy.slots.map(slot=>({blockId:slot.blockId,id:'media-'+slot.blockId,url:'https://center.example/api/rssd/v1/media/media-'+slot.blockId+'/raw',alt:slot.alt,caption:slot.caption,uploaded:true,manifest:{sha256:'a'.repeat(64)},registration:{taskId:'task-1'},provenance:{kind:'generated'}}));
 const bound=bindImagePlan({plan:legacy,images,origin:'https://center.example'});assert.equal(bound.notebook.blocks[2].text,'原来的图注');
});
test('new Chinese caption spacing keeps punctuation; v2 reproduces its original bytes',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'rssd-image-caption-version-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const result=draft();result.imagePlan[0].caption='解释画面。';result.imagePlan[1].caption='研究步骤。';
 const plan=await freezeImagePlan({directory,claimId:'caption-claim',generation:0,workId:'caption-work',locale:'zh-CN',result});assert.equal(plan.version,3);
 const images=plan.slots.map(slot=>({blockId:slot.blockId,id:'media-'+slot.blockId,url:'https://center.example/api/rssd/v1/media/media-'+slot.blockId+'/raw',alt:slot.alt,caption:slot.caption,uploaded:true,manifest:{sha256:'a'.repeat(64)},registration:{taskId:'task-1'},provenance:{kind:'generated'}}));
 const fresh=bindImagePlan({plan,images,origin:'https://center.example'}),legacy=bindImagePlan({plan:{...plan,version:2},images,origin:'https://center.example'});
 assert.equal(fresh.notebook.blocks[2].text,'解释画面。 AI 生成示意图');assert.equal(legacy.notebook.blocks[2].text,'解释画面。 · AI 生成示意图');
});


test('new generated captions use frozen site brand disclosure and reject negation',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'rssd-image-brand-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const result=draft();for(const slot of result.imagePlan)slot.caption='解释画面';
 const plan=await freezeImagePlan({directory,claimId:'claim-brand',generation:0,workId:'work-brand',locale:'zh-CN',result});
 const disclosures={'zh-CN':'Scholay 原创手绘示意（AI 辅助生成）',en:'Scholay original illustration (AI-generated)'};
 const images=plan.slots.map(slot=>({blockId:slot.blockId,id:'media-'+slot.blockId,url:'https://center.example/api/rssd/v1/media/media-'+slot.blockId+'/raw',alt:slot.alt,caption:slot.caption,uploaded:true,manifest:{sha256:'a'.repeat(64)},registration:{taskId:'task-1'},provenance:{kind:'generated',disclosures}}));
 const bound=bindImagePlan({plan,images,origin:'https://center.example'});assert.match(bound.notebook.blocks[2].text,/Scholay 原创手绘示意（AI 辅助生成）/);
 const bad=structuredClone(plan);bad.slots[0].caption='并非 AI 生成的图';
 const altered=structuredClone(images);altered[0].caption=bad.slots[0].caption;
 assert.throws(()=>bindImagePlan({plan:bad,images:altered,origin:'https://center.example'}),{code:'image_pending'});
});
