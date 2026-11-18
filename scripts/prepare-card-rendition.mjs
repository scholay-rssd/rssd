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
export async function prepareCardRendition({manifest, readPage, directory, workspaceId}) {
  const problems = manifestProblems(manifest);
  if (manifest.format !== 'cards' || problems.length) throw Error('Invalid cards export: ' + problems.join(', '));
  media.mediaId(workspaceId, '0'.repeat(64));
  const pages = [];
  let cover;
  let inputBytes = 0;
  for (const page of manifest.files.filter(file => file.role === 'page')) {
    const bytes = await readPage(page.path);
    if (bytes.length !== page.bytes || digest(bytes) !== page.sha256) throw Error('Page checksum mismatch: ' + page.path);
    const {data, info} = await sharp(bytes).webp({quality: 80, effort: 5, smartSubsample: true}).toBuffer({resolveWithObject: true});
    const asset = media.imageManifest(data);
    const mediaId = media.mediaId(workspaceId, asset.sha256);
    await put(join(directory, 'article-media', asset.path.split('/').at(-1)), data);
    if (!cover) {
      const thumbnail = await sharp(data).resize({width: 320, withoutEnlargement: true}).webp({quality: 75, effort: 5}).toBuffer();
      const thumbnailAsset = media.imageManifest(thumbnail);
      await put(join(directory, 'article-media', thumbnailAsset.path.split('/').at(-1)), thumbnail);
      cover = {mediaId: media.mediaId(workspaceId, thumbnailAsset.sha256), ...thumbnailAsset};
    }
    pages.push({mediaId, sha256: asset.sha256, bytes: asset.bytes, width: info.width, height: info.height});
    inputBytes += bytes.length;
  }
  const rendition = {
    schemaVersion: 1, format: 'cards', workspaceId, articleId: manifest.articleId,
    locale: manifest.locale, sectionId: manifest.sectionId, source: manifest.source,
    style: manifest.style, title: manifest.fields.title, engine: manifest.engine, mime: 'image/webp', cover, pages
  };
  const json = Buffer.from(JSON.stringify(rendition));
  const file = join(directory, 'renditions', digest(json) + '.json');
  await put(file, json);
  return {file, inputBytes, outputBytes: pages.reduce((sum, page) => sum + page.bytes, 0), pages: pages.length};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [manifestFile, workspaceId, directory] = process.argv.slice(2);
  if (!directory) throw Error('Usage: node scripts/prepare-card-rendition.mjs manifest.json workspaceId output-directory');
  const {realpath} = await import('node:fs/promises');
  const base = await realpath(dirname(manifestFile));
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const readPage = async name => {
    const full = await realpath(resolve(base, name));
    const rel = relative(base, full);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw Error('Page outside export: ' + name);
    return readFile(full);
  };
  console.log(JSON.stringify(await prepareCardRendition({manifest, workspaceId, directory, readPage})));
}
