// Titles are real published titles from the 2026-11-15 scan unless used as a proposal.
import test from 'node:test';
import assert from 'node:assert/strict';
import {findRepeat,reservedForColumn,repeatFeedback,titleSubject,templateHeads,sameSubject,normalizeTitle,discoverWithoutRepeat} from '../contracts/topic-repeat.mjs';
import {columnWorks,columnPrefixes,topicRepeatCheck} from '../scripts/rssd-topic-repeat.mjs';
import {writingDefaultsCommand} from '../scripts/writing-defaults-cli.mjs';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const works=titles=>titles.map((title,i)=>({workId:'w'+i,title}));
const cats=works(['暹罗猫：起源、外形、性格与照护要点','美国卷耳猫：起源、特征与饲养要点','缅甸猫：起源、特征与饲养要点','英国短毛猫：起源、特征与饲养要点','缅因猫：起源、外形、性格与饲养要点','每日一猫｜日本短尾猫：绒球短尾、三花毛色与招财猫文化','布偶猫的来历、性格与健康风险']);
const catColumn={prefixes:['每日一猫']};

test('same title after punctuation and width are normalised',()=>{
 const r=findRepeat({title:'程颐易传的解经方法与影响'},{works:works(['程颐《易传》的解经方法与影响'])});
 assert.equal(r.reason,'same-title');assert.equal(r.id,'w0');
});

test('same subject however the rest of the title reads',()=>{
 assert.equal(findRepeat({title:'缅因猫的来历、体型与健康要点'},{works:cats},catColumn)?.title,'缅因猫：起源、外形、性格与饲养要点');
 assert.equal(findRepeat({title:'布偶猫：蓝眼睛的温柔大猫'},{works:cats},catColumn)?.title,'布偶猫的来历、性格与健康风险');
 assert.equal(findRepeat({title:'英国短毛猫是什么样：蓝色之外'},{works:cats},catColumn)?.reason,'same-subject');
});

test('different subjects with the same template are different topics',()=>{
 for(const title of ['索马里猫：起源、特征与饲养要点','拉邦猫：卷毛、亲人与照护要点','美国短毛猫：起源、特征与饲养要点'])assert.equal(findRepeat({title},{works:cats},catColumn),null,title);
 const dogs=works(['比熊犬：起源、特征与饲养要点']);
 assert.equal(findRepeat({title:'查理王小猎犬：起源、特征与饲养要点'},{works:dogs}),null);
});

test('the column name leading a title is not its subject',()=>{
 assert.equal(findRepeat({title:'每日一猫｜塞尔凯克卷毛猫：大块头的卷毛猫'},{works:cats},catColumn),null);
 assert.equal(findRepeat({title:'每日一猫｜暹罗猫：重点色与话痨性格'},{works:cats},catColumn)?.title,'暹罗猫：起源、外形、性格与照护要点');
 const dogs=works(['每日一狗：腊肠犬','每日一狗：比格犬的特征与共同生活需求']);
 assert.equal(findRepeat({title:'每日一狗：柴犬'},{works:dogs},{prefixes:['每日一狗']}),null);
 assert.equal(findRepeat({title:'比格犬：鼻子灵、爱热闹的英国小猎犬'},{works:dogs},{prefixes:['每日一狗']})?.reason,'same-subject');
});

test('a leading segment shared by three titles is treated as a template',()=>{
 const heads=templateHeads(['学界犀闻｜甲','学界犀闻｜乙','学界犀闻｜丙']);
 assert.ok(heads.has(normalizeTitle('学界犀闻')));
 assert.equal(titleSubject('学界犀闻｜开放获取周开幕',heads),normalizeTitle('开放获取周开幕'));
});

test('containing another subject is not the same subject',()=>{
 assert.equal(sameSubject(normalizeTitle('适应性近端因果推断'),normalizeTitle('近端因果推断')),false);
 assert.equal(findRepeat({title:'Programming Historian 多语言文本分析教程：从法语与俄语文本入门'},{works:works(['Programming Historian：用 hex 查看器逆向阅读原生数字史料'])}),null);
 assert.equal(findRepeat({title:'短毛猫的换毛季护理'},{works:cats},catColumn),null);
});

