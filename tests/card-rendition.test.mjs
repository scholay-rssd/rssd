import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {basename, join} from 'node:path';
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
  return {directory, manifest, workspaceId: 'research', source: {workspaceId: 'research', siteId: 'research', articleId: 'synthetic-article', locale: 'en', workId: 'synthetic-work', revision: 1, hash: p.hash('edition')}, readPage: async () => bytes};
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
  assert.deepEqual(JSON.parse(await readFile(join(options.directory, 'rendition-assets', basename(result.file)))), files.sort());
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
      if (path === '/editorial/research/renditions/source?workId=synthetic-work&locale=en&revision=1') return options.source;
      const value = images.get(path) || renditions.get(path);
      if (!value) throw Object.assign(Error('Missing'), {status: 404});
      return value;
    }
    // This Center predates the combined status request, so each image is asked for.
    if (path === '/media/missing') throw Object.assign(Error('Cannot POST'), {status: 404});
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
  const indexFile = join(options.directory, 'rendition-assets', basename(prepared.file));
  const correctIndex = await readFile(indexFile);
  await writeFile(indexFile, '[]');
  await assert.rejects(uploadCardRendition(input), /Invalid packaged asset index/);
  assert.equal(uploads, 0);
  await writeFile(indexFile, correctIndex);
  await assert.rejects(uploadCardRendition(input), /Connection lost/);
  await rm(indexFile);
  await rm(join(options.directory, 'article-media'), {recursive: true});
  renditions.clear(); // Media already exists, but the rendition still needs committing.
  await assert.rejects(uploadCardRendition(input), /Connection lost/);
  const receipt = await uploadCardRendition(input);
  assert.equal(receipt.recovered, true);
  assert.equal(uploads, 2); assert.equal(submissions, 2);
});

test('preparation rejects ambiguous source identities before reading pixels', async t => {
  const options = await fixture(t);
  const readPage = () => assert.fail('Unexpected pixel read');
  for (const change of [{articleId: 'other'}, {workspaceId: 'other'}, {siteId: 'other'}, {locale: 'zh-CN'}]) {
    await assert.rejects(prepareCardRendition({...options, readPage, source: {...options.source, ...change}}), /mismatch/);
  }
  options.manifest.source.version = null;
  await assert.rejects(prepareCardRendition({...options, readPage}), /revision mismatch/);
});

test('layout verifies every raster checksum and validates asset paths before reading', async t => {
  const options = await fixture(t);
  const layout = {pages: [{html: 'one'}, {html: 'two'}], css: '', assets: []};
  const readPage = name => name === 'two.png' ? Buffer.from('changed') : options.readPage(name);
  await assert.rejects(prepareCardRendition({...options, layout, readPage}), /checksum mismatch: two.png/);
  await assert.rejects(prepareCardRendition({...options, layout: {...layout, assets: ['unknown.png']},
    readPage: () => assert.fail('Unexpected read')}), /Invalid layout asset path/);
});

test('upload detects changed manifest bytes before any Center request', async t => {
  const options = await fixture(t), {file} = await prepareCardRendition(options);
  await writeFile(file, Buffer.concat([await readFile(file), Buffer.from(' ')]));
  const client = {request: () => assert.fail('Unexpected Center request')};
  await assert.rejects(uploadCardRendition({file, directory: options.directory, client}), /checksum/);
});

test('layout resolves its declared media in both HTML and CSS', async t => {
  const options = await fixture(t), bytes = await options.readPage('one.png');
  const asset = media.imageManifest(bytes), id = media.mediaId(options.workspaceId, asset.sha256);
  const layout = {css: `p{background:url(${asset.path})}`, pages: [{html: `<img src="${asset.path}">`}, {html: 'Text'}], assets: [asset.path.slice(1)]};
  const {file} = await prepareCardRendition({...options, layout});
  const value = JSON.parse(await readFile(file));
  assert.deepEqual(value.mediaIds, [id]);
  assert.equal(value.pages[0].html, `<img src="/api/rssd/v1/media/${id}/raw">`);
  assert.equal(value.css, `p{background:url(/api/rssd/v1/media/${id}/raw)}`);
  await assert.rejects(prepareCardRendition({...options, layout: {...layout, pages: [{html: '<img src="/api/rssd/v1/media/unknown/raw">'}, {html: 'Text'}]}}), /unregistered media/);
});

