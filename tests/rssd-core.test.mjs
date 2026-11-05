import test from 'node:test';
import assert from 'node:assert/strict';
import {TASK_MODES,MODE_KEYS,CONTENT_MODE_KEYS,modeName,modeKey,modeLabel,isContentMode,isSingleTopicMode} from '../contracts/task-modes.mjs';
import {normalizeStep,topicGate,outlineGate,generationGate,artifactReady,isReadOnly} from '../contracts/task-lifecycle.mjs';
import {taskOriginProblems,assertTaskOrigin,adHocDemand} from '../contracts/task-origin.mjs';
import {SYNC_STATES,synchronizationState,siteSyncStates,overallSyncState} from '../contracts/sync-state.mjs';
import {synchronizationState as scriptState} from '../scripts/editorial-sync.mjs';
import {TASK_TYPE_IDS,TASK_MODE_NAMES,isArticleType,isSingleTopic} from '../desktop/scripts/agent/task-types.mjs';

test('core modes keep every stored key, label and topic station of the desktop registry',()=>{
  assert.deepEqual(new Set(MODE_KEYS),new Set(Object.keys(TASK_MODE_NAMES)));
  assert.deepEqual(CONTENT_MODE_KEYS,TASK_TYPE_IDS);
  for(const key of MODE_KEYS){
    assert.equal(modeLabel(key),TASK_MODE_NAMES[key],key);
    assert.equal(isContentMode(key),isArticleType(key),key);
    assert.equal(isSingleTopicMode(key),isSingleTopic(key),key);
  }
});

test('mode names translate both ways and labels come from the domain pack first',()=>{
  for(const key of MODE_KEYS)assert.equal(modeKey(modeName(key)),key);
  assert.equal(modeName('xiwen'),'digest');
  assert.equal(modeLabel('xiwen',{pack:{labels:{xiwen:'学界犀闻'}}}),'学界犀闻');
  assert.equal(modeLabel('xiwen',{pack:{labels:{xiwen:{en:'Academic digest'}}},locale:'en'}),'Academic digest');
  assert.equal(modeLabel('history',{locale:'en'}),'Historical event');
  assert.throws(()=>modeName('review'),/Unknown task mode/);
  assert.throws(()=>modeKey('xiwen'),/Unknown task mode name/);
  assert.ok(Object.isFrozen(TASK_MODES));
});

const board=(items,slots=[])=>({sections:[{id:'s1',items,slots}]});
const task=fields=>({mode:'xiwen',revision:2,board:board([]),outline:{blocks:[]},workIds:[],articleId:'a1',...fields});

test('workflow steps map the old review stage onto editing',()=>{
  assert.equal(normalizeStep('review'),'draft');
  assert.equal(normalizeStep('brief'),'brief');
  assert.throws(()=>normalizeStep('publish'),/Unknown workflow step/);
});

test('topic confirmation needs chosen material and no unfilled smart slots',()=>{
  assert.deepEqual(topicGate(task({})).reasons,['no_material']);
  assert.equal(topicGate(task({board:board([{id:'m1'}])})).ok,true);
  assert.deepEqual(topicGate(task({board:board([{id:'m1',excluded:true}])})).reasons,['no_material']);
  const pending=board([{id:'m1'}],[{id:'slot',mode:'smart'}]);
  assert.deepEqual(topicGate(task({board:pending})).reasons,['pending_smart_slots']);
  assert.equal(topicGate(task({board:board([{id:'slot'}],[{id:'slot',mode:'smart'}])})).ok,true);
  const two=board([{id:'m1'},{id:'m2',selected:true}]);
  assert.equal(topicGate(task({board:two})).ok,true);
  assert.deepEqual(topicGate(task({mode:'calendar',board:two})).reasons,['too_many_materials']);
  assert.deepEqual(topicGate(task({board:board([{id:'m1'}]),completedAt:'2026-11-03'})).reasons,['read_only']);
});

test('outline confirmation and generation follow the two confirmations and authorization',()=>{
  assert.deepEqual(outlineGate(task({})).reasons,['topic_unconfirmed','empty_outline']);
  assert.equal(outlineGate(task({topicConfirmed:'t1',outline:{blocks:[{id:'b',type:'paragraph',text:'x'}]}})).ok,true);
  assert.deepEqual(generationGate(task({topicConfirmed:'t1'}),'draft').reasons,['outline_unconfirmed','not_authorized']);
  assert.equal(generationGate(task({topicConfirmed:'t1',workflow:{authorized:true}}),'outline').ok,true);
  assert.equal(isReadOnly(task({completedAt:'x'})),true);
});

