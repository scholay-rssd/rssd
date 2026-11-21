import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import sharp from 'sharp';
import {parseNote,placeable,supplementNote} from '../scripts/rssd-image-supplement.mjs';

const note=`---
title: 家兔吃什么
rssd-id: center-rabbit
rssd-locale: zh-CN
---
# 家兔吃什么

开头段落，说明牧草的重要性。

## 牧草

牧草是成兔饮食的基础。

## 叶菜

新鲜叶菜是日常补充。

## 参考文献

1. Rabbit.org
`;

test('pictures are never placed in the references or beside another picture',()=>{
 const {blocks}=parseNote(note+'\n![a](x.webp)\n\n图注。\n');
 const allowed=placeable(blocks);
 assert.deepEqual(allowed.map(i=>blocks[i].text.slice(0,4)),['开头段落','牧草是成','新鲜叶菜']);
});

test('a planned work gets pictures with no AI label public and the model kept in the record',async t=>{
 const root=await mkdtemp(join(tmpdir(),'rssd-supplement-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const file=join(root,'rabbit.md');await writeFile(file,note);
 const picture=await sharp({create:{width:30,height:20,channels:3,background:'#8a7'}}).png().toBuffer();
 let drawn=0;
 const provider={start:async()=>({status:'ready',bytes:picture,registration:{sha256:'a'.repeat(64)},provenance:{kind:'generated',agent:'Codex',model:'gpt-image',service:'ChatGPT',threadId:'t-'+(++drawn)}})};
 const plan=async({prompt})=>{assert.match(prompt,/choose only from: 1, 3, 5/);return {slots:[
  {after:3,role:'body',requirement:'Rabbit eating hay',alt:'一只家兔在铺满干草的围栏里低头咀嚼提摩西草',caption:'牧草应当每天不限量供应。'},
  {after:1,role:'title',requirement:'Rabbit with greens',alt:'一只家兔坐在叶菜和干草旁边的安静室内场景',caption:'家兔饮食以牧草为主。'}]};};
 const result=await supplementNote(file,{out:root,provider,plan});
 assert.equal(result.pictures,2);
 const body=await readFile(join(result.workDir,'note.md'),'utf8'),record=JSON.parse(await readFile(join(result.workDir,'record.json'),'utf8'));
 assert.match(body,/开头段落，说明牧草的重要性。\n\n!\[一只家兔坐在叶菜和干草旁边的安静室内场景\]\(\.\.\/article-media\/[a-f0-9]{64}\.webp\)\n\n家兔饮食以牧草为主。\n/);assert.doesNotMatch(body,/AI ?生成|AI-generated/);
 assert.doesNotMatch(body,/gpt-image|Codex|ChatGPT/);
 assert.deepEqual(record.pictures.map(p=>p.drawnBy.model),['gpt-image','gpt-image']);assert.equal(record.pictures[0].role,'title');
});

test('a plan that drops a picture into the references is refused',async t=>{
 const root=await mkdtemp(join(tmpdir(),'rssd-supplement-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const file=join(root,'rabbit.md');await writeFile(file,note);
 const plan=async()=>({slots:[{after:1,role:'title',requirement:'x',alt:'一只家兔坐在叶菜和干草旁边的安静室内场景',caption:'说明。'},{after:7,role:'body',requirement:'x',alt:'一只家兔坐在叶菜和干草旁边的安静室内场景',caption:'说明。'}]});
 await assert.rejects(supplementNote(file,{out:root,provider:{start:()=>assert.fail('must not draw')},plan}),/not allowed/);
});

test('the private record written for Obsidian is accepted by the Center and names the model only there',async()=>{
 const {privateAddition}=await import('../scripts/rssd-image-supplement.mjs');
 const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);
 const {privateAppend}=require('../center/rssd/editorial.cjs');
 const record={pictures:[{role:'title',alt:'一只家兔坐在叶菜和干草旁边的安静室内场景',sha256:'b'.repeat(64),drawnBy:{agent:'Codex',model:'gpt-image',threadId:'01a1ee10-8435-7373-a71b-a8e39fc71ba7',drawnAt:'2026-11-18T10:00:00.000Z'}}]};
 const addition=privateAddition(record);
 assert.doesNotThrow(()=>privateAppend(addition));
 assert.equal(addition.modelSignatures[0].modelName,'gpt-image');assert.equal(addition.modelSignatures[0].action,'image');
 assert.match(addition.internalNotes.images,/题图「.+」由 Codex · gpt-image 绘制/);
});
test('an English note gets no extra pictures; it reuses the Chinese pictures',async t=>{
 const root=await mkdtemp(join(tmpdir(),'rssd-supplement-en-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const file=join(root,'rabbit-en.md');await writeFile(file,note.replace(/^---\n/,'---\nrssd-locale: en\n'));
 const provider={start:async()=>{throw Error('must not draw');}},plan=async()=>{throw Error('must not plan');};
 const result=await supplementNote(file,{out:root,provider,plan});
 assert.match(result.skipped,/English/);
});
