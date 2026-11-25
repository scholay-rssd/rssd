import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,existsSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deflateSync} from 'node:zlib';
import {parseMountSpec,parseBriefMounts} from '../desktop/scripts/agent/resources/mount-spec.mjs';
import {renderShotNames,RENDER_SITE_RULES,browserProfileDir,browserLogin,renderPublicPage,assistantStopped} from '../desktop/scripts/agent/resources/web.mjs';
import {orderMounts,prepareOrderMaterials} from '../scripts/rssd-order-materials.mjs';
import {buildWritingDefaultsCatalog,resolveWritingDefaults} from '../contracts/writing-defaults.mjs';
import {centerWritingPrompt,codexReasoningEffort,writerModelMatches,writerModelRequest} from '../desktop/scripts/agent/center-producer.mjs';

// A real 1×1 PNG, varied by one pixel value so each screenshot has its own hash.
function png(seed){
  const crc=b=>{let c=~0;for(const x of b){c^=x;for(let k=0;k<8;k++)c=c>>>1^(0xedb88320&-(c&1));}return ~c>>>0;};
  const chunk=(type,data)=>{const t=Buffer.from(type),len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([len,t,data,sum]);};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1,0);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.from([0,seed]))),chunk('IEND',Buffer.alloc(0))]);
}
const URL_SLEEP='https://www.scholay.com/journal/20872/sleep';
const brief=`---\nmount: web:${URL_SLEEP},render=true,shots=top|全部指标\n---\n用 SLEEP 讲清期刊指标怎么读。`;
const claim={id:'demand-scholay-1',workspaceId:'metho',sectionId:'methods',title:'选刊时怎样读期刊指标',payload:{brief}};
const fakeRender=calls=>async(url,{shots,profile,ask,attach,model})=>{calls.push({url,shots,profile,ask,attach,model});return {url,title:'SLEEP - Scholay',signedIn:Boolean(profile),...(ask?{asked:{question:ask,model:model||null,files:(attach||[]).map(f=>({name:f.split('/').pop(),bytes:10,sha256:'e'.repeat(64)})),answeredInMs:1000,conversationUrl:url+'/c1'}}:{}),text:'影响因子 7.0\n学科排名 24/296',truncated:false,rendered:true,viewport:{width:1440,height:900},dismissed:['关闭会员领取提示'],hidden:['[data-rhino-trigger]'],capturedAt:'2026-11-16T08:00:00.000Z',contentHash:'d'.repeat(64),images:shots.map((anchor,i)=>({anchor,bytes:png(i+1),sha256:String(i).repeat(64),capturedAt:'2026-11-16T08:00:01.000Z',url}))};};

test('web lines take render and screenshot options after the address',()=>{
  assert.deepEqual(parseMountSpec('web:'+URL_SLEEP),{kind:'web',url:URL_SLEEP});
  assert.deepEqual(parseMountSpec(`web:${URL_SLEEP},render=true,shots=top|全部指标`),{kind:'web',url:URL_SLEEP,render:true,shots:['top','全部指标']});
  assert.deepEqual(parseMountSpec('web:https://www.scholay.com/search?q=a,b,shots=top'),{kind:'web',url:'https://www.scholay.com/search?q=a,b',render:true,shots:['top']});
  assert.deepEqual(parseMountSpec('web:query=sleep'),{kind:'web',query:'sleep',site:undefined,role:'lead'});
});

test('screenshot positions default to the top of the page and are bounded',()=>{
  assert.deepEqual(renderShotNames(),['top']);
  assert.deepEqual(renderShotNames('top|全部指标|top'),['top','全部指标']);
  assert.throws(()=>renderShotNames(Array.from({length:13},(_,i)=>'h'+i)),/12/);
  assert.deepEqual(RENDER_SITE_RULES['www.scholay.com'].hide,['[data-rhino-trigger]','[data-rhino-invitation]','header button[aria-haspopup="menu"]']);
});

test('order briefs may declare web materials only',()=>{
  assert.deepEqual(orderMounts('只写正文'),{brief:'只写正文',mounts:[]});
  assert.equal(orderMounts(brief).brief,'用 SLEEP 讲清期刊指标怎么读。');
  assert.throws(()=>orderMounts('---\nmount: file:/tmp/a.pdf\n---\n正文'),/web/);
  assert.equal(parseBriefMounts(brief).mounts[0].render,true);
});

