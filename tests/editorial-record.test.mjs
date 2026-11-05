import test from 'node:test';
import assert from 'node:assert/strict';
import {RECORD_STRUCTURE,UNNUMBERED_HEADINGS,kindOfCategory,recordHeadings,headingContract,structureFor,normalizeRecordMarkdown,recordStructureIssue,recordFields,recordMarkdown} from '../scripts/editorial-record.mjs';

test('one definition describes every structured column',()=>{
  assert.deepEqual(Object.keys(RECORD_STRUCTURE),['year','history','openSource']);
  assert.equal(kindOfCategory('昔日学术'),'history');assert.equal(kindOfCategory('学者观察'),null);
  assert.deepEqual(recordHeadings('openSource'),['项目简介','学术价值']);
  assert.equal(headingContract('year'),'“## 摘要”“## 正文”');
  assert.deepEqual(structureFor('学术开源'),{kind:'openSource',sections:['项目简介','学术价值'],unnumbered:['项目简介','学术价值',...UNNUMBERED_HEADINGS]});
  assert.deepEqual(structureFor('学者观察'),{kind:null,sections:[],unnumbered:UNNUMBERED_HEADINGS});
  for(const kind of Object.keys(RECORD_STRUCTURE))assert.equal(recordStructureIssue(kind,recordMarkdown(kind,{title:'标题'})),null);
});

test('structural headings are read tolerantly and rewritten in canonical form',()=>{
  const loose='# 标题\r\n\r\n ＃＃事实 摘要 ##\r\n\r\n甲\r\n\r\n##学术意义\r\n\r\n乙\n\n```\n##学术意义\n```\n';
  const canonical=normalizeRecordMarkdown('history',loose);
  assert.equal(canonical,'# 标题\n\n## 事实摘要\n\n甲\n\n## 学术意义\n\n乙\n\n```\n##学术意义\n```\n');
  assert.equal(normalizeRecordMarkdown('history',canonical),canonical);
  assert.deepEqual(recordFields('history',{year:2015},loose),{year:2015,title:'标题',factSummary:'甲',historicalSignificance:'乙\n\n```\n##学术意义\n```'});
  // An ordinary article and an unknown kind are never rewritten.
  assert.equal(normalizeRecordMarkdown(null,loose),loose);
  assert.equal(normalizeRecordMarkdown('history','## 事实摘要补充\n'),'## 事实摘要补充\n');
});

test('a broken record is named precisely instead of being guessed at',()=>{
  assert.equal(recordStructureIssue(null,'# 任意'),null);
  assert.match(recordStructureIssue('history','# 标题\n\n## 事实摘要\n\n甲\n'),/学术意义/);
  assert.match(recordStructureIssue('history','# 标题\n\n## 学术意义\n\n乙\n\n## 事实摘要\n\n甲\n'),/事实摘要|学术意义/);
  assert.match(recordStructureIssue('year','# 标题\n\n导语\n\n## 摘要\n\n甲\n\n## 正文\n\n乙\n'),/导语/);
  assert.match(recordStructureIssue('year','## 摘要\n\n甲\n\n## 正文\n\n乙\n'),/一级标题/);
});
