import {readFile, readdir, realpath} from 'node:fs/promises';
import {dirname, join, resolve, relative, isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import p from '../contracts/rssd-v1.cjs';
import media from '../contracts/rssd-media.cjs';
import {createCenterClient} from './rssd-center-client.mjs';

/** Upload content-addressed assets first, then commit the immutable rendition. Safe to retry. */
export async function uploadCardRendition({file, directory, client}) {
  const value = JSON.parse(await readFile(file, 'utf8'));
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
  const workPath = '/works/' + encodeURIComponent(p.id(value.workId));
  const work = await client.request(workPath);
  if (work.workspaceId !== workspaceId) throw Error('Source belongs to a different workspace');
  const edition = await client.request(workPath + '/editions/' + p.locale(value.locale) + '/' + p.integer(value.source?.revision, 'revision', 1));
  if (edition.hash !== value.source.editionHash) throw Error('Source edition hash mismatch');
  const ids = new Set([value.coverMediaId, ...(value.mediaIds || []), ...value.pages.map(page => page.mediaId)].filter(Boolean));
  const base = await realpath(join(directory, 'article-media'));
  const files = await readdir(base);
  const names = new Map(files.filter(name => /^[a-f0-9]{64}\.(png|jpg|webp)$/.test(name))
    .map(name => [media.mediaId(workspaceId, name.split('.')[0]), name]));
  for (const mediaId of ids) {
    p.id(mediaId);
    let remote;
    try { remote = await client.request('/media/' + mediaId); }
    catch (error) {
      if (error.status !== 404) throw error;
      const name = names.get(mediaId);
      if (!name) throw Error('Missing packaged image ' + mediaId);
      const path = await realpath(join(base, name)), rel = relative(base, path);
      if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw Error('Image outside package');
      const bytes = await readFile(path), manifest = media.imageManifest(bytes);
      if (media.mediaId(workspaceId, manifest.sha256) !== mediaId || manifest.path !== '/article-media/' + name) throw Error('Packaged image checksum mismatch');
      remote = await client.request('/media', {method: 'POST', body: {workspaceId, ...manifest, data: bytes.toString('base64')}});
      if (p.hash(remote.manifest) !== p.hash(manifest)) throw Error('Uploaded image checksum mismatch');
    }
    if (remote.id !== mediaId || remote.workspaceId !== workspaceId || media.mediaId(workspaceId, remote.manifest.sha256) !== mediaId) throw Error('Uploaded image identity mismatch');
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
