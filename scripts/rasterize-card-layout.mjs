// Turns a saved layout card set into the raster set that websites show. The layout stays in the Center unchanged;
// the raster set is a second rendition of the same edition, uploaded by scripts/upload-card-rendition.mjs.
import {createHash, randomUUID} from 'node:crypto';
import {access, mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
import p from '../contracts/rssd-v1.cjs';
import media from '../contracts/rssd-media.cjs';

const require = createRequire(import.meta.url);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
// Pages load from a reserved name, so relative media URLs resolve while nothing reaches the network.
const ORIGIN = 'https://rssd-card-layout.invalid';
const MEDIA_PATH = /^\/api\/rssd\/v1\/media\/([a-zA-Z0-9][a-zA-Z0-9._:-]{0,127})\/raw$/;
const TYPES = {png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp'};

export function playwright() {
  try { return require('playwright-core'); }
  catch { return createRequire(new URL('../desktop/runtime/package.json', import.meta.url))('playwright-core'); }
}

export async function browserPath() {
  const paths = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
    : process.platform === 'win32'
      ? [join(process.env.ProgramFiles || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
        join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe')]
      : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
  if (process.env.RSSD_CHROME) paths.unshift(process.env.RSSD_CHROME);
  for (const path of paths) try { await access(path); return path; } catch {}
  throw Error('Rendering card layouts needs Google Chrome, Microsoft Edge or Chromium (or set RSSD_CHROME)');
}

async function put(file, bytes) {
  await mkdir(dirname(file), {recursive: true});
  try {
    if ((await readFile(file)).equals(bytes)) return;
    throw Error('Conflicting content at ' + file);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = file + '.' + randomUUID();
  try { await writeFile(temporary, bytes, {flag: 'wx'}); await rename(temporary, file); }
  finally { await rm(temporary, {force: true}); }
}

export function pageDocument(layout, html) {
  // The CSS is stored as one string; keep it from closing its own <style> element.
  const css = layout.css.replace(/<\/style/gi, '<\\/style');
  return `<!doctype html><html lang="${p.locale(layout.locale)}"><head><meta charset="utf-8"><style>${css}</style></head><body>${html}</body></html>`;
}

// Runs in the page: the sheet is the body's first element; report any box whose content is cut off.
function measureSheet() {
  const sheet = document.body.firstElementChild, box = sheet?.getBoundingClientRect();
  const label = element => element.tagName.toLowerCase() + (typeof element.className === 'string' && element.className ? '.' + element.className.split(' ')[0] : '');
  const clipped = sheet ? [sheet, ...sheet.querySelectorAll('*')].filter(element =>
    (element === sheet || getComputedStyle(element).overflow !== 'visible' || element.tagName === 'MAIN') &&
    (element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1)).map(label) : [];
  return box && {width: box.width, height: box.height, x: box.x, y: box.y, clipped: [...new Set(clipped)]};
}

/**
 * Renders every page of a layout rendition and writes an upload package (`article-media/`, `rendition-assets/`,
 * `renditions/<sha256>.json`) in the shape scripts/upload-card-rendition.mjs takes. `readMedia(id)` returns the bytes
 * of a media ID the layout declares. Pages whose content does not fit are listed in `clipped`.
 */
export async function rasterizeCardLayout({layout, readMedia, directory, browser}) {
  if (layout?.schemaVersion !== 1 || layout.format !== 'cards' || layout.representation !== 'layout') throw Error('Not a layout card set');
  const workspaceId = p.id(layout.workspaceId);
  const width = p.integer(layout.width, 'width', 1, 8192), height = p.integer(layout.height, 'height', 1, 8192);
  const declared = new Set(layout.mediaIds || []);
  let current = '';
  const serve = async route => {
    const url = new URL(route.request().url());
    if (url.origin === ORIGIN && url.pathname === '/') return route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body: current});
    const id = url.origin === ORIGIN && MEDIA_PATH.exec(url.pathname)?.[1];
    if (id && declared.has(id)) {
      const bytes = await readMedia(id);
      return route.fulfill({status: 200, contentType: TYPES[media.imageManifest(bytes).path.split('.').at(-1)], body: bytes});
    }
    return route.abort();
  };
  const open = async (viewport, deviceScaleFactor) => {
    const context = await browser.newContext({viewport, deviceScaleFactor, serviceWorkers: 'block', javaScriptEnabled: false, locale: layout.locale});
    await context.route('**/*', serve);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    return {context, page};
  };
  // Measure the first sheet at its own size; the set is drawn at the scale that gives the declared pixels.
  const probe = await open({width, height}, 1);
  let sheetSize;
  try {
    current = pageDocument(layout, layout.pages[0].html);
    await probe.page.goto(ORIGIN + '/', {waitUntil: 'load'});
    sheetSize = await probe.page.evaluate(measureSheet);
  } finally { await probe.context.close(); }
  if (!sheetSize || sheetSize.x !== 0 || sheetSize.y !== 0 || !sheetSize.width) throw Error('The first page has no sheet at the top left');
  const scale = width / sheetSize.width;
  if (Math.abs(sheetSize.height * scale - height) > 0.5) throw Error(`Sheets are ${sheetSize.width}×${sheetSize.height}, not in the ${width}×${height} proportion the set declares`);
  const {context, page} = await open({width: Math.round(sheetSize.width), height: Math.round(sheetSize.height)}, scale);
  try {
    const pages = [], clipped = [], assets = new Map();
    let coverMediaId;
    for (const [index, item] of layout.pages.entries()) {
      current = pageDocument(layout, item.html);
      await page.goto(ORIGIN + '/', {waitUntil: 'load'});
      const sheet = await page.evaluate(measureSheet);
      if (!sheet || sheet.x !== 0 || sheet.y !== 0 || sheet.width !== sheetSize.width || sheet.height !== sheetSize.height) throw Error(`Page ${index + 1} is not the same size as page 1`);
      if (sheet.clipped.length) clipped.push({page: index + 1, elements: sheet.clipped});
      const bytes = await page.locator('body > :first-child').screenshot({type: 'png', animations: 'disabled', scale: 'device'});
      const info = await sharp(bytes).metadata();
      if (info.width !== width || info.height !== height) throw Error(`Page ${index + 1} rendered at ${info.width}×${info.height}`);
      const data = await sharp(bytes).webp({quality: 80, effort: 5, smartSubsample: true}).toBuffer();
      const asset = media.imageManifest(data), id = media.mediaId(workspaceId, asset.sha256);
      await put(join(directory, 'article-media', asset.path.split('/').at(-1)), data);
      assets.set(id, {id, ...asset});
      pages.push({mediaId: id});
      if (!coverMediaId) {
        const cover = await sharp(bytes).resize({width: 360, height: 480, fit: 'inside', withoutEnlargement: true}).webp({quality: 70, effort: 5}).toBuffer();
        const thumbnail = media.imageManifest(cover);
        coverMediaId = media.mediaId(workspaceId, thumbnail.sha256);
        await put(join(directory, 'article-media', thumbnail.path.split('/').at(-1)), cover);
        assets.set(coverMediaId, {id: coverMediaId, ...thumbnail});
      }
    }
    // Same edition, method and engine as the layout; only the representation differs.
    const rendition = {
      schemaVersion: 1, format: 'cards', workspaceId, workId: p.id(layout.workId), locale: p.locale(layout.locale),
      source: {articleId: p.id(layout.source.articleId), siteId: p.id(layout.source.siteId), revision: layout.source.revision,
        editionHash: layout.source.editionHash, hash: layout.source.hash},
      variant: p.id(layout.variant, 'variant'), engine: {name: layout.engine.name, version: layout.engine.version},
      width, height, coverMediaId, representation: 'raster', pages
    };
    const json = Buffer.from(JSON.stringify(rendition));
    const filename = digest(json) + '.json';
    const names = [...assets.values()].map(asset => asset.path.split('/').at(-1)).sort();
    await put(join(directory, 'rendition-assets', filename), Buffer.from(JSON.stringify(names)));
    const file = join(directory, 'renditions', filename);
    await put(file, json);
    return {file, id: 'rendition-' + p.hash(rendition), layoutId: layout.id, workId: rendition.workId, revision: rendition.source.revision, pages: pages.length, clipped};
  } finally { await context.close(); }
}

// The device connection (or RSSD_CENTER_ORIGIN and RSSD_CENTER_TOKEN). Media bytes are read with the same credential.
async function centerConnection() {
  const {createCenterClient, loadCenterConnection} = await import('./rssd-center-client.mjs');
  let origin = process.env.RSSD_CENTER_ORIGIN, token = process.env.RSSD_CENTER_TOKEN, client;
  if (origin && token) client = createCenterClient({origin, token});
  else {
    const {centerHome} = await import('../desktop/scripts/runtime/center-home.mjs');
    client = (await loadCenterConnection(centerHome())).client;
    ({origin, token} = {origin: client.origin, token: token || JSON.parse(await readFile(join(centerHome(), 'connection.json'), 'utf8')).token});
  }
  const raw = async (id, workspaceId) => {
    const response = await fetch(client.origin + '/api/rssd/v1/media/' + encodeURIComponent(p.id(id)) + '/raw',
      {headers: {Authorization: 'Bearer ' + token}, redirect: 'error', signal: AbortSignal.timeout(30000)});
    if (!response.ok) throw Object.assign(Error('Media ' + id + ' could not be read (' + response.status + ')'), {status: response.status});
    const bytes = Buffer.from(await response.arrayBuffer());
    if (media.mediaId(workspaceId, media.imageManifest(bytes).sha256) !== id) throw Error('Media ' + id + ' does not match its identity');
    return bytes;
  };
  return {client, raw};
}

async function retrying(task) {
  for (let attempt = 1; ; attempt++) {
    try { return await task(); }
    catch (error) { if ((error.status !== 0 && error.name !== 'TimeoutError') || attempt === 3) throw error; }
  }
}

/**
 * Current layout sets of a workspace and language that have no raster set of the same method (`variant`) for the
 * same edition revision. Raster sets made another way, such as image-model cards, do not count.
 */
export async function pendingLayouts(client, workspaceId, locale) {
  const all = [];
  let after;
  do {
    const query = new URLSearchParams({locale, limit: '100', ...(after ? {after} : {})});
    const page = await retrying(() => client.request('/editorial/' + encodeURIComponent(workspaceId) + '/renditions?' + query));
    all.push(...page.items);
    after = page.next;
  } while (after);
  const key = item => [item.workId, item.locale, item.source.revision, item.variant].join('\n');
  const rastered = new Set(all.filter(item => item.representation === 'raster').map(key));
  return all.filter(item => item.representation === 'layout' && item.current && !rastered.has(key(item)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), flag = name => args.includes(name), option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const workspaceId = option('--workspace'), directory = resolve(option('--out') || '.local/card-rasters');
  if (!flag('--workspace')) throw Error('Usage: node scripts/rasterize-card-layout.mjs --workspace <id> [--locale zh-CN] [--id <layout rendition id>]... [--out .local/card-rasters] [--upload]');
  const {client, raw} = await centerConnection();
  const ids = args.flatMap((value, index) => args[index - 1] === '--id' ? [value] : []);
  const listed = await pendingLayouts(client, workspaceId, option('--locale') || 'zh-CN');
  const chosen = ids.length ? listed.filter(item => ids.includes(item.id)) : listed;
  if (ids.length && chosen.length !== ids.length) throw Error('Not a current layout set without a raster set: ' + ids.filter(id => !chosen.some(item => item.id === id)).join(', '));
  const base = '/editorial/' + encodeURIComponent(workspaceId);
  const {chromium} = playwright();
  const browser = await chromium.launch({executablePath: await browserPath(), headless: true, timeout: 20000});
  const results = [];
  try {
    for (const item of chosen) {
      const layout = await retrying(() => client.request(base + '/renditions/' + item.id));
      const cache = new Map();
      const readMedia = id => {
        if (!cache.has(id)) cache.set(id, retrying(() => raw(id, workspaceId)));
        return cache.get(id);
      };
      const result = await rasterizeCardLayout({layout, readMedia, directory, browser});
      results.push({...result, sectionId: item.sectionId, title: item.title});
      console.error(`${result.clipped.length ? 'CLIPPED' : 'ok     '} ${item.sectionId} ${item.workId} r${result.revision} ${result.pages}p ${item.title}`);
    }
  } finally { await browser.close(); }
  if (flag('--upload')) {
    const {uploadCardRendition} = await import('./upload-card-rendition.mjs');
    for (const result of results) {
      if (result.clipped.length) { console.error('skipped (clipped): ' + result.layoutId); continue; }
      result.receipt = await retrying(() => uploadCardRendition({file: result.file, directory, client}));
    }
  }
  console.log(JSON.stringify(results, null, 1));
}
