import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import rules from '../contracts/writing-defaults-v1.cjs';
import {buildWritingDefaultsCatalog,resolveWritingDefaults} from '../contracts/writing-defaults.mjs';
import {normalizeNotebookResult} from '../contracts/notebook-output.mjs';
import {parseCenterResult,centerWritingPrompt} from '../desktop/scripts/agent/center-producer.mjs';
import {checkWritingDraft} from '../scripts/check-writing-draft.mjs';
import {writingDefaultsCommand} from '../scripts/writing-defaults-cli.mjs';
const source={repository:'scholay-rssd/rssd',commit:'a'.repeat(40),files:[{path:'contracts/fixture.mjs',sha256:'b'.repeat(64)}]};
const baseline=()=>resolveWritingDefaults(buildWritingDefaultsCatalog({source}),'metho','statistics');
const bodyLength={unit:'han',minimum:9,target:10,maximum:11};
const paragraph=(id,text,extra={})=>({id,type:'paragraph',state:'ready',text,sourceIds:[],...extra});
function draft(){return {version:2,kind:'article',title:'Synthetic delivery fixture',summary:'Synthetic summary',skills:[],fields:{},groups:[],blocks:[paragraph('body','甲乙丙丁戊己庚辛壬癸'),{id:'figure',type:'image',state:'ready',text:'fixture.png',sourceIds:[],alt:'白底展示用于校验图片交付字段的蓝色矩形测试样本'},{id:'caption',type:'annotation',role:'caption',targetId:'figure',state:'ready',text:'Synthetic image fixture, not article content.',sourceIds:[]}],sources:[],blockNotes:{},internalNotes:{}};}
test('flat JSON and the legacy envelope retain identical notebook content; malformed root closure is rejected',()=>{
 const flat=draft(),normalized=normalizeNotebookResult(flat),{summary,...n}=flat;
 assert.deepEqual(normalized,{notebook:n,summary});assert.deepEqual(flat,draft());
 assert.deepEqual(parseCenterResult(JSON.stringify(flat)),normalized);
 const legacy={notebook:n,summary};assert.equal(normalizeNotebookResult(legacy),legacy);
 assert.deepEqual(parseCenterResult(JSON.stringify(legacy)),legacy);
 assert.throws(()=>parseCenterResult(JSON.stringify({notebook:n})+',"summary":"outside"}'),/完整的文章 JSON/);
 assert.throws(()=>parseCenterResult(JSON.stringify(flat)+'\n'+JSON.stringify(flat)),/完整的文章 JSON/);
});
test('only the new baseline requests flat output; legacy and image-plan contracts retain their formats',()=>{
 const b=baseline(),context=rules.compose(b,{bodyLength}),skills={skills:b.skills,snapshotHash:'c'.repeat(64),defaults:context};
 const args={claim:{workspaceId:'metho',sectionId:'statistics',title:'Fixture',payload:{brief:'Synthetic brief'}},locale:'zh',writingPolicy:b.writingPolicy,writingSkills:skills};
 const prompt=centerWritingPrompt(args);assert.match(prompt,/不要再套 notebook 外壳/);assert.match(prompt,/目标10个汉字/);
 const {delivery,hash,...old}=b,legacy={...old,hash:rules.hash(old)};
 assert.match(centerWritingPrompt({...args,writingSkills:{...skills,defaults:rules.compose(legacy)}}),/"notebook":\{/);
 assert.doesNotMatch(centerWritingPrompt({...args,imagePlan:true}),/不要再套 notebook 外壳/);
});
test('body budgets exclude heading, image, caption, bibliography, links and private notes',()=>{
 const n=draft();n.blocks=[paragraph('a','甲乙丙丁戊'),{id:'heading',type:'heading',state:'ready',level:2,text:'不计标题',sourceIds:[]},{id:'markdown',type:'markdown',state:'ready',text:'# 不计标题\n己庚[辛](https://example.org/链接)',sourceIds:[]},...n.blocks.slice(1),paragraph('explicit-reference','参考'.repeat(500),{purpose:'reference'}),{id:'refs',type:'heading',state:'ready',level:2,text:'参考文献',sourceIds:[]},paragraph('reference','来源'.repeat(500)),{id:'next',type:'heading',state:'ready',level:2,text:'接着正文',sourceIds:[]},paragraph('b','壬癸')];
 n.internalNotes={verification:'备'.repeat(1000)};
 assert.equal(rules.measurements(n).bodyHan,10);assert.equal(rules.measurements(n).privateHan,1000);
 const context=rules.compose(baseline(),{bodyLength});assert.deepEqual(rules.deliveryIssues(n,context),[]);
 n.blocks[0].text='甲';assert.match(rules.deliveryIssues(n,context).join(';'),/当前 6/);
 n.blocks[0].text='甲'.repeat(10);assert.match(rules.deliveryIssues(n,context).join(';'),/当前 15/);
 assert.equal(rules.compose(baseline()).bodyLength,undefined);
 for(const length of [{unit:'characters',minimum:1,target:10,maximum:20},{unit:'han',minimum:12,target:10,maximum:20},{...bodyLength,maximum:1e9}])assert.throws(()=>rules.compose(baseline(),{bodyLength:length}),/正文篇幅/);
});
test('alt bounds use Unicode code points on new baselines without changing historical checks',()=>{
 const b=baseline(),n=draft();n.blocks[1].alt='𠀀'.repeat(20);assert.deepEqual(rules.deliveryIssues(n,b),[]);
 n.blocks[1].alt='𠀀'.repeat(19);assert.match(rules.deliveryIssues(n,b).join(';'),/当前 19/);
 n.blocks[1].alt='图'.repeat(61);assert.match(rules.deliveryIssues(n,b).join(';'),/当前 61/);
 const {delivery,hash,...old}=b,legacy={...old,hash:rules.hash(old)};n.blocks[1].alt='旧';assert.deepEqual(rules.deliveryIssues(n,legacy),[]);
});
test('the offline request and draft checker share a frozen budget, reject tampering and check actual image bytes',async t=>{
 const root=await mkdtemp(join(tmpdir(),'rssd-writing-output-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const context=rules.compose(baseline(),{bodyLength}),contextFile=join(root,'context.json'),draftFile=join(root,'draft.json'),assetsFile=join(root,'assets.json');
 const save=(file,value)=>writeFile(file,JSON.stringify(value));
 await save(contextFile,{...context,retrieval:{origin:'https://center.example',fetchedAt:'fixture'}});
 await writeFile(join(root,'brief.txt'),'Synthetic file-only brief');
 await writingDefaultsCommand(['--request',contextFile,'--brief',join(root,'brief.txt'),'--output',join(root,'request.txt')],{emit:()=>{}});
 const prompt=await readFile(join(root,'request.txt'),'utf8');assert.match(prompt,/Synthetic file-only brief/);assert.match(prompt,/目标10个汉字/);assert.match(prompt,/不要再套 notebook 外壳/);
 await sharp({create:{width:96,height:64,channels:3,background:'#336699'}}).png().toFile(join(root,'fixture.png'));
 await save(assetsFile,[{blockId:'figure',file:'fixture.png',kind:'owned'}]);await save(draftFile,draft());
 let checked=await checkWritingDraft({draftFile,contextFile,assetsFile});assert.equal(checked.ok,true);assert.equal(checked.measurements.bodyHan,10);assert.equal(checked.images[0].width,96);
 const n=draft();n.blocks[0].text='甲乙';n.internalNotes={verification:'备'.repeat(1000)};await save(draftFile,n);
 checked=await checkWritingDraft({draftFile,contextFile,assetsFile});assert.equal(checked.ok,false);assert.match(checked.issues.join(';'),/当前 2/);
 n.blocks[0].sourceIds=['missing'];await save(draftFile,n);checked=await checkWritingDraft({draftFile,contextFile,assetsFile});assert.match(checked.issues.join(';'),/不存在的素材/);
 await save(contextFile,{...context,images:{...context.images,minimum:0}});await assert.rejects(checkWritingDraft({draftFile,contextFile,assetsFile}),/哈希/);
 await save(contextFile,context);await writeFile(join(root,'fixture.png'),'not an image');await assert.rejects(checkWritingDraft({draftFile,contextFile,assetsFile}));
});
