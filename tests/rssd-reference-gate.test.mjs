import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyAutomatedReferences} from '../scripts/rssd-reference-gate.mjs';

const make = () => ({
  bodyMarkdown:'## 研究问题\n\n正文引用 [原文](https://example.org/a)。\n\n## 参考文献\n\n1. [论文甲](https://example.org/a)\n2. [论文乙](https://example.org/b)\n',
  sources:[{title:'论文甲',url:'https://example.org/a'},{title:'论文乙',url:'https://example.org/b'}],
  metadata:{notebook:{sources:[{id:'a',url:'https://example.org/a'},{id:'b',url:'https://example.org/b'}],blocks:[{id:'p',sourceIds:['a','b']}],blockNotes:{p:{notes:{verification:'private'}}}}}
});

test('accepts a complete linked bibliography without modifying the notebook',()=>{
  const edition=make(),original=structuredClone(edition);
  assert.deepEqual(verifyAutomatedReferences(edition),{ok:true,sourceCount:2});
  assert.deepEqual(edition,original);
});
test('refuses missing references and a source linked only in body prose',()=>{
  const edition=make();edition.bodyMarkdown=edition.bodyMarkdown.replace('2. [论文乙](https://example.org/b)','正文已有 [论文乙](https://example.org/b)');
  edition.bodyMarkdown=edition.bodyMarkdown.replace('正文已有 [论文乙](https://example.org/b)','未列第二项');
  assert.throws(()=>verifyAutomatedReferences(edition),/未覆盖/);
  edition.bodyMarkdown='正文 [原文](https://example.org/a)';
  assert.throws(()=>verifyAutomatedReferences(edition),/未覆盖/);
});
test('refuses tracking links, missing structured sources, and orphan source IDs',()=>{
  const tracking=make();tracking.bodyMarkdown=tracking.bodyMarkdown.replace('https://example.org/a)。','https://example.org/a?utm_source=openai)。');
  assert.throws(()=>verifyAutomatedReferences(tracking),/追踪/);
  const unknown=make();unknown.metadata.notebook.blocks[0].sourceIds.push('unknown');
  assert.throws(()=>verifyAutomatedReferences(unknown),/不存在/);
  const altered=make();altered.sources.pop();assert.throws(()=>verifyAutomatedReferences(altered),/不一致/);
});
test('does not count links after the references section as references',()=>{
  const edition=make();edition.bodyMarkdown='## 参考文献\n\n1. [论文甲](https://example.org/a)\n\n## 附录\n\n[论文乙](https://example.org/b)';
  assert.throws(()=>verifyAutomatedReferences(edition),/未覆盖/);
});
test('refuses an additional reference without a matching source record',()=>{
  const edition=make();edition.bodyMarkdown+='3. [未登记](https://example.org/unknown)\n';
  assert.throws(()=>verifyAutomatedReferences(edition),/未登记/);
});
