import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createConfiguredTopicAdapters,runConfiguredMultisite} from '../scripts/rssd-multisite-runtime.mjs';
import {main,desktopWorker,desktopEventStatus,honorDesktopStop} from '../scripts/rssd-multisite-cli.mjs';
import {withFileLock} from '../scripts/editorial-lock.mjs';
import {editorialContract} from '../scripts/rssd-editorial-contract.mjs';
const slot={siteId:'enter',workspaceId:'enter',sectionId:'forums',contentMode:'opensource',editorialRules:['核对官方仓库及许可证']},lead={title:'Primary',url:'https://source.example/article'};
test('a stop arriving before the worker takes its lock is retained and cancels startup',async t=>{
 const home=await mkdtemp(join(tmpdir(),'rssd-start-stop-'));t.after(()=>rm(home,{recursive:true,force:true}));const controller=new AbortController();await honorDesktopStop(home,controller);assert.equal(controller.signal.aborted,false);await writeFile(join(home,'stop.json'),'{}');await honorDesktopStop(home,controller);assert.equal(controller.signal.aborted,true);assert.equal(await readFile(join(home,'stop.json'),'utf8'),'{}');
});
test('real adapter composition scopes RSS, rereads source and requires positive semantic verification',async()=>{
 const calls=[];let instructions;const a=createConfiguredTopicAdapters({catalog:{},organizations:{enter:{siteId:'enter'}},fetchLeads:async input=>{calls.push(input.policy);return {...slot,leads:[lead]};},fetchPage:async url=>{calls.push(url);return {reachable:true,originalUrl:url,finalUrl:url,text:'Read this actual source content. '.repeat(20)};},generateTopics:async input=>{instructions=input.editorialInstructions;return [{title:'Topic',brief:'Brief',sources:[{...lead}]}];},judgeTopic:async()=>({duplicate:false,confidence:'high'}),judgeSource:async()=>({primarySource:true,supportsTopic:true,confidence:'high'})});
 const leads=await a.sourceLeads({slot}),candidate=await a.generate({slot,leads:leads.leads,existingTitles:[]});assert.equal((await a.judge({slot,candidate,existingTitles:[]})).duplicate,false);
 const checked=await a.verifySource({slot,source:lead,candidate});assert.equal(checked.verified,true);assert.equal(checked.supportsTopic,true);assert.equal(calls.filter(x=>typeof x==='string').length,2);assert.deepEqual(calls[0],{siteId:'enter',sectionId:'forums',enabled:true});assert.match(instructions,/资源介绍/);assert.match(instructions,/核对官方仓库及许可证/);
});
test('untrusted or unreadable sources and unknown site cannot proceed',async()=>{
 const a=createConfiguredTopicAdapters({catalog:{},organizations:{},fetchLeads:async()=>({}),fetchPage:async()=>({}),generateTopics:async()=>[],judgeTopic:async()=>({}),judgeSource:async()=>({})});await assert.rejects(a.sourceLeads({slot}),/organization missing/);await assert.rejects(a.generate({slot,leads:[lead],existingTitles:[]}),/No readable/);
});
test('the classical-studies site uses its own existing mode and source constraints',()=>{
 const text=editorialContract({siteId:'xsiching',contentMode:'encyclopedia',editorialRules:['保留原典与注家分歧']});
 assert.match(text,/国学词条/);assert.match(text,/四书五经/);assert.match(text,/保留原典与注家分歧/);
 assert.throws(()=>editorialContract({siteId:'pets',contentMode:'unknown'}),/editorial contract/);
});
test('runtime is inert by default and CLI check requires no Center access',async t=>{
 assert.deepEqual(await runConfiguredMultisite(),{state:'disabled'});
 const dir=await mkdtemp(join(tmpdir(),'rssd-runtime-config-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const snapshot={version:1,timezone:'Asia/Shanghai',sites:[]},files={snapshot:join(dir,'snapshot.json'),profiles:join(dir,'profiles.json'),config:join(dir,'config.json')};
 await writeFile(files.snapshot,JSON.stringify(snapshot));await writeFile(files.profiles,'[]');await writeFile(files.config,JSON.stringify({version:1,enabled:false,sections:[],cutovers:{},home:dir,schedulePath:files.snapshot,profilesPath:files.profiles}));
 assert.deepEqual(await main(['--check',files.config]),{state:'checked',enabled:false,configuredSections:0});assert.deepEqual(await main(['--run',files.config]),{state:'disabled'});
 await assert.rejects(desktopWorker({home:dir,configPath:files.config}),/尚未启用/);assert.equal(JSON.parse(await readFile(join(dir,'worker.json'),'utf8')).state,'blocked');
 await writeFile(join(dir,'worker.json'),JSON.stringify({pid:999,state:'working'}));
 await withFileLock(join(dir,'daemon.lock'),async()=>{await assert.rejects(desktopWorker({home:dir,configPath:files.config}),/尚未启用/);});assert.equal(JSON.parse(await readFile(join(dir,'worker.json'),'utf8')).state,'working');
});

test('parallel capture and dispatch events never change an active article to idle',()=>{
 let next=desktopEventStatus({type:'work',state:'running'});assert.equal(next.patch.state,'working');next=desktopEventStatus({type:'capture',state:'idle'},next.activeArticle);assert.equal(next.patch.state,'working');next=desktopEventStatus({type:'dispatch',state:'blocked'},next.activeArticle);assert.equal(next.patch.state,'working');next=desktopEventStatus({type:'work',state:'submitted'},next.activeArticle);assert.equal(next.patch.state,'idle');
});

test('CLI accepts a separate explicit new schedule for an inactive placeholder',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'rssd-new-rule-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const snapshot={version:1,timezone:'Asia/Shanghai',sites:[{siteId:'personal',sections:[{sectionId:'news',legacyScheduleFile:{scopeBeforeGlobalHold:'disabled'}}]}]};
 const rules={version:1,timezone:'Asia/Shanghai',sites:[{siteId:'personal',sections:[{sectionId:'news',provenance:{kind:'owner-authorized-new-rule',note:'owner requested all sites'},dailyLimit:1,contentMode:'news',requireFlow:true,requiredLocales:['zh-CN'],slots:[{id:'new-morning',time:'10:00',count:1}]}]}]};
 const snapshotPath=join(dir,'snapshot.json'),profilesPath=join(dir,'profiles.json'),newRulesPath=join(dir,'new.json'),configPath=join(dir,'config.json');
 await writeFile(snapshotPath,JSON.stringify(snapshot));await writeFile(profilesPath,JSON.stringify([{id:'personal',spaceId:'personal'}]));await writeFile(newRulesPath,JSON.stringify(rules));
 const config={version:1,enabled:false,home:dir,schedulePath:snapshotPath,profilesPath,newRulesPath,cutovers:{},sections:[{siteId:'personal',workspaceId:'personal',sectionId:'news',destinationId:'site-personal',enabled:true,verified:true,requiredLocales:['zh-CN']}]};
 await writeFile(configPath,JSON.stringify(config));assert.equal((await main(['--check',configPath])).configuredSections,1);
 delete config.newRulesPath;await writeFile(configPath,JSON.stringify(config));await assert.rejects(main(['--check',configPath]),/verified plan/);
});

test('configured supervisor holds the desktop daemon lock and heartbeats with the device',async t=>{
 const home=await mkdtemp(join(tmpdir(),'rssd-runtime-lock-'));t.after(()=>rm(home,{recursive:true,force:true}));const controller=new AbortController(),pulses=[];
 const args={enabled:true,home,connection:{origin:'https://center.example',orgId:'org',workerId:'device'},client:{origin:'https://center.example',request:async()=>{throw Error('not used');},publications:async()=>[],activeClaim:async()=>null,submission:async()=>null,heartbeat:async x=>pulses.push(x)},plan:{version:1,timezone:'Asia/Shanghai',sites:[]},configs:[],profiles:[],catalog:{},organizations:{},writerProof:async()=>({}),signal:controller.signal,onLockAcquired:async()=>controller.abort()};
 await withFileLock(join(home,'daemon.lock'),async()=>{await assert.rejects(runConfiguredMultisite(args));});assert.equal(pulses.length,0);
 assert.equal((await runConfiguredMultisite(args)).state,'cancelled');assert.equal(pulses.length,1);assert.equal(pulses[0].agentId,'codex');
});
