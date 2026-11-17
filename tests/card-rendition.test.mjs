import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {outputManifest} from '../contracts/output-package.mjs';
import {prepareCardRendition} from '../scripts/prepare-card-rendition.mjs';
import {uploadCardRendition} from '../scripts/upload-card-rendition.mjs';
import p from '../contracts/rssd-v1.cjs';
import media from '../contracts/rssd-media.cjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'rssd-cards-test-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const bytes = await sharp({create: {width: 1080, height: 1440, channels: 3, background: '#f4eeee'}}).png().toBuffer();
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const manifest = outputManifest({format: 'cards', destination: null,
    source: {id: 'synthetic-article', locale: 'en', sectionId: 'methods', version: 1},
    site: {id: 'research', name: 'Research'}, style: 'model', sourceHash: p.hash('source'),
    engine: {name: 'synthetic', version: '1'}, createdAt: '2026-01-01T00:00:00Z',
    fields: {title: 'Synthetic article'},
    files: ['one.png', 'two.png'].map(path => ({path, role: 'page', type: 'image/png', bytes: bytes.length, sha256}))});
  return {directory, manifest, workspaceId: 'research', source: {workId: 'synthetic-work', revision: 1, hash: p.hash('edition')}, readPage: async () => bytes};
}

test('card packaging deduplicates pixels, creates a small cover and retains source identity', async t => {
  const options = await fixture(t);
  const [result, duplicate] = await Promise.all([prepareCardRendition(options), prepareCardRendition(options)]);
  assert.equal(result.file, duplicate.file);
  const value = JSON.parse(await readFile(result.file));
  assert.equal(value.pages.length, 2);
  assert.equal(value.pages[0].mediaId, value.pages[1].mediaId);
  assert.equal(value.source.editionHash, options.source.hash);
  const files = await readdir(join(options.directory, 'article-media'));
  assert.equal(files.length, 2);
  const dimensions = await Promise.all(files.map(async name => sharp(await readFile(join(options.directory, 'article-media', name))).metadata()));
  assert(dimensions.some(item => item.width === 360 && item.height === 480));
  assert(dimensions.some(item => item.width === 1080 && item.height === 1440));
  await assert.rejects(prepareCardRendition({...options, source: {...options.source, revision: 2}}), /revision mismatch/);
  await assert.rejects(prepareCardRendition({...options, readPage: async () => Buffer.from('changed')}), /checksum mismatch/);
});

test('layout packages store text and a cover with explicit media dependencies', async t => {
  const options = await fixture(t);
  const layout = {css: 'p {font-size:24px}', pages: [{html: '<p>First complete page</p>'}, {html: '<p>Second complete page</p>'}], assets: []};
  const result = await prepareCardRendition({...options, layout});
  const value = JSON.parse(await readFile(result.file));
  assert.equal(value.representation, 'layout');
  assert.deepEqual(value.pages, layout.pages);
  assert.equal((await readdir(join(options.directory, 'article-media'))).length, 1);
  assert(result.recipeBytes < 2000);
  await assert.rejects(prepareCardRendition({...options, layout: {...layout, pages: [layout.pages[0]]}}), /all exported pages/);
  await assert.rejects(prepareCardRendition({...options, layout: {...layout, css: 'url(data:image/png;base64,AAAA)'}}), /referenced images/);
});

test('uncertain cloud submission is recovered by immutable ID with no duplicate uploads', async t => {
  const options = await fixture(t), prepared = await prepareCardRendition(options);
  const images = new Map(), renditions = new Map();
  let uploads = 0, submissions = 0;
  const client = {request: async (path, {method = 'GET', body} = {}) => {
    if (method === 'GET') {
      if (path.endsWith('/site')) return {capabilities: ['card-renditions-v1']};
      if (path === '/works/synthetic-work') return {workspaceId: options.workspaceId};
      if (path === '/works/synthetic-work/editions/en/1') return {hash: options.source.hash};
      const value = images.get(path) || renditions.get(path);
      if (!value) throw Object.assign(Error('Missing'), {status: 404});
      return value;
    }
    if (path === '/media') {
      uploads++;
      const {manifest} = media.decodeImage(body), id = media.mediaId(body.workspaceId, manifest.sha256);
      const value = {id, workspaceId: body.workspaceId, manifest};
      images.set('/media/' + id, value);
      return value;
    }
    submissions++;
    const id = 'rendition-' + p.hash(body);
    renditions.set(path + '/' + id, {id, ...body});
    throw Error('Connection lost after commit');
  }};
  const input = {file: prepared.file, directory: options.directory, client};
  await assert.rejects(uploadCardRendition(input), /Connection lost/);
  const receipt = await uploadCardRendition(input);
  assert.equal(receipt.recovered, true);
  assert.equal(uploads, 2); assert.equal(submissions, 1);
});
