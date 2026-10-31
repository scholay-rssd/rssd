// Source configuration only. Never select article rows, credentials or settings.
import {readFileSync, writeFileSync, renameSync, rmSync, existsSync, readdirSync, mkdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {parseArgs} from 'node:util';

export const DEFAULT_CATALOG = fileURLToPath(new URL('../sites/rss/subscriptions.json', import.meta.url));
export const CONNECTORS = [
  {id: 'funding', localOrigin: 'http://127.0.0.1:8765', originEnv: 'TODAY_RSS_FUNDING_ORIGIN'},
  {id: 'social-scholar', localOrigin: 'http://127.0.0.1:8766', originEnv: 'TODAY_RSS_SOCIAL_ORIGIN'},
  {id: 'zhihu', localOrigin: 'http://127.0.0.1:8767', originEnv: 'TODAY_RSS_ZHIHU_ORIGIN'},
  {id: 'conferences', localOrigin: 'http://127.0.0.1:8768', originEnv: 'TODAY_RSS_CONFERENCES_ORIGIN'},
];
const FEED_COLUMNS = 'id,feed_url,site_url,title,folder_id,source_type,custom_title,refresh_interval_min,auto_translate,open_mode';
const hash = value => createHash('sha256').update(value).digest('hex');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const requireValue = (ok, message) => { if (!ok) throw Error(message); };
const identifier = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]*$/.test(value);
const textValue = value => typeof value === 'string' && value.trim().length > 0 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);
const exactKeys = (value, keys, label) => {
  requireValue(value && !Array.isArray(value) && typeof value === 'object', `${label}: expected object`);
  requireValue(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), `${label}: unexpected or missing fields`);
};