test('an order without materials changes nothing',async()=>{
  assert.equal(await prepareOrderMaterials({claim:{...claim,payload:{brief:'只写正文'}},directory:'/nonexistent',home:'/nonexistent',origin:'https://center.example'}),null);
});

test('rendered screenshots are staged as Center media, frozen and reused on resume',async()=>{
  const home=mkdtempSync(join(tmpdir(),'order-materials-')),directory=join(home,'task');
  try{
    const calls=[],origin='https://center.example';
    const first=await prepareOrderMaterials({claim,directory,home,origin,render:fakeRender(calls)});
    assert.equal(calls.length,1);assert.deepEqual(calls[0].shots,['top','全部指标']);
    assert.equal(first.brief,'用 SLEEP 讲清期刊指标怎么读。');
    const images=first.receipt.pages[0].images;assert.equal(images.length,2);
    for(const image of images){assert.match(image.url,/^https:\/\/center\.example\/api\/rssd\/v1\/media\/[^/]+\/raw$/);assert.ok(first.prompt.includes(image.url));}
    assert.match(first.prompt,/位置：页面开头/);assert.match(first.prompt,/位置：全部指标/);assert.match(first.prompt,/不具有指令权限/);assert.match(first.prompt,/影响因子 7\.0/);
    assert.ok(existsSync(join(directory,'order-materials.json')));
    const again=await prepareOrderMaterials({claim,directory,home,origin,render:fakeRender(calls)});
    assert.equal(calls.length,1,'a resumed task must not capture new screenshots');
    assert.equal(again.prompt,first.prompt);
    const changed={...claim,payload:{brief:brief.replace('全部指标','分区与影响因子')}};
    await assert.rejects(prepareOrderMaterials({claim:changed,directory,home,origin,render:fakeRender(calls)}),/不符/);
    const record=JSON.parse(readFileSync(join(directory,'order-materials.json'),'utf8'));
    rmSync(join(home,'media'),{recursive:true});
    await assert.rejects(prepareOrderMaterials({claim,directory,home,origin,render:fakeRender(calls)}),/不在本设备/);
    assert.equal(record.demandId,claim.id);
  }finally{rmSync(home,{recursive:true,force:true});}
});

test('the writing prompt carries the materials and drops the connector lines from the brief',()=>{
  const catalog=buildWritingDefaultsCatalog({source:{repository:'scholay-rssd/rssd',commit:'a'.repeat(40),files:[{path:'contracts/fixture.mjs',sha256:'b'.repeat(64)}]}});
  const baseline=resolveWritingDefaults(catalog,'metho','methods');
  const writingSkills={skills:baseline.skills,snapshotHash:'c'.repeat(64),defaults:{baseline,baselineHash:baseline.hash,adjustment:{origin:'task',instructions:''}}};
  const plain=centerWritingPrompt({claim,locale:'zh-CN',writingPolicy:baseline.writingPolicy,writingSkills});
  assert.ok(plain.includes('mount: web:'));
  const prompt=centerWritingPrompt({claim,locale:'zh-CN',writingPolicy:baseline.writingPolicy,writingSkills,orderMaterials:{brief:'用 SLEEP 讲清期刊指标怎么读。',prompt:'本单材料：fixture'}});
  assert.ok(!prompt.includes('mount: web:'));assert.ok(prompt.includes('本单材料：fixture'));assert.ok(prompt.includes('Scholay'));
});

test('signed-in pages use a per-site profile in the Center folder',async()=>{
  assert.deepEqual(parseMountSpec('web:https://www.scholay.com/,signedIn=true'),{kind:'web',url:'https://www.scholay.com/',render:true,signedIn:true});
  assert.equal(browserProfileDir('/c','https://www.scholay.com/x'),'/c/browser-profiles/www.scholay.com');
  assert.throws(()=>browserProfileDir('/c','http://localhost/'),/公开网址/);
  const home=mkdtempSync(join(tmpdir(),'order-signed-'));
  try{
    const calls=[],signed={...claim,id:'demand-scholay-2',payload:{brief:'---\nmount: web:https://www.scholay.com/,signedIn=true,shots=top\n---\n用科研助手演示。'}};
    const result=await prepareOrderMaterials({claim:signed,directory:join(home,'task'),home,origin:'https://center.example',render:fakeRender(calls)});
    assert.equal(calls[0].profile,join(home,'browser-profiles','www.scholay.com'));
    assert.match(result.prompt,/已登录/);
    await assert.rejects(renderPublicPage('https://www.scholay.com/',{profile:join(home,'browser-profiles','missing'),launch:async()=>{throw Error('must not launch');}}),/browser-login/);
    let opened;const events=[];
    const login=browserLogin('https://www.scholay.com/',{home,onReady:e=>events.push(e),launchPersistent:async profile=>{opened=profile;const handlers={};const page={goto:async()=>{},on:()=>{}};const context={pages:()=>[page],on:(name,fn)=>{handlers[name]=fn;},close:async()=>handlers.close?.()};setTimeout(()=>context.close(),5);return context;}});
    const done=await login;
    assert.equal(opened,join(home,'browser-profiles','www.scholay.com'));assert.equal(events[0].url,'https://www.scholay.com/');assert.equal(done.state,'closed');
  }finally{rmSync(home,{recursive:true,force:true});}
});

