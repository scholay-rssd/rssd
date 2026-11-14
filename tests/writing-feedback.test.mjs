import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import rules from '../contracts/writing-defaults-v1.cjs';
import {buildWritingDefaultsCatalog,resolveWritingDefaults} from '../contracts/writing-defaults.mjs';
import {writingFeedback} from '../scripts/writing-feedback.mjs';
const source={repository:'scholay-rssd/rssd',commit:'a'.repeat(40),files:[{path:'contracts/fixture.mjs',sha256:'b'.repeat(64)}]};
async function setup(t){
 const root=await mkdtemp(join(tmpdir(),'writing-feedback-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const baseline=resolveWritingDefaults(buildWritingDefaultsCatalog({source}),'metho','statistics'),context=rules.compose(baseline,{origin:'task',images:{minimum:0},bodyLength:{unit:'han',minimum:9,target:10,maximum:11}});
 const args={draftFile:join(root,'raw.txt'),contextFile:join(root,'context.json'),briefFile:join(root,'brief.txt'),assetsFile:join(root,'assets.json'),outputFile:join(root,'feedback-1.txt'),fileDraft:true};
 await writeFile(args.contextFile,JSON.stringify(context));await writeFile(args.briefFile,'Synthetic file-only task with explicit text-only authorization');await writeFile(args.assetsFile,'[]');
 const draft={version:2,kind:'article',title:'Synthetic fixture',summary:'Synthetic summary',skills:[],fields:{},groups:[],blocks:[{id:'body',type:'paragraph',state:'ready',text:'甲乙丙丁戊己庚辛壬癸',sourceIds:[]}],sources:[],blockNotes:{},internalNotes:{}};
 return {root,args,draft};
}
test('malformed JSON yields feedback without repairing bytes, repeated input reuses the same request and budget',async t=>{
 const {args}=await setup(t),raw='{"version":2},"summary":"outside"}';await writeFile(args.draftFile,raw);
 const first=await writingFeedback(args);assert.equal(first.state,'revision-requested');assert.equal(first.number,1);assert.match(first.issues[0],/JSON/);assert.equal(await readFile(args.draftFile,'utf8'),raw);
 const request=await readFile(first.file,'utf8');assert.match(request,/JSON语法无效/);assert.match(request,/不伪造公网地址/);
 const second=await writingFeedback({...args,outputFile:join(dirnameOf(args.outputFile),'unused.txt')});assert.equal(second.reused,true);assert.equal(second.file,first.file);assert.equal(second.number,1);
});
const dirnameOf=file=>join(file,'..');
test('two feedback requests survive a resume; a third failed candidate exhausts without another request',async t=>{
 const {root,args,draft}=await setup(t);
 for(let i=1;i<=3;i++){
  draft.blocks[0].text='甲'.repeat(i);draft.internalNotes={verification:'备'.repeat(1000)};await writeFile(args.draftFile,JSON.stringify(draft));
  const result=await writingFeedback({...args,outputFile:join(root,'feedback-'+i+'.txt')});assert.equal(result.state,i<3?'revision-requested':'exhausted');assert.match(result.issues.join(';'),/公开正文篇幅/);
 }
 await assert.rejects(access(join(root,'feedback-3.txt')));assert.equal(JSON.parse(await readFile(join(root,'writing-feedback.json'),'utf8')).requests.length,2);
});
test('a successful candidate is accepted without model work; another article cannot reuse its ledger',async t=>{
 const {args,draft}=await setup(t);await writeFile(args.draftFile,JSON.stringify(draft));const result=await writingFeedback(args);assert.equal(result.state,'ready');assert.equal(result.ok,true);await assert.rejects(access(args.outputFile));
 draft.blocks[0].text='甲';await writeFile(args.draftFile,JSON.stringify(draft));await assert.rejects(writingFeedback(args),/已有合格稿/);
});
test('signed/claimed/protected inputs, changed contexts and clobbering input files are refused',async t=>{
 const {args,draft}=await setup(t);await writeFile(args.draftFile,JSON.stringify(draft));await assert.rejects(writingFeedback({...args,fileDraft:false}),/file-draft/);await assert.rejects(writingFeedback({...args,outputFile:args.draftFile}),/differ/);
 for(const input of [{...draft,modelSignatures:[{runId:'synthetic'}]},{...draft,meta:{revision:1}},{...draft,claimToken:'SYNTHETIC-NOT-A-CREDENTIAL'},{...draft,blocks:[{...draft.blocks[0],locked:true}]}]){await writeFile(args.draftFile,JSON.stringify(input));await assert.rejects(writingFeedback(args),/无签名/);}
 await writeFile(args.draftFile,'{"version":2},');await writingFeedback(args);await writeFile(args.briefFile,'changed task');await assert.rejects(writingFeedback(args),/任务、素材或预算已变化/);
});