function safeUrl(value, label) {
  requireValue(typeof value === 'string' && value === value.trim(), `${label}: invalid URL`);
  let url;
  try { url = new URL(value); } catch { throw Error(`${label}: invalid URL`); }
  requireValue(['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password, `${label}: unsupported URL or embedded credentials`);
  const secretKey = /token|api[-_]?key|secret|password|authorization|signature|session|^auth$|^key$/i;
  requireValue(![...url.searchParams.keys()].some(key => secretKey.test(key)) && !url.hash && !/github_pat_|gh[pousr]_[a-zA-Z0-9]|sk-[a-zA-Z0-9]{16}/.test(value), `${label}: possible credential; keep it outside Git`);
  return url;
}

export function validateCatalog(catalog) {
  exactKeys(catalog, ['version', 'connectors', 'workspaces'], 'catalog');
  requireValue(catalog.version === 1 && Array.isArray(catalog.connectors) && Array.isArray(catalog.workspaces) && catalog.workspaces.length > 0, 'Unsupported or empty RSS catalog');
  const connectors = new Map();
  for (const c of catalog.connectors) {
    exactKeys(c, ['id', 'localOrigin', 'originEnv'], 'connector');
    requireValue(identifier(c.id) && !connectors.has(c.id) && /^TODAY_RSS_[A-Z_]+_ORIGIN$/.test(c.originEnv), 'Invalid connector identity');
    const url = safeUrl(c.localOrigin, `connector ${c.id}`);
    requireValue(url.origin === c.localOrigin && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), `connector ${c.id}: expected loopback origin`);
    connectors.set(c.id, c);
  }
  requireValue(new Set(catalog.connectors.map(c => c.localOrigin)).size === connectors.size, 'Duplicate connector origin');
  const spaces = new Set(), sites = new Set();
  for (const space of catalog.workspaces) {
    exactKeys(space, ['spaceId', 'siteId', 'name', 'folders', 'feeds'], 'workspace');
    requireValue(identifier(space.spaceId) && identifier(space.siteId) && textValue(space.name) && !spaces.has(space.spaceId) && !sites.has(space.siteId), 'Invalid or duplicate workspace identity');
    spaces.add(space.spaceId); sites.add(space.siteId);
    requireValue(Array.isArray(space.folders) && Array.isArray(space.feeds), `${space.spaceId}: missing subscriptions`);
    const folders = new Map();
    for (const f of space.folders) {
      exactKeys(f, ['id', 'name', 'position', 'parentId'], `${space.spaceId} folder`);
      requireValue(identifier(f.id) && textValue(f.name) && Number.isSafeInteger(f.position) && !folders.has(f.id), `${space.spaceId}: invalid folder`);
      folders.set(f.id, f);
    }
    for (const f of folders.values()) {
      const seen = new Set([f.id]);
      let parent = f.parentId;
      while (parent !== null) {
        requireValue(folders.has(parent) && !seen.has(parent), `${space.spaceId}: orphan or cyclic folder`);
        seen.add(parent); parent = folders.get(parent).parentId;
      }
    }
    const urls = new Set(), ids = new Set();
    for (const f of space.feeds) {
      exactKeys(f, ['id', 'url', 'siteUrl', 'title', 'folderId', 'sourceType', 'customTitle', 'refreshIntervalMin', 'autoTranslate', 'openMode', 'archived', 'connectorId'], `${space.spaceId} feed`);
      requireValue(identifier(f.id) && !ids.has(f.id) && !urls.has(f.url) && textValue(f.title), `${space.spaceId}: invalid or duplicate feed`);
      ids.add(f.id); urls.add(f.url);
      const url = safeUrl(f.url, `${space.spaceId}/${f.id}`);
      if (f.siteUrl !== null) safeUrl(f.siteUrl, `${space.spaceId}/${f.id} site`);
      requireValue(f.folderId === null || folders.has(f.folderId), `${space.spaceId}/${f.id}: missing folder`);
      requireValue(['rss', 'youtube', 'podcast', 'mastodon', 'bluesky', 'reddit', 'newsletter'].includes(f.sourceType), `${space.spaceId}/${f.id}: invalid source type`);
      requireValue([f.customTitle, f.autoTranslate, f.archived].every(v => typeof v === 'boolean'), `${space.spaceId}/${f.id}: invalid preferences`);
      requireValue(f.refreshIntervalMin === null || (Number.isSafeInteger(f.refreshIntervalMin) && f.refreshIntervalMin >= 0), `${space.spaceId}/${f.id}: invalid interval`);
      requireValue([null, 'reader', 'extracted', 'web'].includes(f.openMode), `${space.spaceId}/${f.id}: invalid open mode`);
      const connector = catalog.connectors.find(c => c.localOrigin === url.origin);
      requireValue(f.connectorId === (connector?.id ?? null), `${space.spaceId}/${f.id}: invalid connector binding`);
      requireValue(!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || connector, `${space.spaceId}/${f.id}: unconfigured local connector`);
    }
  }
  return catalog;
}

export const loadCatalog = (path = DEFAULT_CATALOG) => validateCatalog(json(path));
export const catalogRevision = catalog => hash(JSON.stringify(validateCatalog(catalog)));
export function catalogSummary(catalog) {
  validateCatalog(catalog);
  const workspaces = catalog.workspaces.map(s => ({spaceId: s.spaceId, siteId: s.siteId, feeds: s.feeds.length, folders: s.folders.length, archived: s.feeds.filter(f => f.archived).length, connectors: s.feeds.filter(f => f.connectorId).length}));
  return {revision: catalogRevision(catalog), workspaces, feeds: workspaces.reduce((n, s) => n + s.feeds, 0), folders: workspaces.reduce((n, s) => n + s.folders, 0), bytes: Buffer.byteLength(JSON.stringify(catalog, null, 2) + '\n')};
}

// Does not call space-registry: reading RSS must not initialize directories,
// authorizations, manuscripts, or change the currently selected workspace.
export function desktopSpaces(dataDir) {
  const root = resolve(dataDir), registry = json(join(root, 'spaces.json'));
  requireValue(registry.version === 1 && Array.isArray(registry.sites) && registry.sites.length > 0, 'Invalid workspace registry');
  const spaceIds = new Set(), siteIds = new Set(), paths = new Set();
  const spaces = registry.sites.map(site => {
    requireValue(identifier(site.spaceId) && identifier(site.id) && textValue(site.name) && typeof site.legacy === 'boolean' && !spaceIds.has(site.spaceId) && !siteIds.has(site.id), 'Invalid or duplicate desktop workspace');
    spaceIds.add(site.spaceId); siteIds.add(site.id);
    const dbPath = join(site.legacy ? root : join(root, 'spaces', site.spaceId), 'papr.db');
    requireValue(!paths.has(dbPath) && existsSync(dbPath), `${site.spaceId}: missing or duplicate database; export stopped`);
    paths.add(dbPath);
    return {spaceId: site.spaceId, siteId: site.id, name: site.name, dbPath};
  });
  const candidates = [join(root, 'papr.db')];
  if (existsSync(join(root, 'spaces'))) for (const d of readdirSync(join(root, 'spaces'), {withFileTypes: true})) if (d.isDirectory()) candidates.push(join(root, 'spaces', d.name, 'papr.db'));
  requireValue(!candidates.some(p => existsSync(p) && !paths.has(p)), 'Unregistered workspace database found; export would be incomplete');
  return spaces.sort((a, b) => a.spaceId.localeCompare(b.spaceId, 'en'));
}

export async function openDesktopDatabase(path, {readOnly = true} = {}) {
  requireValue(existsSync(path), 'Desktop database must already exist; initialize the workspace in the app first');
  const {DatabaseSync} = await import('node:sqlite');
  const db = new DatabaseSync(path, {readOnly, enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false});
  db.exec('PRAGMA busy_timeout=5000');
  if (readOnly) db.exec('PRAGMA query_only=ON');
  return db;
}

export function readSourceRows(db) {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
  // Explicit allowlists: even a future schema with tokens/content stays private.
  return {
    feeds: db.prepare(`SELECT ${FEED_COLUMNS} FROM feeds ORDER BY id`).all().map(r => ({...r})),
    folders: db.prepare('SELECT id,name,position FROM folders ORDER BY position,id').all().map(r => ({...r})),
    links: tables.has('library_folder_links') ? db.prepare('SELECT folder_id,parent_id FROM library_folder_links').all() : [],
    archived: tables.has('library_archived_feeds') ? db.prepare('SELECT feed_id FROM library_archived_feeds').all().map(r => r.feed_id) : [],
    folderMap: tables.has('rss_catalog_folders') ? db.prepare('SELECT catalog_id,folder_id FROM rss_catalog_folders').all() : [],
    tables,
  };
}

function serializeSpace(space, rows, connectors) {
  const parents = new Map(rows.links.map(r => [r.folder_id, r.parent_id]));
  const archived = new Set(rows.archived);
  const folderIds = new Map(rows.folderMap.filter(m => rows.folders.some(f => f.id === m.folder_id)).map(m => [m.folder_id, m.catalog_id]));
  const used = new Set(folderIds.values());
  for (const f of rows.folders) if (!folderIds.has(f.id)) {
    let id = `folder-${f.id}`;
    while (used.has(id)) id += '-new';
    used.add(id); folderIds.set(f.id, id);
  }
  const folders = rows.folders.map(f => ({id: folderIds.get(f.id), name: f.name, position: f.position, parentId: parents.get(f.id) == null ? null : folderIds.get(parents.get(f.id))}));
  const feeds = rows.feeds.map(f => ({
    id: `feed-${hash(f.feed_url).slice(0, 24)}`, url: f.feed_url, siteUrl: f.site_url,
    title: f.title, folderId: f.folder_id === null ? null : folderIds.get(f.folder_id), sourceType: f.source_type,
    customTitle: Boolean(f.custom_title), refreshIntervalMin: f.refresh_interval_min,
    autoTranslate: Boolean(f.auto_translate), openMode: f.open_mode, archived: archived.has(f.id),
    connectorId: connectors.find(c => c.localOrigin === new URL(f.feed_url).origin)?.id ?? null,
  })).sort((a, b) => a.id.localeCompare(b.id, 'en'));
  folders.sort((a, b) => a.id.localeCompare(b.id, 'en'));
  return {spaceId: space.spaceId, siteId: space.siteId, name: space.name, folders, feeds};
}

export async function exportDesktopSources(dataDir) {
  const workspaces = [], connectors = structuredClone(CONNECTORS);
  for (const space of desktopSpaces(dataDir)) {
    const db = await openDesktopDatabase(space.dbPath);
    try {
      db.exec('BEGIN');
      workspaces.push(serializeSpace(space, readSourceRows(db), connectors));
      db.exec('COMMIT');
    } finally { db.close(); }
  }
  return validateCatalog({version: 1, connectors, workspaces});
}

export function writeCatalog(catalog, path = DEFAULT_CATALOG) {
  const bytes = JSON.stringify(validateCatalog(catalog), null, 2) + '\n';
  if (existsSync(path) && readFileSync(path, 'utf8').replaceAll('\r\n', '\n') === bytes) return false;
  mkdirSync(dirname(path), {recursive: true});
  const temp = `${path}.${randomUUID()}.tmp`;
  try { writeFileSync(temp, bytes, {flag: 'wx', mode: 0o600}); renameSync(temp, path); }
  finally { rmSync(temp, {force: true}); }
  return true;
}

export function readWorkspaceSources(catalog, spaceId, {target = 'server', env = process.env, includeArchived = false} = {}) {
  validateCatalog(catalog);
  requireValue(['local', 'server'].includes(target), 'target must be local or server');
  const space = catalog.workspaces.find(s => s.spaceId === spaceId);
  requireValue(space, `Unknown workspace: ${spaceId}`);
  const feeds = [], unavailable = [];
  for (const source of space.feeds) {
    if (source.archived && !includeArchived) continue;
    const feed = structuredClone(source);
    if (feed.connectorId) {
      const c = catalog.connectors.find(c => c.id === feed.connectorId);
      const origin = env[c.originEnv] || (target === 'local' ? c.localOrigin : null);
      if (!origin) { unavailable.push({id: feed.id, title: feed.title, connectorId: c.id, requiredEnv: c.originEnv}); continue; }
      const base = safeUrl(origin, `connector ${c.id}`);
      requireValue(base.origin === origin, `${c.originEnv}: use an origin without a path or trailing slash`);
      const url = new URL(feed.url);
      feed.url = origin + url.pathname + url.search;
    }
    feeds.push(feed);
  }
  return {version: 1, revision: catalogRevision(catalog), spaceId, siteId: space.siteId, name: space.name, folders: structuredClone(space.folders), feeds, unavailable};
}

const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
export function workspaceOpml(catalog, spaceId) {
  validateCatalog(catalog);
  const space = catalog.workspaces.find(s => s.spaceId === spaceId);
  requireValue(space, `Unknown workspace: ${spaceId}`);
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<opml version="2.0">', `  <head><title>${xml(space.name)} RSS</title></head>`, '  <body>'];
  const children = parent => {
    for (const folder of space.folders.filter(f => f.parentId === parent).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id, 'en'))) {
      out.push(`    <outline text="${xml(folder.name)}" title="${xml(folder.name)}">`);
      children(folder.id); entries(folder.id); out.push('    </outline>');
    }
  };
  const entries = folderId => {
    for (const f of space.feeds.filter(f => f.folderId === folderId)) out.push(`    <outline type="rss" text="${xml(f.title)}" title="${xml(f.title)}" xmlUrl="${xml(f.url)}"${f.siteUrl ? ` htmlUrl="${xml(f.siteUrl)}"` : ''} />`);
  };
  children(null); entries(null); out.push('  </body>', '</opml>', '');
  return out.join('\n');
}