test('a stage completes only on a saved artifact from the run its confirmation started',()=>{
  const outline={titleCandidates:['Title'],blocks:[{id:'b',type:'paragraph',text:'Body'}]};
  const pending={action:'outline',confirmation:'t1',revision:1};
  assert.equal(artifactReady(pending,task({topicConfirmed:'t1',outline}),null),true);
  assert.equal(artifactReady(pending,task({topicConfirmed:'t2',outline}),null),false,'another confirmation');
  assert.equal(artifactReady(pending,task({topicConfirmed:'t1',outline,revision:1}),null),false,'nothing saved since');
  assert.equal(artifactReady(pending,task({topicConfirmed:'t1',outline:{...outline,blocks:[{id:'b',type:'paragraph',text:'Body',stale:true}]}}),null),false);
  const generated={revision:3,sha:'abc',at:'2026-11-03T02:00:00Z'};
  const draft=task({outlineConfirmed:'o1',workIds:['a1'],generated});
  const draftRun={action:'draft',confirmation:'o1',revision:2,generatedAt:'2026-11-03T01:00:00Z'};
  const check={sha256:'abc',checks:[{key:'body',ok:true},{key:'record',ok:true}]};
  assert.equal(artifactReady(draftRun,draft,check),true);
  assert.equal(artifactReady(draftRun,draft,{...check,sha256:'other'}),false,'check of another file');
  assert.equal(artifactReady(draftRun,draft,{...check,checks:[{key:'body',ok:true},{key:'record',ok:false}]}),false);
  assert.equal(artifactReady({...draftRun,generatedAt:generated.at},draft,check),false,'the previous generation');
  assert.equal(artifactReady(draftRun,{...draft,draftStale:true},check),false);
  assert.equal(artifactReady(draftRun,{...draft,completedAt:'x'},check),false);
});

test('content tasks start only from a claimed Center demand',()=>{
  const demand={id:'d1',workspaceId:'metho',sectionId:'frontiers',claimToken:'c1'};
  assert.deepEqual(taskOriginProblems({mode:'xiwen'}),['no_demand']);
  assert.deepEqual(taskOriginProblems({mode:'xiwen',demand:{...demand,claimToken:undefined}}),['unclaimed']);
  assert.deepEqual(taskOriginProblems({mode:'xiwen',demand}),[]);
  assert.deepEqual(taskOriginProblems({mode:'rss'}),[]);
  assert.deepEqual(taskOriginProblems({mode:'image'}),[]);
  assert.deepEqual(taskOriginProblems({mode:'unknown'}),['unknown_mode']);
  assert.throws(()=>assertTaskOrigin({mode:'history'}),/claimed demand: no_demand/);
});

test('an ad-hoc article becomes a valid demand with its planned format',()=>{
  const {demand,format}=adHocDemand({workspaceId:'metho',sectionId:'frontiers',title:'A new dataset',mode:'opensource'});
  assert.equal(demand.kind,'write');
  assert.deepEqual(demand.requiredLocales,['zh-CN','en']);
  assert.match(demand.id,/^[0-9a-f-]{36}$/);
  assert.deepEqual(format,{mode:'opensource',name:'resource'});
  assert.throws(()=>adHocDemand({workspaceId:'metho',sectionId:'frontiers',title:'x',mode:'rss'}),/content mode/);
  assert.throws(()=>adHocDemand({workspaceId:'metho',sectionId:'frontiers',title:' ',mode:'xiwen'}),/Invalid title/);
});

test('sync state is computed per site and summarized for a badge',()=>{
  assert.equal(scriptState,synchronizationState,'scripts reuse the contract');
  const states=siteSyncStates({sites:['metho','study','enter'],local:'F2',
    bases:{metho:{fingerprint:'F2',revision:4},study:{fingerprint:'F1',revision:2}},
    remotes:{metho:{version:4},study:{version:2},enter:{version:1}},known:{metho:true,study:true,enter:true}});
  assert.deepEqual(states,{metho:'synced',study:'local_changed',enter:'unlinked'});
  assert.equal(overallSyncState(states),'unlinked');
  assert.deepEqual(siteSyncStates({sites:['metho'],local:'F',known:{metho:true},invalid:true}),{metho:'invalid'});
  assert.deepEqual(siteSyncStates({sites:['metho'],local:'F',pending:{metho:true}}),{metho:'publishing'});
  assert.deepEqual(siteSyncStates({sites:['metho'],local:'F'}),{metho:'unknown'});
  assert.equal(overallSyncState({a:'synced',b:'conflict'}),'conflict');
  assert.equal(overallSyncState({a:'synced'}),'synced');
  assert.equal(overallSyncState({}),'unknown');
  assert.throws(()=>overallSyncState({a:'synced',b:'later'}),/Unknown sync state: later/);
  assert.throws(()=>siteSyncStates({sites:['a','a'],local:'F'}),/unique/);
  assert.equal(SYNC_STATES.length,9);
});
