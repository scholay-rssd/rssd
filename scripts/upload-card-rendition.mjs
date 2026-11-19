import {createHash} from 'node:crypto';
import {readFile, realpath, stat} from 'node:fs/promises';
import {basename, dirname, join, resolve, relative, isAbsolute, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import p from '../contracts/rssd-v1.cjs';
import media from '../contracts/rssd-media.cjs';
import {createCenterClient} from './rssd-center-client.mjs';

async function inside(root, ...parts) {
  const path = await realpath(join(root, ...parts));
  const rel = relative(root, path);
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw Error('Path outside package');
  return path;
}

async function assetNames(directory, filename, workspaceId, ids) {
  const root = await realpath(directory);
  const path = await inside(root, 'rendition-assets', filename);
  // At most 500 layout assets plus one cover, or 500 raster pages plus one cover.
  if ((await stat(path)).size > 48 * 1024) throw Error('Invalid packaged asset index');
  const names = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(names) || names.length !== ids.size) throw Error('Invalid packaged asset index');
  const files = new Map();
  for (const name of names) {
    if (typeof name !== 'string' || !/^[a-f0-9]{64}\.(png|jpg|webp)$/.test(name)) throw Error('Invalid packaged image name');
    const id = media.mediaId(workspaceId, name.split('.')[0]);
    if (!ids.has(id) || files.has(id)) throw Error('Packaged asset index mismatch');
    files.set(id, name);
  }
  return {base: await inside(root, 'article-media'), files};
}

// A few requests at a time keeps a large set quick without crowding the Center. The first failure stops new work.
async function concurrently(items, task, limit = 4) {
  const results = new Array(items.length);
  let next = 0, failed = false;
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, async () => {
    while (!failed && next < items.length) {
      const position = next++;
      try { results[position] = await task(items[position]); }
      catch (error) { failed = true; throw error; }
    }
  }));
  return results;
}

/** Upload content-addressed assets first, then commit the immutable rendition. Safe to retry. */
export async function uploadCardRendition({file, directory, client}) {
  if ((await stat(file)).size > 2 * 1024 * 1024) throw Error('Rendition exceeds 2 MiB');
  const bytes = await readFile(file);
  if (bytes.length > 2 * 1024 * 1024 || basename(file) !== createHash('sha256').update(bytes).digest('hex') + '.json') throw Error('Invalid rendition manifest size or checksum');
  const value = JSON.parse(bytes.toString('utf8'));
  if (value.schemaVersion !== 1 || value.format !== 'cards' || !Array.isArray(value.pages)) throw Error('Invalid rendition package');
  const workspaceId = p.id(value.workspaceId);
  const endpoint = '/editorial/' + encodeURIComponent(workspaceId) + '/renditions';
  const site = await client.request('/editorial/' + encodeURIComponent(workspaceId) + '/site');
  if (!site.capabilities?.includes('card-renditions-v1')) throw Error('Center does not support card renditions yet');
  const id = 'rendition-' + p.hash(value);
  try {
    const existing = await client.request(endpoint + '/' + id);
    if (existing.id !== id || existing.workspaceId !== workspaceId) throw Error('Rendition receipt mismatch');
    return {id, workspaceId, recovered: true};
  } catch (error) { if (error.status !== 404) throw error; }
  if (!value.source?.articleId || !value.source.siteId) throw Error('Prepare this export again with its Center source identity');
  const query = new URLSearchParams({workId: p.id(value.workId), locale: p.locale(value.locale), revision: String(p.integer(value.source.revision, 'revision', 1))});
  const edition = await client.request(endpoint + '/source?' + query);
  if (edition.workspaceId !== workspaceId || edition.articleId !== value.source.articleId || edition.siteId !== value.source.siteId ||
      edition.workId !== value.workId || edition.locale !== value.locale || edition.revision !== value.source.revision ||
      edition.hash !== value.source.editionHash) throw Error('Source edition identity or hash mismatch');
  // One card set per language edition, made from that edition's own revision; a note gets none, because its
  // pictures are its content. Only a Center that keeps work types can say what the work is.
  if (site.capabilities.includes('work-types-v1')) {
    const work = await client.request('/editorial/' + encodeURIComponent(workspaceId) + '/cloud/' + encodeURIComponent(value.source.articleId) + '?' + new URLSearchParams({locale: value.locale, media: 'referenced'}));
    if (work?.data?.workType === 'note') throw Error('A note has no card set: its pictures are its content');
  }
  const ids = new Set([value.coverMediaId, ...(value.mediaIds || []), ...value.pages.map(page => page.mediaId)].filter(Boolean));
  for (const mediaId of ids) p.id(mediaId);
  const identified = (remote, mediaId) => {
    if (remote?.id !== mediaId || remote.workspaceId !== workspaceId || media.mediaId(workspaceId, remote.manifest?.sha256) !== mediaId) throw Error('Uploaded image identity mismatch');
  };
  // One status request covers the whole set. A Center without it answers 404 and each image is asked for instead.
  let missing;
  try {
    const status = await client.request('/media/missing', {method: 'POST', body: {workspaceId, ids: [...ids]}});
    if (status?.workspaceId !== workspaceId || !Array.isArray(status.missing) || status.missing.some(id => !ids.has(id))) throw Error('Media status mismatch');
    missing = [...new Set(status.missing)];
  } catch (error) {
    if (error.status !== 404 && error.status !== 405) throw error;
    missing = (await concurrently([...ids], async mediaId => {
      try { identified(await client.request('/media/' + mediaId), mediaId); }
      catch (error) { if (error.status !== 404) throw error; return mediaId; }
    })).filter(Boolean);
  }
  if (missing.length) {
    const index = await assetNames(directory, basename(file), workspaceId, ids);
    await concurrently(missing, async mediaId => {
      const name = index.files.get(mediaId);
      const path = await inside(index.base, name);
      const bytes = await readFile(path), manifest = media.imageManifest(bytes);
      if (media.mediaId(workspaceId, manifest.sha256) !== mediaId || manifest.path !== '/article-media/' + name) throw Error('Packaged image checksum mismatch');
      const remote = await client.request('/media', {method: 'POST', body: {workspaceId, ...manifest, data: bytes.toString('base64')}});
      if (p.hash(remote.manifest) !== p.hash(manifest)) throw Error('Uploaded image checksum mismatch');
      identified(remote, mediaId);
    });
  }
  const receipt = await client.request(endpoint, {method: 'POST', body: value});
  if (receipt.id !== id || receipt.workspaceId !== workspaceId) throw Error('Rendition receipt mismatch');
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [file, directory = file && dirname(dirname(resolve(file)))] = process.argv.slice(2);
  if (!file) throw Error('Usage: node scripts/upload-card-rendition.mjs rendition.json [package-directory]');
  const client = createCenterClient({origin: process.env.RSSD_CENTER_ORIGIN, token: process.env.RSSD_CENTER_TOKEN});
  console.log(JSON.stringify(await uploadCardRendition({file, directory, client})));
}
