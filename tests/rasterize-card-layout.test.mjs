import test from 'node:test';
import assert from 'node:assert/strict';
import {pageDocument, pendingLayouts} from '../scripts/rasterize-card-layout.mjs';

const hash = c => c.repeat(64);
const item = (id, representation, variant, revision = 1, extra = {}) => ({id, workId: 'work-' + id.slice(-1), locale: 'zh-CN', representation, variant, current: true,
  source: {revision, editionHash: hash('a'), hash: hash('b')}, ...extra});

test('only current layouts without a raster set of the same method and revision are pending', async () => {
  const pages = [
    {items: [item('layout-1', 'layout', 'ai-code'), item('raster-1', 'raster', 'ai-image'), item('layout-2', 'layout', 'ai-code')], next: 'raster-2'},
    {items: [item('raster-2', 'raster', 'ai-code'), item('layout-3', 'layout', 'algorithm', 1, {current: false}), item('layout-4', 'layout', 'algorithm', 2)], next: null}
  ];
  const paths = [];
  const client = {request: async path => { paths.push(path); return pages[paths.length - 1]; }};
  const pending = await pendingLayouts(client, 'metho', 'zh-CN');
  // layout-1 has only an ai-image raster, which is another method; layout-2 already has its ai-code raster.
  assert.deepEqual(pending.map(entry => entry.id), ['layout-1', 'layout-4']);
  assert.deepEqual(paths, ['/editorial/metho/renditions?locale=zh-CN&limit=100', '/editorial/metho/renditions?locale=zh-CN&limit=100&after=raster-2']);
});

test('a page document keeps the stored CSS inside its style element', () => {
  const html = pageDocument({locale: 'zh-CN', css: 'p{color:red}</style><script>alert(1)</script>'}, '<article class="sheet">x</article>');
  assert.equal(html.match(/<\/style>/g).length, 1);
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /<body><article class="sheet">x<\/article><\/body>/);
  assert.throws(() => pageDocument({locale: 'not a locale', css: ''}, ''));
});
