import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {dirname, join, relative, resolve, isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
import {manifestProblems} from '../contracts/output-package.mjs';
import protocol from '../contracts/rssd-v1.cjs';
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
  if (manifest?.format !== 'cards' || problems.length) throw Error('Invalid cards export: ' + problems.join(', '));
  // Resolve this identity through the Center edition endpoint, never from a local filename.
  if (!source || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(source.workId || '') ||
      !Number.isSafeInteger(source.revision) || source.revision < 1 || !/^[a-f0-9]{64}$/.test(source.hash || '')) {
    throw Error('A verified Center source {workId, revision, hash} is required');
  }
  if (manifest.source.version !== source.revision) throw Error('Source revision mismatch');
  if (source.workspaceId !== workspaceId || source.siteId !== manifest.site.id ||
      source.articleId !== manifest.articleId || source.locale !== manifest.locale) throw Error('Source article, language, site or workspace mismatch');
  protocol.id(source.articleId, 'source article');
  protocol.id(source.siteId, 'source site');
  protocol.id(workspaceId, 'workspace');
  const variant = protocol.id(manifest.style || 'algorithm', 'variant');
  const engine = {name: protocol.text(manifest.engine.name, 'engine name', 100), version: protocol.text(manifest.engine.version, 'engine version', 100)};
  const pages = [];
  const assets = new Map();
  let inputBytes = 0;
  let width, height, coverMediaId;
  const pageFiles = manifest.files.filter(file => file.role === 'page');
  if (pageFiles.length > 500) throw Error('Rendition exceeds 500 pages');
  if (layout && (!Array.isArray(layout.pages) || layout.pages.length !== pageFiles.length ||
      layout.pages.some(page => typeof page?.html !== 'string' || !page.html.trim()) ||
      typeof layout.css !== 'string' || /data\s*:/i.test(layout.css + layout.pages.map(page => page.html).join('')))) {
    throw Error('Layout must contain all exported pages, shared CSS and referenced images');
  }
  if (layout) {
    protocol.text(layout.css, 'CSS', 100000, true);
    for (const page of layout.pages) protocol.text(page.html, 'page HTML', 200000);
    const paths = protocol.array(layout.assets ?? [], 'layout assets', 500);
    if (paths.some(path => typeof path !== 'string' || !/^article-media\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(path))) throw Error('Invalid layout asset path');
  }
  const encodedPages = new Map();
  for (const page of pageFiles) {
    const bytes = await readPage(page.path);
    if (bytes.length !== page.bytes || digest(bytes) !== page.sha256) throw Error('Page checksum mismatch: ' + page.path);
    inputBytes += bytes.length;
    if (encodedPages.has(page.sha256)) {
      if (!layout) pages.push({mediaId: encodedPages.get(page.sha256)});
      continue;
    }
    const image = sharp(bytes, {limitInputPixels: 8192 * 8192});
    const info = await image.metadata();
    if (width && (width !== info.width || height !== info.height)) throw Error('Card pages must have identical dimensions');
    width = info.width; height = info.height;
    if (width > 8192 || height > 8192) throw Error('Card dimensions exceed 8192 pixels');
    let pageId;
    if (!layout) {
      const data = await image.clone().webp({quality: 80, effort: 5, smartSubsample: true}).toBuffer();
      const asset = media.imageManifest(data);
      pageId = media.mediaId(workspaceId, asset.sha256);
      await put(join(directory, 'article-media', asset.path.split('/').at(-1)), data);
      assets.set(pageId, {id: pageId, ...asset});
      pages.push({mediaId: pageId});
    }
    encodedPages.set(page.sha256, pageId);
    if (!coverMediaId) {
      const cover = await image.resize({width: 360, height: 480, fit: 'inside', withoutEnlargement: true}).webp({quality: 70, effort: 5}).toBuffer();
      const thumbnail = media.imageManifest(cover);
      coverMediaId = media.mediaId(workspaceId, thumbnail.sha256);
      await put(join(directory, 'article-media', thumbnail.path.split('/').at(-1)), cover);
      assets.set(coverMediaId, {id: coverMediaId, ...thumbnail});
    }
  }
  const layoutReferences = new Map();
  for (const path of new Set(layout?.assets || [])) {
    const bytes = await readPage(path);
    const asset = media.imageManifest(bytes), id = media.mediaId(workspaceId, asset.sha256);
    // Layout authors use content-addressed /article-media paths. Replace only these exact paths.
    if (path !== asset.path.slice(1)) throw Error('Layout asset must use its content-addressed path');
    await put(join(directory, path), bytes);
    assets.set(id, {id, ...asset});
    layoutReferences.set(asset.path, id);
  }
  const replaceReferences = text => text.replace(/\/article-media\/[a-f0-9]{64}\.(?:png|jpg|webp)/g, path => {
    const id = layoutReferences.get(path);
    if (!id) throw Error('Layout has unpacked images');
    return '/api/rssd/v1/media/' + id + '/raw';
  });
  const rendition = {
    schemaVersion: 1, format: 'cards', workspaceId, workId: source.workId,
    locale: manifest.locale, source: {articleId: source.articleId, siteId: source.siteId, revision: source.revision, editionHash: source.hash, hash: manifest.source.hash},
    variant, engine, width, height, coverMediaId,
    representation: layout ? 'layout' : 'raster',
    pages: layout ? layout.pages.map(page => ({html: replaceReferences(page.html)})) : pages,
    ...(layout ? {css: replaceReferences(layout.css), mediaIds: [...layoutReferences.values()].sort()} : {})
  };
  if (Buffer.byteLength(JSON.stringify(rendition)) > 2 * 1024 * 1024) throw Error('Rendition exceeds 2 MiB');
  if (layout) {
    const content = [rendition.css, ...rendition.pages.map(page => page.html)].join('\n');
    if (content.includes('/article-media/')) throw Error('Layout has unpacked images');
    const declared = new Set(rendition.mediaIds);
    if (protocol.referencedMediaIds(content).some(id => !declared.has(id))) throw Error('Layout references unregistered media');
    protocol.text(rendition.css, 'CSS', 100000, true);
    for (const page of rendition.pages) protocol.text(page.html, 'page HTML', 200000);
  }
  const json = Buffer.from(JSON.stringify(rendition));
  const filename = digest(json) + '.json';
  const file = join(directory, 'renditions', filename);
  const names = [...assets.values()].map(asset => asset.path.split('/').at(-1)).sort();
  await put(join(directory, 'rendition-assets', filename), Buffer.from(JSON.stringify(names)));
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