test('a large set asks for media status once and uploads only missing images a few at a time', async t => {
  const options = await fixture(t), pages = new Map();
  for (let index = 0; index < 12; index++) {
    const bytes = await sharp({create: {width: 108, height: 144, channels: 3, background: {r: index * 20, g: 90, b: 120}}}).png().toBuffer();
    pages.set('page-' + index + '.png', bytes);
  }
  const manifest = outputManifest({format: 'cards', destination: null,
    source: {id: 'synthetic-article', locale: 'en', sectionId: 'methods', version: 1},
    site: {id: 'research', name: 'Research'}, style: 'model', sourceHash: p.hash('source'),
    engine: {name: 'synthetic', version: '1'}, createdAt: '2026-01-01T00:00:00Z', fields: {title: 'Synthetic article'},
    files: [...pages].map(([path, bytes]) => ({path, role: 'page', type: 'image/png', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')}))});
  const prepared = await prepareCardRendition({...options, manifest, readPage: async path => pages.get(path)});
  const value = JSON.parse(await readFile(prepared.file));
  const held = new Set([value.pages[0].mediaId, value.pages[1].mediaId]), uploaded = [];
  let statusRequests = 0, lookups = 0, active = 0, peak = 0, reply;
  const client = {request: async (path, {method = 'GET', body} = {}) => {
    if (path.endsWith('/site')) return {capabilities: ['card-renditions-v1']};
    if (path.includes('/renditions/source?')) return options.source;
    if (method === 'GET' && path.includes('/renditions/')) throw Object.assign(Error('Missing'), {status: 404});
    if (method === 'GET') { lookups++; throw Object.assign(Error('Missing'), {status: 404}); }
    if (path === '/media/missing') {
      statusRequests++;
      return reply || {workspaceId: body.workspaceId, missing: body.ids.filter(id => !held.has(id))};
    }
    if (path === '/media') {
      peak = Math.max(peak, ++active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      const {manifest} = media.decodeImage(body), id = media.mediaId(body.workspaceId, manifest.sha256);
      if (id === reply?.fail) throw Error('Upload refused');
      uploaded.push(id); held.add(id);
      return {id, workspaceId: body.workspaceId, manifest};
    }
    return {id: 'rendition-' + p.hash(body), workspaceId: body.workspaceId};
  }};
  const input = {file: prepared.file, directory: options.directory, client};
  const receipt = await uploadCardRendition(input);
  assert.equal(receipt.id, 'rendition-' + p.hash(value));
  assert.equal(statusRequests, 1); assert.equal(lookups, 0);
  assert.equal(uploaded.length, 11); // Ten remaining pages and the cover.
  assert.equal(new Set(uploaded).size, 11);
  assert(peak > 1 && peak <= 4, 'uploads ran ' + peak + ' at a time');
  await uploadCardRendition(input);
  assert.equal(uploaded.length, 11);
  reply = {workspaceId: 'research', missing: ['media-from-another-set']};
  await assert.rejects(uploadCardRendition(input), /Media status mismatch/);
  reply = {workspaceId: 'other', missing: []};
  await assert.rejects(uploadCardRendition(input), /Media status mismatch/);
  const before = uploaded.length;
  reply = {workspaceId: 'research', missing: value.pages.map(page => page.mediaId), fail: value.pages[0].mediaId};
  await assert.rejects(uploadCardRendition(input), /Upload refused/);
  assert(uploaded.length - before < 11, 'a failed upload stops the remaining ones');
});

test('a note gets no card set: a Center that keeps work types is asked before any image is uploaded', async t => {
  const options = await fixture(t), prepared = await prepareCardRendition(options);
  let type = 'note', uploads = 0, submissions = 0, reads = [];
  const client = {request: async (path, {method = 'GET', body} = {}) => {
    if (method === 'GET') {
      if (path.endsWith('/site')) return {capabilities: ['card-renditions-v1', 'work-types-v1']};
      if (path.includes('/renditions/source?')) return options.source;
      if (path.includes('/cloud/')) { reads.push(path); return {articleId: 'synthetic-article', locale: 'en', data: {id: 'synthetic-article', locale: 'en', ...(type ? {workType: type} : {})}}; }
      throw Object.assign(Error('Missing'), {status: 404});
    }
    if (path === '/media/missing') return {workspaceId: body.workspaceId, missing: []};
    if (path === '/media') { uploads++; throw Error('unexpected upload'); }
    submissions++;
    return {id: 'rendition-' + p.hash(body), workspaceId: body.workspaceId};
  }};
  const input = {file: prepared.file, directory: options.directory, client};
  await assert.rejects(uploadCardRendition(input), /A note has no card set/);
  assert.equal(uploads + submissions, 0);
  // The English edition is read in its own language.
  assert.equal(reads[0], '/editorial/research/cloud/synthetic-article?locale=en&media=referenced');
  for (type of ['article', undefined]) assert.equal((await uploadCardRendition(input)).workspaceId, 'research');
  assert.equal(submissions, 2);
});
