import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {articleBlocks,plain,validateImagePlan,editsInside,checkLettering,cardWindow,readWork,installSamples,missingStyles,CODE_RULES} from '../scripts/rssd-card-samples.mjs';
import {launchChrome,renderCardPage,CHROME_PATH} from '../scripts/rssd-card-render.mjs';

const note=body=>`---
title: 家兔吃什么
summary: 摘要
date: 2026-11-18
author: 小猪盖被 · 萌宠
category: 异宠大全
rssd-id: center-test
rssd-section: exotic-pets
rssd-locale: zh-CN
rssd-kind: news
rssd-version: 1
---
${body}`;

test('the article is read as readers see it, in order, with captions tied to their pictures',()=>{
 const blocks=articleBlocks(`# 家兔吃什么

# 家兔吃什么

牧草是**基础** [1]。见 [Rabbit.org](https://rabbit.org/care/food-diet/)。

![一只兔子](../article-media/abc.webp)

把牧草放在随时能吃到的地方。 · AI 生成示意图

## 要点

- **牧草**：不限量
- 叶菜：慢慢加

### 参考文献

1. [Healthy Rabbit Diet Guide](https://rabbit.org/care/food-diet/)
2. [2] *Rabbit* care sheet`,'家兔吃什么');
 assert.deepEqual(blocks.map(b=>b.id),['title','p1','img1','cap1','h1','li1','li2','h2','r1','r2']);
 assert.equal(blocks.filter(b=>b.type==='title').length,1);
 assert.equal(blocks[1].text,'牧草是基础 [1]。见 Rabbit.org。');
 assert.equal(blocks[2].file,'abc.webp');assert.equal(blocks[3].of,'img1');
 assert.equal(blocks[5].text,'牧草：不限量');
 assert.deepEqual(blocks.slice(-2).map(b=>b.text),['[1] Healthy Rabbit Diet Guide','[2] Rabbit care sheet']);
 assert.equal(plain('[a (b)](https://x.org/a_(b)) **c**'),'a (b) c');
});

const goodPlan={cards:[
 {role:'cover',headline:'家兔吃什么',lines:['从牧草到蔬菜'],scene:'A rabbit eating timothy hay in a calm room.',from:['title']},
 {role:'point',headline:'牧草不限量',lines:['约占饮食85%'],scene:'A rabbit beside a big pile of fresh hay.',from:['p1']},
 {role:'point',headline:'叶菜慢慢加',lines:['一次只加一种'],scene:'Three kinds of leafy greens on a plate.',from:['p1']},
 {role:'point',headline:'颗粒要少量',lines:['粗纤维至少18%'],scene:'A small dish of plain green pellets.',from:['p1']},
 {role:'closing',headline:'按需调整',lines:['幼兔老兔问兽医'],scene:'A vet gently checking a rabbit on a table.',from:['p1']}]};

test('a 模型生图 plan keeps lettering short, Chinese and based on the article',()=>{
 const blocks=[{id:'title'},{id:'p1'}];
 assert.deepEqual(validateImagePlan(goodPlan,blocks),[]);
 const bad=structuredClone(goodPlan);
 bad.cards[1].headline='牧草每天都要不限量地供应给兔子';bad.cards[2].lines=['兔子 建议'];bad.cards[4].role='point';bad.cards[3].from=['p9'];
 const problems=validateImagePlan(bad,blocks).join('\n');
 assert.match(problems,/Card 2: the headline must be 2 to 12/);
 assert.match(problems,/Card 3: "兔子 建议" may only use/);
 assert.deepEqual(validateImagePlan({cards:goodPlan.cards.map((c,i)=>i===2?{...c,lines:['qPCR查寄生虫DNA']}:c)},blocks),[]);
 assert.match(problems,/Card 5: the last card is the closing card/);
 assert.match(problems,/Card 4: "from" must list/);
 assert.deepEqual(validateImagePlan({cards:goodPlan.cards.slice(0,3)},blocks),['Plan 5 to 7 cards.']);
});