test('same topic key as an earlier daily demand of the column',()=>{
 const reserved=[{id:'daily34-20261114-pets-daily-cat',title:'某个不同的标题',topicKey:'Ragdoll'}];
 const r=findRepeat({title:'全新标题',topicKey:' ragdoll '},{works:[],reserved});
 assert.deepEqual([r.reason,r.kind,r.id],['same-topic-key','demand','daily34-20261114-pets-daily-cat']);
 assert.equal(findRepeat({title:'全新标题',topicKey:'maine-coon'},{works:[],reserved}),null);
});

test('only earlier demands of the same column that reached Center are compared',()=>{
 const column={workspaceId:'pets',sectionId:'daily-cat'};
 const all=[
  {id:'a',created:true,workspaceId:'pets',sectionId:'daily-cat'},
  {id:'b',created:false,workspaceId:'pets',sectionId:'daily-cat'},
  {id:'c',created:true,workspaceId:'pets',sectionId:'daily-dog'},
  {id:'now',created:true,workspaceId:'pets',sectionId:'daily-cat'},
 ];
 assert.deepEqual(reservedForColumn(all,column,'now').map(r=>r.id),['a']);
 assert.deepEqual(reservedForColumn(undefined,column,'now'),[]);
});

test('retry feedback names both titles as quoted data and can be extended by a device',async()=>{
 const calls=[];let n=0;
 await discoverWithoutRepeat({discover:async f=>{calls.push(f);return {title:['缅因猫的来历','索马里猫：起源'][n++]};},check:v=>findRepeat({title:v.title},{works:cats},catColumn),exhausted:()=>Error('x'),feedback:(p,r)=>repeatFeedback(p,r)+' DEVICE-NOTE'});
 assert.match(calls[1],/DEVICE-NOTE$/);
});

test('retry feedback text',()=>{
 const text=repeatFeedback({title:'缅因猫的来历',topicKey:'maine-coon'},{reason:'same-subject',title:'缅因猫：起源'});
 assert.match(text,/"缅因猫的来历"/);assert.match(text,/"缅因猫：起源"/);assert.match(text,/标题主体相同/);
});

const check=title=>findRepeat({title},{works:cats},catColumn);
const exhausted=repeat=>Object.assign(Error('duplicate: '+repeat.title),{code:'duplicate'});

test('a first proposal that repeats nothing is used without another discovery',async()=>{
 const calls=[];
 const p=await discoverWithoutRepeat({discover:async f=>{calls.push(f);return {title:'索马里猫：起源、特征与饲养要点'};},check:v=>check(v.title),exhausted});
 assert.equal(p.title,'索马里猫：起源、特征与饲养要点');assert.deepEqual(calls,['']);
});

test('a repeat gets one more discovery that is told what it repeated',async()=>{
 const calls=[],rejected=[];const answers=['缅因猫的来历','拉邦猫：卷毛、亲人与照护要点'];
 const p=await discoverWithoutRepeat({discover:async f=>{calls.push(f);return {title:answers[calls.length-1]};},check:v=>check(v.title),reject:r=>rejected.push(r),exhausted});
 assert.equal(p.title,'拉邦猫：卷毛、亲人与照护要点');assert.equal(calls.length,2);assert.equal(calls[0],'');
 assert.match(calls[1],/"缅因猫的来历"/);assert.match(calls[1],/"缅因猫：起源、外形、性格与饲养要点"/);
 assert.deepEqual(rejected.map(r=>[r.attempt,r.final,r.repeat.reason]),[[1,false,'same-subject']]);
});

test('a second repeat drops the topic with a duplicate fault and no third discovery',async()=>{
 let calls=0;const rejected=[];
 await assert.rejects(discoverWithoutRepeat({discover:async()=>({title:['缅因猫的来历','暹罗猫：重点色'][calls++]}),check:v=>check(v.title),reject:r=>rejected.push(r),exhausted}),e=>e.code==='duplicate'&&/暹罗猫/.test(e.message));
 assert.equal(calls,2);assert.deepEqual(rejected.map(r=>[r.attempt,r.final]),[[1,false],[2,true]]);
});

