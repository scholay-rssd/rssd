import test from 'node:test';
import assert from 'node:assert/strict';
import protocol from '../contracts/rssd-v1.cjs';
const packet = {requestId:'request-one',workId:'work-one',workspaceId:'research',sectionId:'methods',
  editions:[{locale:'en',title:'Original English work',bodyMarkdown:'A complete original work.'}]};
test('English-only submissions are valid and publication metadata is explicitly bounded',()=>{
  const result=protocol.submission({...packet,credentials:'private',editions:[{...packet.editions[0],privateNote:'private'}]});
  assert.equal(result.editions[0].locale,'en');assert.equal(result.baseRevisions.en,0);
  assert(!JSON.stringify(result).includes('private'));assert.equal(result.editions[0].translationOf,null);
});
test('request fingerprints are key-order invariant but bind every edition and base revision',()=>{
  assert.equal(protocol.hash({b:2,a:1}),protocol.hash({a:1,b:2}));
  assert.notEqual(protocol.hash(packet),protocol.hash({...packet,baseRevisions:{en:1}}));
});
test('protocol rejects conflicting edition identities, invalid revisions and partial claim credentials',()=>{
  assert.throws(()=>protocol.submission({...packet,editions:[...packet.editions,...packet.editions]}),/unique/);
  assert.throws(()=>protocol.submission({...packet,baseRevisions:{en:-1}}),/baseRevision/);
  assert.throws(()=>protocol.submission({...packet,demandId:'task-one'}),/together/);
  assert.throws(()=>protocol.submission({...packet,editions:[{...packet.editions[0],sources:[{url:'javascript:alert(1)'}]}]}),/url/);
});
test('translation orders refer to an immutable source and policy targets cannot be duplicated',()=>{
  assert.throws(()=>protocol.demand({workspaceId:'research',sectionId:'methods',title:'Translate',kind:'translate'}),/source edition/);
  const target={destinationId:'website',locale:'en'};
  assert.throws(()=>protocol.policy({targets:[target,target]}),/Duplicate/);
});
test('editions must list every body-referenced center media ID before they can be accepted',()=>{
  const mediaId='media-'+'a'.repeat(48),body='Complete prose.\n\n![One](/api/rssd/v1/media/'+mediaId+'/raw)\n\n![Two](https://center.example/api/rssd/v1/media/media-second/raw)';
  assert.deepEqual(protocol.referencedMediaIds(body),[mediaId,'media-second']);
  assert.throws(()=>protocol.edition({locale:'en',title:'English',bodyMarkdown:body,media:[]}),{code:'missing_media'});
  assert.throws(()=>protocol.edition({locale:'en',title:'English',bodyMarkdown:body,media:[{id:mediaId,alt:'One'}]}),{code:'missing_media'});
  const complete=protocol.edition({locale:'en',title:'English',bodyMarkdown:body,media:[{id:mediaId,alt:'One'},{id:'media-second',alt:'Two'}]});
  assert.equal(complete.media.length,2);
  assert.deepEqual(protocol.edition({locale:'zh-CN',title:'中文',bodyMarkdown:'No images'}).media,[]);
});