test('a question for the signed-in assistant is declared under its web line',async()=>{
  const text='---\nmount: web:https://www.scholay.com/claw,signedIn=true,shots=top|end\nask: 请用这份数据做独立样本 t 检验并解释结果表\nmodel: Qwen4 Max\nattach: /data/demo.sav\n---\n写一篇实操。';
  const {mounts}=parseBriefMounts(text);
  assert.deepEqual(mounts[0],{kind:'web',url:'https://www.scholay.com/claw',render:true,signedIn:true,shots:['top','end'],ask:'请用这份数据做独立样本 t 检验并解释结果表',model:'Qwen4 Max',attach:['/data/demo.sav']});
  assert.throws(()=>parseBriefMounts('---\nask: 孤立的问题\n---\n正文'),/web/);
  assert.throws(()=>parseBriefMounts('---\nmount: web:https://www.scholay.com/claw,signedIn=true\nask: 一\nask: 二\n---\n'),/一个 ask/);
  const home=mkdtempSync(join(tmpdir(),'order-ask-'));
  try{
    const calls=[],asking={...claim,id:'demand-scholay-3',payload:{brief:text}};
    const result=await prepareOrderMaterials({claim:asking,directory:join(home,'task'),home,origin:'https://center.example',render:fakeRender(calls)});
    assert.equal(calls[0].ask,'请用这份数据做独立样本 t 检验并解释结果表');assert.equal(calls[0].model,'Qwen4 Max');assert.deepEqual(calls[0].attach,['/data/demo.sav']);
    assert.match(result.prompt,/实际向网站助手提问（模型 Qwen4 Max），并上传了附件 demo\.sav/);assert.match(result.prompt,/逐项核对/);assert.match(result.prompt,/位置：页面末尾/);
    assert.ok(!result.prompt.includes('/data/demo.sav'),'local paths stay private');
    assert.ok(!result.prompt.includes('/c1'),'the account conversation address stays private');
  }finally{rmSync(home,{recursive:true,force:true});}
});

test('asking is refused without sign-in, off the assistant page, or with bad files',async()=>{
  const never={launch:async()=>{throw Error('must not launch');}};
  await assert.rejects(renderPublicPage('https://www.scholay.com/claw',{ask:'问',...never}),/signedIn/);
  await assert.rejects(renderPublicPage('https://www.scholay.com/journals/search',{ask:'问',profile:'/tmp/p',...never}),/助手页面/);
  await assert.rejects(renderPublicPage('https://www.scholay.com/claw',{ask:'问',profile:'/tmp/p',attach:['relative.csv'],...never}),/绝对路径/);
  await assert.rejects(renderPublicPage('https://www.scholay.com/claw',{ask:'问',profile:'/tmp/p',attach:['/nonexistent/x.csv'],...never}),/不存在/);
  await assert.rejects(renderPublicPage('https://www.scholay.com/journals/search',{attach:['/tmp/x'],...never}),/提问/);
  await assert.rejects(renderPublicPage('https://www.scholay.com/claw',{model:'Qwen4 Max',...never}),/提问/);
});

test('Center orders write with medium Codex reasoning by default',()=>{
  assert.equal(codexReasoningEffort({}),'medium');
  assert.equal(codexReasoningEffort({RSSD_CODEX_REASONING:'HIGH'}),'high');
  assert.throws(()=>codexReasoningEffort({RSSD_CODEX_REASONING:'extreme'}),/RSSD_CODEX_REASONING/);
});

test('an assistant turn that paused or failed is not treated as an answer',()=>{
  assert.equal(assistantStopped('已处理 44 秒\n本轮因套餐额度不足暂停。\n可以继续任务'),'本轮因套餐额度不足暂停。');
  assert.equal(assistantStopped('表 1 方差分析表\nF = 4.846'),null);
});