test('a discovery failure is passed through unchanged, not counted as a repeat',async()=>{
 const failure=Object.assign(Error('invalid discovery response'),{code:'sources'});
 await assert.rejects(discoverWithoutRepeat({discover:async()=>{throw failure;},check:()=>null,exhausted}),e=>e===failure);
});

// A fake Center works list: 450 works across two columns, paged by 200.
function fakeClient(rows){
 const calls=[];
 return {calls,works:async({workspaceId,limit,offset})=>{calls.push({workspaceId,limit,offset});return rows.slice(offset,offset+limit);}};
}
const rows=[...Array.from({length:440},(_,i)=>({id:'d'+i,sectionId:'daily-dog',editions:[{locale:'zh-CN',title:'犬种'+i+'：起源'}]})),
 {id:'c1',sectionId:'daily-cat',editions:[{locale:'en',title:'Maine Coon'},{locale:'zh-CN',title:'缅因猫：起源、外形、性格与饲养要点'}]},
 {id:'c2',sectionId:'daily-cat',editions:[{locale:'zh-CN',title:'暹罗猫：起源、外形、性格与照护要点'}]},
 {id:'c3',sectionId:'daily-cat',editions:[]}];

test('column works page through the whole list and keep only that column, zh-CN title first',async()=>{
 const client=fakeClient(rows),works=await columnWorks(client,{workspaceId:'pets',sectionId:'daily-cat'});
 assert.deepEqual(works,[{workId:'c1',title:'缅因猫：起源、外形、性格与饲养要点'},{workId:'c2',title:'暹罗猫：起源、外形、性格与照护要点'}]);
 assert.deepEqual(client.calls.map(c=>c.offset),[0,200,400]);
});

test('the column name comes from the site profile',()=>{
 assert.deepEqual(columnPrefixes('pets','daily-cat'),['每日一猫']);
 assert.deepEqual(columnPrefixes('pets','no-such-column'),[]);
});

test('topic check reports a repeat or a new topic for the column',async()=>{
 const repeat=await topicRepeatCheck({client:fakeClient(rows),workspaceId:'pets',sectionId:'daily-cat',title:'每日一猫｜缅因猫的来历'});
 assert.equal(repeat.state,'repeat');assert.equal(repeat.repeat.id,'c1');assert.equal(repeat.compared.works,2);
 const fresh=await topicRepeatCheck({client:fakeClient(rows),workspaceId:'pets',sectionId:'daily-cat',title:'索马里猫：起源、特征与饲养要点'});
 assert.equal(fresh.state,'new');assert.equal(fresh.repeat,null);
 await assert.rejects(topicRepeatCheck({client:fakeClient(rows),workspaceId:'pets',sectionId:'daily-cat',title:' '}),/proposed title/);
});

test('the writing-defaults command checks a topic read-only and fails on a repeat',async()=>{
 const home=mkdtempSync(join(tmpdir(),'topic-check-'));
 writeFileSync(join(home,'connection.json'),JSON.stringify({origin:'http://127.0.0.1:9',identity:{orgId:'org'}}));
 const token='rssd_device_'+'a'.repeat(48),requests=[];
 const realFetch=globalThis.fetch;
 globalThis.fetch=async(url,init={})=>{requests.push({url:String(url),method:init.method||'GET'});return new Response(JSON.stringify(rows.filter(r=>r.sectionId==='daily-cat')),{status:200,headers:{'content-type':'application/json'}});};
 const saved=process.env.RSSD_CENTER_TOKEN;process.env.RSSD_CENTER_TOKEN=token;
 try{
  const emitted=[];
  const result=await writingDefaultsCommand(['--topic-check','缅因猫的来历','--workspace','pets','--section','daily-cat','--center-home',home],{emit:v=>emitted.push(v)});
  assert.equal(result.ok,false);assert.equal(emitted[0].state,'repeat');
  assert.ok(requests.length>=1&&requests.every(r=>r.method==='GET'&&/\/works\?/.test(r.url)));
  await assert.rejects(writingDefaultsCommand(['--topic-check','缅因猫','--workspace','pets'],{emit:()=>{}}),/requires --workspace and --section/);
 }finally{globalThis.fetch=realFetch;if(saved===undefined)delete process.env.RSSD_CENTER_TOKEN;else process.env.RSSD_CENTER_TOKEN=saved;}
});
