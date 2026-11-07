import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {prepareEditionMedia} from '../scripts/rssd-device-media.mjs';
import {produceCenterEdition} from '../desktop/scripts/agent/center-producer.mjs';
import {
  ISOLATED_SOURCE_MARK,ISOLATED_WORK_ID,adapterLaunchOk,assertIsolatedGuards,createIsolatedFixture,
  isolatedProducer,isolatedSkillSnapshot,parseIsolatedArgs,probeIsolatedAcceptance,
} from '../scripts/rssd-translate-isolated-acceptance.mjs';
import {enqueueTranslateContinuation} from '../scripts/rssd-translate-continuation.mjs';
import {ARTICLE_WRITING_POLICY} from '../contracts/article-writing-policy.mjs';

test('isolated acceptance is fail-closed without the t575 flag, live tokens, or a non-codex agent',()=>{
  assert.equal(parseIsolatedArgs([]).probe,true);
  assert.equal(parseIsolatedArgs(['--run','--i-accept-isolated-provider']).run,true);
  assert.throws(()=>assertIsolatedGuards({agent:'cursor',run:true,accepted:true}),/Codex ACP only/);
  assert.throws(()=>assertIsolatedGuards({agent:'codex',run:true,accepted:false}),/--i-accept-isolated-provider/);
  assert.throws(()=>assertIsolatedGuards({agent:'codex',run:true,accepted:true,env:{RSSD_CENTER_TOKEN:'x'}}),/production credentials/);
  assert.throws(()=>assertIsolatedGuards({agent:'codex',run:false,accepted:false,codexPath:'/tmp/.codex/auth.json'}),/auth file/);
  assert.doesNotThrow(()=>assertIsolatedGuards({agent:'codex',run:true,accepted:true,env:{}}));
});

test('isolated fixture source is labeled and is not a production Enter work',async()=>{
  const fixture=await createIsolatedFixture();
  assert.equal(fixture.work.id,ISOLATED_WORK_ID);
  assert.equal(fixture.work.workspaceId,'enter');
  assert.equal(fixture.work.sectionId,'forums');
  assert.match(fixture.work.editions[0].payload.title,new RegExp(ISOLATED_SOURCE_MARK.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.equal(fixture.work.editions.some(edition=>edition.locale==='en'),false);
  assert.equal(fixture.client.origin,'https://center.example');
  const queued=await enqueueTranslateContinuation({client:fixture.client,workId:ISOLATED_WORK_ID});
  assert.equal(queued.status,'created');
  assert.equal(queued.workId,ISOLATED_WORK_ID);
  assert.equal(queued.source.locale,'zh-CN');
  assert.match(queued.sourceHash,/^[a-f0-9]{64}$/);
});

test('isolated producer is produceCenterEdition and keeps the writing-policy snapshot',async t=>{
  const home=await mkdtemp(join(tmpdir(),'rssd-t575-skill-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const producer=isolatedProducer({launch:async()=>{throw Error('must not launch in this unit test');}},1000);
  assert.equal(producer.name,'');
  const input={claim:{id:'d',generation:1},directory:home,writingPolicy:{version:ARTICLE_WRITING_POLICY,instructions:'x'}};
  const snapshot=await isolatedSkillSnapshot(input);
  assert.equal(snapshot.skills[0].id,'t575-isolated-acceptance');
  assert.match(snapshot.skills[0].content,/Not an Enter production work/);
  const source=producer.toString();
  assert.match(source,/produceCenterEdition/);
  assert.equal(typeof produceCenterEdition,'function');
  assert.equal(adapterLaunchOk({command:'/usr/bin/codex',args:[]}),false);
  assert.equal(adapterLaunchOk({command:process.execPath,args:['/bundle/desktop/runtime/node_modules/@agentclientprotocol/codex-acp/dist/index.js']}),true);
});

test('isolated acceptance refuses public image fetch instead of outbound download',async t=>{
  const home=await mkdtemp(join(tmpdir(),'rssd-t575-media-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const previous=process.env.RSSD_ISOLATED_ACCEPTANCE;
  process.env.RSSD_ISOLATED_ACCEPTANCE='1';
  t.after(()=>{if(previous===undefined)delete process.env.RSSD_ISOLATED_ACCEPTANCE;else process.env.RSSD_ISOLATED_ACCEPTANCE=previous;});
  await assert.rejects(prepareEditionMedia({
    edition:{locale:'en',title:'x',bodyMarkdown:'![n](https://images.example/figure.png)'},
    home,directory:join(home,'job'),client:{origin:'https://center.example'},workspaceId:'enter',
    fetchBytes:async()=>{throw Error('must not fetch');},
  }),/refuses public image fetch/);
});

test('probe uses the fixture center, isolated agents.json, and reports a missing adapter without substituting a fake ACP',async t=>{
  const home=await mkdtemp(join(tmpdir(),'rssd-t575-probe-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const probe=await probeIsolatedAcceptance({home});
  assert.equal(probe.workId,ISOLATED_WORK_ID);
  assert.equal(probe.queued.workId,ISOLATED_WORK_ID);
  assert.equal(probe.fixtureOrigin,'https://center.example');
  assert.equal(probe.producer,'produceCenterEdition');
  assert.equal(probe.adapterOk,false);
  assert.match(probe.adapterError,/ACP 适配器|ACP adapter|未找到/);
  assert.equal(probe.launch,null);
});