test('an update may use its own order screenshots next to the source edition images',async()=>{
  const {centerImageReference}=await import('../scripts/rssd-center-media-ref.mjs');
  const origin='https://center.example',url=id=>origin+'/api/rssd/v1/media/'+id+'/raw';
  const source={payload:{media:[{id:'media-old'}],bodyMarkdown:'![a]('+url('media-old')+')'}};
  const plain=centerImageReference({origin,source}),withOrder=centerImageReference({origin,source,extraMediaIds:['media-new']});
  assert.equal(plain(url('media-new')),false);assert.equal(withOrder(url('media-new')),true);assert.equal(withOrder(url('media-old')),true);assert.equal(withOrder(url('media-other')),false);
});

test('a pinned writer model must be the one the session reports',()=>{
  assert.equal(writerModelRequest({}),null);assert.equal(writerModelRequest({RSSD_WRITER_MODEL:'claude-opus-4-6'}),'claude-opus-4-6');
  assert.ok(writerModelMatches('claude-opus-4-6','claude-opus-4-6[thinking=true,context=200k,effort=high]'));
  assert.ok(writerModelMatches('claude-opus-4-6','claude-opus-4-6'));
  assert.ok(!writerModelMatches('claude-opus-4-6','default[]'));
  assert.ok(!writerModelMatches('claude-opus-4-6','claude-opus-4-7[thinking=true]'));
  assert.ok(!writerModelMatches('claude-opus-4','claude-opus-4-6[thinking=true]'),'a shorter name is not a match');
});

test('unescaped quotes inside Chinese prose are repaired only when reading',async()=>{
  const {parseCenterResult,repairInlineQuotes}=await import('../desktop/scripts/agent/center-producer.mjs');
  const broken='{"version":2,"kind":"article","title":"T","summary":"拒绝"两者独立"的零假设","skills":[],"fields":{},"groups":[],"blocks":[{"id":"p","type":"paragraph","state":"ready","text":"与"期望"比较","sourceIds":[]}],"sources":[],"blockNotes":{},"internalNotes":{}}';
  assert.throws(()=>JSON.parse(broken));
  const fixed=repairInlineQuotes(broken);assert.equal(fixed.count,4);
  const r=parseCenterResult(broken);assert.equal(r.summary,'拒绝“两者独立”的零假设');assert.equal(r.notebook.blocks[0].text,'与“期望”比较');
  assert.throws(()=>parseCenterResult('{"title": }'),/完整的文章 JSON/);
});

test('an interface demonstration is declared as a stage line with a scene name',()=>{
  assert.deepEqual(parseMountSpec('stage:lung-survival'),{kind:'stage',scene:'lung-survival'});
  assert.throws(()=>parseMountSpec('stage:../etc'),/场景名/);
  assert.throws(()=>parseMountSpec('stage:'),/场景名/);
  const {mounts}=orderMounts('---\nmount: stage:lung-survival\n---\n写一篇实操。');
  assert.deepEqual(mounts,[{kind:'stage',scene:'lung-survival'}]);
});

test('staged scenes become demonstration screenshots in the Center media folder',async()=>{
  const home=mkdtempSync(join(tmpdir(),'order-stage-'));
  try{
    const calls=[],origin='https://center.example';
    const staged={...claim,id:'demand-stage-1',payload:{brief:'---\nmount: stage:lung-survival\n---\n用演示讲生存分析。'}};
    const stage=async dir=>{calls.push(dir);return {url:'https://www.scholay.com/claw/claw-demo-lung',title:'晚期肺癌患者的性别与生存 · Scholay 科研助手界面演示',text:'【提问】能直接比平均天数吗？\n\n【回答】中位生存 426 天',truncated:false,rendered:true,staged:true,scene:'lung-survival',signedIn:false,viewport:{width:1440,height:900},dismissed:[],hidden:['[data-rhino-trigger]'],capturedAt:'2026-11-24T09:00:00.000Z',contentHash:'f'.repeat(64),images:['开头','第 1 轮回答中的图1'].map((anchor,i)=>({anchor,bytes:png(i+7),sha256:String(i).repeat(64),capturedAt:'2026-11-24T09:00:01.000Z',url:'https://www.scholay.com/claw/claw-demo-lung'}))};};
    const result=await prepareOrderMaterials({claim:staged,directory:join(home,'task'),home,origin,stage,render:async()=>{throw Error('must not render');}});
    assert.deepEqual(calls,[join(home,'scenes','lung-survival')]);
    assert.equal(result.receipt.pages[0].staged,true);assert.equal(result.receipt.pages[0].scene,'lung-survival');
    assert.equal(result.receipt.pages[0].images.length,2);
    assert.match(result.prompt,/界面演示/);assert.match(result.prompt,/Scholay 科研助手界面演示：/);assert.match(result.prompt,/不得把会话地址写成链接/);
    assert.match(result.prompt,/中位生存 426 天/);assert.match(result.prompt,/位置：第 1 轮回答中的图1/);
    assert.ok(!result.prompt.includes('采集：'),'demonstration captions carry no capture date');
    for(const image of result.receipt.pages[0].images)assert.ok(result.prompt.includes(image.url));
  }finally{rmSync(home,{recursive:true,force:true});}
});