test('drawn lettering must read back as planned, with nothing extra and nothing at the edges',()=>{
 assert.equal(editsInside([...'牧草不限量'],[...'第一牧草不限量供应']),0);
 assert.equal(editsInside([...'牧草不限量'],[...'牧单不限量']),1);
 const window=cardWindow(1024,1536);
 assert.equal(window.top,60);
 const at=(text,y=0.2)=>({text,confidence:1,x:0.1,y,w:0.5,h:0.04});
 assert.deepEqual(checkLettering(['牧草不限量','约占饮食85%'],[at('牧草不限量'),at('约占饮食85%',0.3)],window),[]);
 assert.match(checkLettering(['牧草不限量'],[at('牧单不限量')],window).join(),/not drawn correctly/);
 assert.match(checkLettering(['牧草不限量'],[at('牧草不限量'),at('小猪萌宠',0.4)],window).join(),/Extra text/);
 assert.match(checkLettering(['牧草不限量'],[at('牧草不限量',0.9)],window).join(),/too close to the edge/);
});

test('sets go where the plug-in reads them, tied to the note, and are refused once the note changes',async()=>{
 const vault=await mkdtemp(join(tmpdir(),'rssd-cards-'));
 try{
  await mkdir(join(vault,'Works'));const file=join(vault,'Works','center-test.md');
  await writeFile(file,note('# 家兔吃什么\n\n牧草是基础。\n'));
  const work=await readWork(file),png=n=>Buffer.from('png'+n);
  const plainInstall=(w,sets,meta)=>installSamples(w,sets,meta,{compress:false});
  assert.equal(work.name,'center-test');assert.equal(work.vault,vault);
  const target=await plainInstall(work,{'ai-code':[png(1),png(2),png(3)]},{'ai-code':{agent:'Codex'}});
  assert.equal(target,join(vault,'Card Samples','center-test'));
  assert.equal(String(await readFile(join(target,'ai-code.png'))),'png1');
  assert.equal(String(await readFile(join(target,'ai-code','03.png'))),'png3');
  await plainInstall(work,{'ai-image':[png(4)]},{'ai-image':{agent:'Codex'}});
  const source=JSON.parse(await readFile(join(target,'source.json'),'utf8'));
  assert.equal(source.sourceHash,work.fingerprint);assert.deepEqual(source.pageCounts,{'ai-code':3,'ai-image':1});
  await writeFile(file,note('# 家兔吃什么\n\n牧草是基础，也要叶菜。\n'));
  await assert.rejects(plainInstall(work,{'ai-code':[png(5)]},{}),/changed while its cards were made/);
 }finally{await rm(vault,{recursive:true,force:true});}
});

test('the layout check catches lost, cut, invented or misplaced text',{skip:!existsSync(CHROME_PATH)&&'Chrome is not installed'},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'rssd-card-check-'));
 const chrome=await launchChrome();
 try{
  const spec={...CODE_RULES,blocks:[{id:'title',type:'title',text:'家兔吃什么'},{id:'p1',type:'paragraph',text:'牧草是基础。'},{id:'p2',type:'paragraph',text:'叶菜慢慢加。'},{id:'p3',type:'paragraph',text:'水果只当零食。'}]};
  const card=body=>`<section class="card" style="width:1080px;height:1440px;box-sizing:border-box;padding:80px;overflow:hidden;font:34px/1.7 'PingFang SC'">${body}</section>`;
  await writeFile(join(dir,'good.html'),`<!doctype html><meta charset="utf-8"><body style="margin:0">${card('<h1 data-src="title">家兔吃什么</h1><p data-src="p1">牧草是</p><span>01</span>')}${card('<p data-src="p1">基础。</p><p data-src="p2">叶菜慢慢加。</p><p data-src="p3">水果只当零食。</p>')}`);
  const good=await renderCardPage(chrome,join(dir,'good.html'),spec,{shots:true});
  assert.deepEqual(good.issues,[]);assert.equal(good.pngs.length,2);
  await writeFile(join(dir,'bad.html'),`<!doctype html><meta charset="utf-8"><body style="margin:0">${card('<h1 data-src="title">家兔吃什么</h1><p data-src="p1">牧草是基础！</p><p style="margin-top:1300px" data-src="p3">水果只当零食。</p><b>这是一段作者自己加的很长的说明文字</b><small style="font-size:14px">注</small>')}`);
  const issues=(await renderCardPage(chrome,join(dir,'bad.html'),spec)).issues.join('\n');
  assert.match(issues,/Block p1 differs from the article/);
  assert.match(issues,/Block p2 is missing/);
  assert.match(issues,/runs \d+ px past the bottom/);
  assert.match(issues,/words of your own may only be short labels/);
  assert.match(issues,/no text may be smaller than 22px/);
 }finally{await chrome.close();await rm(dir,{recursive:true,force:true});}
});

