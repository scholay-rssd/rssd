import test from 'node:test';
import assert from 'node:assert/strict';
import recordContract from '../contracts/rssd-record.cjs';
import publication from '../contracts/rssd-publication.cjs';

const labels = {
  year: ['Summary', 'Body'],
  history: ['Fact Summary', 'Historical Significance'],
  openSource: ['Project Overview', 'Research Value'],
};
const chinese = {
  year: ['摘要', '正文'],
  history: ['事实摘要', '历史意义'],
  openSource: ['项目简介', '学术价值'],
};
function edition(kind, headings = labels[kind], locale = 'en') {
  return {
    locale, title: 'Synthetic record', summary: 'A synthetic summary.',
    bodyMarkdown: '# Synthetic record\n\n## ' + headings[0] + '\n\nFirst section.\n\n## ' + headings[1] + '\n\nSecond section.',
    sources: [], media: [],
    metadata: {record: {kind, fields: kind === 'openSource' ? {url: 'https://example.org/project'} : {id: kind + ':fixture'}}},
  };
}

for (const [kind, keys] of [
  ['year', ['summary', 'body']],
  ['history', ['factSummary', 'historicalSignificance']],
  ['openSource', ['summary', 'value']],
]) {
  test('English ' + kind + ' sections cross the publication boundary without Chinese labels', () => {
    const input = edition(kind);
    const fields = recordContract.recordFields(input.metadata.record, input);
    assert.equal(fields[keys[0]], 'First section.');
    assert.equal(fields[keys[1]], 'Second section.');
    const published = publication.publicContent(input);
    assert.equal(published.locale, 'en');
    assert.equal(published.bodyMarkdown, input.bodyMarkdown);
    assert.deepEqual(published.metadata.record, input.metadata.record);
  });
}

test('existing Chinese labels remain valid for Chinese and legacy English records', () => {
  for (const kind of Object.keys(chinese)) for (const locale of ['zh-CN', 'en']) {
    const input = edition(kind, chinese[kind], locale);
    assert.equal(publication.publicContent(input).bodyMarkdown, input.bodyMarkdown);
  }
  const original = edition('year', chinese.year);
  delete original.locale;
  assert.equal(recordContract.recordFields(original.metadata.record, original).summary, 'First section.');
});

test('English matching accepts heading case and common section names', () => {
  for (const [kind, headings] of [
    ['year', ['summary', 'Details']],
    ['history', ['Facts', 'academic significance']],
    ['openSource', ['Project Summary', 'Practical Value']],
  ]) assert.doesNotThrow(() => publication.publicContent(edition(kind, headings)));
});

test('English aliases do not change the Chinese record contract', () => {
  assert.throws(() => publication.publicContent(edition('year', labels.year, 'zh-CN')), /retain one heading/);
});

test('missing, duplicated and reordered English sections are rejected', () => {
  const missing = edition('year');
  missing.bodyMarkdown = '# Synthetic record\n\n## Summary\n\nOnly one section.';
  assert.throws(() => publication.publicContent(missing), /retain one heading/);
  const duplicate = edition('year');
  duplicate.bodyMarkdown += '\n\n## 摘要\n\nAmbiguous duplicate.';
  assert.throws(() => publication.publicContent(duplicate), /retain one heading/);
  assert.throws(() => publication.publicContent(edition('year', ['Body', 'Summary'])), /out of order/);
});

test('a heading shown in a fenced code example is not a duplicate section', () => {
  const input = edition('year');
  input.bodyMarkdown += '\n\n```markdown\n## Summary\n```';
  assert.doesNotThrow(() => publication.publicContent(input));
});