test('a scene answers the assistant page locally and reads only public configuration',async()=>{
  const {sceneDir,readScene,sceneText,sceneApi}=await import('../desktop/scripts/agent/resources/stage.mjs');
  assert.equal(sceneDir('/c','lung-survival'),'/c/scenes/lung-survival');
  assert.throws(()=>sceneDir('/c','../x'),/场景名/);
  const home=mkdtempSync(join(tmpdir(),'scene-'));
  try{
    const {mkdirSync,writeFileSync}=await import('node:fs');
    const dir=join(home,'scenes','demo-scene');mkdirSync(dir,{recursive:true});
    await assert.rejects(readScene(dir),/没有界面演示场景/);
    const session={sessionId:'claw-demo-1',title:'演示',messages:[{id:'u1',type:'user',content:[{type:'text',text:'问题'}],timestamp:'2026-11-24T09:00:00.000Z'},{id:'a1',type:'assistant',content:[{type:'thinking',thinking:'x'},{type:'text',text:'回答 ![图](/api/v1/staging-assets/demo-scene/chart.png)'}],timestamp:'2026-11-24T09:00:30.000Z'}]};
    writeFileSync(join(dir,'scenario.json'),JSON.stringify({session}));writeFileSync(join(dir,'chart.png'),png(3));
    const read=await readScene(dir);assert.equal(read.session.title,'演示');
    assert.equal(sceneText(read.session),'【提问】问题\n\n【回答】回答 ［图：图］');
    const publicCalls=[];const api=sceneApi({session,name:'demo-scene',dir,fetchPublic:async path=>{publicCalls.push(path);return {status:200,contentType:'application/json',body:'{}'};}});
    const at=(method,path)=>api({method,url:new URL('https://www.scholay.com/api/v1'+path)});
    const messages=JSON.parse((await at('GET','/user/claw/session/messages?session_id=claw-demo-1')).body);assert.equal(messages.data.messages.length,2);
    assert.deepEqual(JSON.parse((await at('GET','/user/agent-session/resolve?session_id=claw-demo-1&scope=claw')).body).data,{owned:true,feature:'claw'});
    assert.equal((await at('GET','/staging-assets/demo-scene/chart.png')).contentType,'image/png');
    assert.equal((await at('GET','/staging-assets/other/chart.png')).status,404);
    await at('GET','/config/system');await at('GET','/user/models?feature=claw');
    assert.deepEqual(publicCalls,['/config/system','/public/models?feature=claw'],'signed-in reads never go to the backend');
    assert.equal(await at('POST','/user/claw/session/send'),null,'unknown calls are left to the 501 fallback');
  }finally{rmSync(home,{recursive:true,force:true});}
});

test('a brief may choose another writing family for its one article',()=>{
 assert.equal(parseBriefMounts('---\nwriting: scholay-walkthrough\nmount: stage:simpson-ucb\n---\n正文').family,'scholay-walkthrough');
 assert.equal(parseBriefMounts('---\nmount: stage:simpson-ucb\n---\n正文').family,undefined);
 assert.equal(parseBriefMounts('正文').family,undefined);
 assert.throws(()=>parseBriefMounts('---\nwriting: Scholay 实操\n---\n'),/写作族名/);
 assert.throws(()=>parseBriefMounts('---\nwriting: scholay-walkthrough\nwriting: method\n---\n'),/一行 writing/);
 // The family line is not material: an order that only chooses a family stages nothing.
 assert.equal(orderMounts('---\nwriting: scholay-walkthrough\n---\n正文').mounts.length,0);
});