async function main() {
  const {values, positionals} = parseArgs({allowPositionals: true, options: {
    catalog: {type: 'string', default: DEFAULT_CATALOG}, 'data-dir': {type: 'string'}, space: {type: 'string'},
    target: {type: 'string', default: 'server'}, out: {type: 'string'}, apply: {type: 'boolean', default: false},
    'include-archived': {type: 'boolean', default: false},
  }});
  requireValue(positionals.length === 1, 'Usage: rss-sources.mjs export|check|read|opml|sync [options]');
  const [command] = positionals;
  let result;
  if (command === 'export') {
    requireValue(values['data-dir'], 'export requires --data-dir');
    const catalog = await exportDesktopSources(values['data-dir']);
    result = {changed: writeCatalog(catalog, values.catalog), ...catalogSummary(catalog)};
  } else {
    const catalog = loadCatalog(values.catalog);
    if (command === 'check') result = catalogSummary(catalog);
    else if (command === 'read') {
      requireValue(values.space, 'read requires --space');
      result = readWorkspaceSources(catalog, values.space, {target: values.target, includeArchived: values['include-archived']});
    } else if (command === 'opml') {
      requireValue(values.space, 'opml requires --space');
      const output = workspaceOpml(catalog, values.space);
      if (values.out) writeFileSync(values.out, output, {encoding: 'utf8', mode: 0o600}); else process.stdout.write(output);
      return;
    } else if (command === 'sync') {
      requireValue(values['data-dir'], 'sync requires --data-dir');
      const {syncDesktopSources} = await import('./rss-sources-sync.mjs');
      result = await syncDesktopSources(catalog, values['data-dir'], {apply: values.apply, spaceId: values.space});
    } else throw Error('Unknown command; use export, check, read, opml or sync');
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`RSS sources: ${error.message}`); process.exitCode = 1; });
}