test('tables become rows, English plans and lettering follow English rules, finished sets are skipped',async()=>{
 const rows=articleBlocks(`# 粪便检测

| 检测方法 | 查出的样本数 |
| --- | --- |
| qPCR 检测组合 | 276 |
| **粪便抗原检测** | 110 |`,'粪便检测');
 assert.deepEqual(rows.slice(1).map(b=>[b.type,b.table,b.cells.join('/')]),[['table-head','table1','检测方法/查出的样本数'],['table-row','table1','qPCR 检测组合/276'],['table-row','table1','粪便抗原检测/110']]);
 const plan={cards:[
  {role:'cover',headline:'Is a Boxer right for you?',lines:[],scene:'A boxer sitting beside a family sofa.',from:['title']},
  {role:'point',headline:'Big, strong, short coat',lines:['Weekly brushing is enough'],scene:'A boxer standing in profile on grass.',from:['p1']},
  {role:'point',headline:'Lots of energy',lines:['Plan daily exercise and play'],scene:'A boxer running after a ball in a park.',from:['p1']},
  {role:'point',headline:'Start training early',lines:['Reward calm greetings'],scene:'A puppy sitting for a treat by a door.',from:['p1']},
  {role:'closing',headline:'Ask yourself first',lines:['Do you have time every day?'],scene:'A person tying shoes next to a waiting boxer.',from:['p1']}]};
 assert.deepEqual(validateImagePlan(plan,[{id:'title'},{id:'p1'}],'en'),[]);
 plan.cards[2].lines=['精力充沛'];
 assert.match(validateImagePlan(plan,[{id:'title'},{id:'p1'}],'en').join(),/may only use letters/);
 const window=cardWindow(1024,1536),at=(text,y=0.2)=>({text,confidence:1,x:0.1,y,w:0.6,h:0.04});
 assert.deepEqual(checkLettering(['Lots of energy','Plan daily exercise and play'],[at('LOTS OF ENERGY'),at('Plan daily exercise and play',0.3)],window,'en'),[]);
 assert.match(checkLettering(['Lots of energy'],[at('Lots of enrgy and fun')],window,'en').join(),/Extra text|not drawn/);
 const vault=await mkdtemp(join(tmpdir(),'rssd-cards-'));
 try{
  await mkdir(join(vault,'Works'));const file=join(vault,'Works','center-test.md');
  await writeFile(file,note('# 家兔吃什么\n\n牧草是基础。\n'));
  const work=await readWork(file);
  assert.deepEqual(await missingStyles(work,['ai-code','ai-image']),['ai-code','ai-image']);
  await installSamples(work,{'ai-code':[await sharp({create:{width:4,height:4,channels:3,background:'#fff'}}).png().toBuffer()]},{});
  assert.deepEqual(await missingStyles(work,['ai-code','ai-image']),['ai-image']);
  await writeFile(file,note('# 家兔吃什么\n\n牧草是基础，也要叶菜。\n'));
  assert.deepEqual(await missingStyles(await readWork(file),['ai-code','ai-image']),['ai-code','ai-image']);
 }finally{await rm(vault,{recursive:true,force:true});}
});
