import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {dirname, join, relative, resolve, isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
import {manifestProblems} from '../contracts/output-package.mjs';
import media from '../contracts/rssd-media.cjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function put(file, bytes) {
  await mkdir(dirname(file), {recursive: true});
  try {
    if ((await readFile(file)).equals(bytes)) return;
    throw Error('Conflicting content at ' + file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temporary = file + '.' + randomUUID();
  try {
    await writeFile(temporary, bytes, {flag: 'wx'});
    await rename(temporary, file);
  } finally {
    await rm(temporary, {force: true});
  }
}

/** Prepare an immutable rendition from a verified RSSD cards export. Publish the returned manifest last. */
export async function prepareCardRendition({manifest, readPage, directory, workspaceId, source, layout}) {
  const problems = manifestProblems(manifest);
  if (manifest.format !== 'cards' || problems.length) throw Error('Invalid cards export: ' + problems.join(', '));
  // Resolve this identity through the Center edition endpoint, never from a local filename.
  if (!source || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(source.workId || '') ||
      !Number.isSafeInteger(source.revision) || source.revision < 1 || !/^[a-f0-9]{64}$/.test(source.hash || '')) {
    throw Error('A verified Center source {workId, revision, hash} is required');
  }
  if (manifest.source.version != null && manifest.source.version !== source.revision) throw Error('Source revision mismatch');
  // mediaId validates the workspace even when a layout has no pictures.
  media.mediaId(workspaceId, source.hash);
  const pages = [];
  const assets = new Map();
  let inputBytes = 0;
  let width, height, coverMediaId;
  const pageFiles = manifest.files.filter(file => file.role === 'page');
  const selectedFiles = layout ? pageFiles.slice(0, 1) : pageFiles;
  for (const page of selectedFiles) {
    const bytes = await readPage(page.path);
    if (bytes.length !== page.bytes || digest(bytes) !== page.sha256) throw Error('Page checksum mismatch: ' + page.path);
    const {data, info} = await sharp(bytes, {limitInputPixels: 8192 * 8192}).webp({quality: 80, effort: 5, smartSubsample: true}).toBuffer({resolveWithObject: true});
    if (width && (width !== info.width || height !== info.height)) throw Error('Card pages must have identical dimensions');
    width = info.width; height = info.height;
    if (width > 8192 || height > 8192) throw Error('Card dimensions exceed 8192 pixels');
    const asset = media.imageManifest(data);
    const mediaId = media.mediaId(workspaceId, asset.sha256);
    if (!layout) {
      await put(join(directory, 'article-media', asset.path.split('/').at(-1)), data);
      assets.set(mediaId, {id: mediaId, ...asset});
      pages.push({mediaId});
    }
    if (!coverMediaId) {
      const cover = await sharp(bytes).resize({width: 360, height: 480, fit: 'inside', withoutEnlargement: true}).webp({quality: 70, effort: 5}).toBuffer();
      const thumbnail = media.imageManifest(cover);
      coverMediaId = media.mediaId(workspaceId, thumbnail.sha256);
      await put(join(directory, 'article-media', thumbnail.path.split('/').at(-1)), cover);
      assets.set(coverMediaId, {id: coverMediaId, ...thumbnail});
    }
    inputBytes += bytes.length;
  }
  if (layout && (!Array.isArray(layout.pages) || layout.pages.length !== pageFiles.length ||
      layout.pages.some(page => typeof page.html !== 'string' || !page.html.trim()) ||
      typeof layout.css !== 'string' || /data\s*:/i.test(layout.css + layout.pages.map(page => page.html).join('')))) {
    throw Error('Layout must contain all exported pages, shared CSS and referenced images');
  }
  const layoutMediaIds = [];
  for (const path of layout?.assets || []) {
    const bytes = await readPage(path);
    const asset = media.imageManifest(bytes), id = media.mediaId(workspaceId, asset.sha256);
    // Layout authors use content-addressed /article-media paths. Replace only these exact paths.
    if (path !== asset.path.slice(1)) throw Error('Layout asset must use its content-addressed path');
    await put(join(directory, path), bytes);
    assets.set(id, {id, ...asset}); layoutMediaIds.push(id);
  }
  const replaceReferences = text => {
    for (const id of layoutMediaIds) text = text.split(assets.get(id).path).join('/api/rssd/v1/media/' + id + '/raw');
    return text;
  };
  const rendition = {
    schemaVersion: 1, format: 'cards', workspaceId, workId: source.workId,
    locale: manifest.locale, source: {revision: source.revision, editionHash: source.hash, hash: manifest.source.hash},
    variant: manifest.style || 'algorithm', engine: manifest.engine, width, height, coverMediaId,
    representation: layout ? 'layout' : 'raster',
    pages: layout ? layout.pages.map(page => ({html: replaceReferences(page.html)})) : pages,
    ...(layout ? {css: replaceReferences(layout.css), mediaIds: [...new Set(layoutMediaIds)].sort()} : {})
  };
  if (Buffer.byteLength(JSON.stringify(rendition)) > 2 * 1024 * 1024) throw Error('Rendition exceeds 2 MiB');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(rendition.variant)) throw Error('Invalid variant');
  if (rendition.pages.length > 500) throw Error('Rendition exceeds 500 pages');
  if (layout && (layout.css.length > 100000 || layout.pages.some(page => page.html.length > 200000))) throw Error('Layout exceeds per-page or style limits');
  if (layout && /\/article-media\//.test(rendition.css + rendition.pages.map(page => page.html).join(''))) throw Error('Layout has unpacked images');
  const json = Buffer.from(JSON.stringify(rendition));
  const file = join(directory, 'renditions', digest(json) + '.json');
  await put(file, json);
  return {file, inputBytes, outputBytes: [...assets.values()].reduce((sum, asset) => sum + asset.bytes, 0),
    recipeBytes: json.length, pages: rendition.pages.length};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [manifestFile, workspaceId, directory, sourceFile, layoutFile] = process.argv.slice(2);
  if (!sourceFile) throw Error('Usage: node scripts/prepare-card-rendition.mjs manifest.json workspaceId output-directory source.json [layout.json]');
  const {realpath} = await import('node:fs/promises');
  const base = await realpath(dirname(manifestFile));
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const readPage = async name => {
    const full = await realpath(resolve(base, name));
    const rel = relative(base, full);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw Error('Page outside export: ' + name);
    return readFile(full);
  };
  const source = JSON.parse(await readFile(sourceFile, 'utf8'));
  const layout = layoutFile ? JSON.parse(await readFile(layoutFile, 'utf8')) : undefined;
  console.log(JSON.stringify(await prepareCardRendition({manifest, workspaceId, directory, readPage, source, layout})));
}
