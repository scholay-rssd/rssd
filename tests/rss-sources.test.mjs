import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {
  loadCatalog, validateCatalog, catalogSummary, exportDesktopSources, writeCatalog,
  readWorkspaceSources, workspaceOpml, desktopSpaces,
} from '../scripts/rss-sources.mjs';
import {syncDesktopSources} from '../scripts/rss-sources-sync.mjs';

const SCHEMA = `
CREATE TABLE folders(id INTEGER PRIMARY KEY,name TEXT NOT NULL,position INTEGER NOT NULL DEFAULT 0);
CREATE TABLE feeds(id INTEGER PRIMARY KEY,feed_url TEXT NOT NULL UNIQUE,site_url TEXT,title TEXT NOT NULL,
  description TEXT,favicon_url TEXT,folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL DEFAULT 'rss',etag TEXT,last_modified TEXT,last_fetched_at TEXT,fetch_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),custom_title INTEGER NOT NULL DEFAULT 0,
  refresh_interval_min INTEGER,auto_translate INTEGER NOT NULL DEFAULT 0,open_mode TEXT);
CREATE TABLE library_folder_links(folder_id INTEGER PRIMARY KEY REFERENCES folders(id) ON DELETE CASCADE,parent_id INTEGER REFERENCES folders(id) ON DELETE SET NULL);
CREATE TABLE library_archived_feeds(feed_id INTEGER PRIMARY KEY REFERENCES feeds(id) ON DELETE CASCADE,archived_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE library_meta(id INTEGER PRIMARY KEY,revision INTEGER NOT NULL);
INSERT INTO library_meta VALUES(1,0);
CREATE TABLE articles(id INTEGER PRIMARY KEY,feed_id INTEGER REFERENCES feeds(id),content_html TEXT,is_read INTEGER,is_starred INTEGER);
CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);
INSERT INTO settings VALUES('secret-token','NEVER_EXPORT_SETTINGS');
`;

function fixture(t, sites = [{spaceId: 'academic', siteId: 'scholay-today', name: '学术 & 日历'}]) {
  const root = mkdtempSync(join(tmpdir(), 'today-rss-sources-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const registry = {version: 1, activeSpaceId: sites[0].spaceId, sites: sites.map((s, i) => ({id: s.siteId, spaceId: s.spaceId, name: s.name, legacy: i === 0}))};
  writeFileSync(join(root, 'spaces.json'), JSON.stringify(registry));
  const paths = sites.map((s, i) => {
    const path = join(i === 0 ? root : join(root, 'spaces', s.spaceId), 'papr.db');
    mkdirSync(join(path, '..'), {recursive: true});
    const db = new DatabaseSync(path); db.exec(SCHEMA); db.close();
    return path;
  });
  return {root, paths};
}

function seed(path) {
  const db = new DatabaseSync(path);
  db.exec(`INSERT INTO folders VALUES(4,'父组',7),(9,'空组',1),(12,'子组 & <特殊>',3);
    INSERT INTO library_folder_links VALUES(12,4);
    INSERT INTO feeds(id,feed_url,title,folder_id,custom_title,refresh_interval_min,auto_translate,open_mode,etag,description)
      VALUES(42,'https://example.org/feed?a=1&b=2','自定义 "标题"',12,1,45,1,'web','LOCAL_ETAG','NEVER_EXPORT_DESCRIPTION');
    INSERT INTO feeds(id,feed_url,title) VALUES(77,'http://127.0.0.1:8765/funding.xml','基金');
    INSERT INTO library_archived_feeds(feed_id) VALUES(42);
    INSERT INTO articles VALUES(1,42,'NEVER_EXPORT_ARTICLE',1,1);`);
  db.close();
}

test('exports all registered spaces, empty/nested folders and preferences; excludes content and credentials', async t => {
  const {root, paths} = fixture(t, [{spaceId: 'academic', siteId: 'scholay-today', name: '学术'}, {spaceId: 'pets', siteId: 'pets', name: '萌宠'}]);
  seed(paths[0]);
  const before = paths.map(p => readFileSync(p));
  const catalog = await exportDesktopSources(root), space = catalog.workspaces[0];
  assert.equal(catalog.workspaces.length, 2);
  assert.equal(space.folders.length, 3);
  assert.equal(space.folders.find(f => f.id === 'folder-12').parentId, 'folder-4');
  const feed = space.feeds.find(f => f.title.includes('自定义'));
  assert.equal(feed.customTitle, true); assert.equal(feed.autoTranslate, true);
  assert.equal(feed.refreshIntervalMin, 45); assert.equal(feed.archived, true);
  assert.equal(feed.openMode, 'web');
  assert.doesNotMatch(JSON.stringify(catalog), /NEVER_EXPORT|LOCAL_ETAG|AppData|created_at|articles|settings/);
  paths.forEach((p, i) => assert.deepEqual(readFileSync(p), before[i]));
  const output = join(root, 'sources.json');
  assert.equal(writeCatalog(catalog, output), true);
  assert.equal(writeCatalog(await exportDesktopSources(root), output), false);
  assert.deepEqual(loadCatalog(output), catalog);
  writeFileSync(output, readFileSync(output, 'utf8').replaceAll('\n', '\r\n'));
  assert.equal(writeCatalog(catalog, output), false);
  const opml = workspaceOpml(catalog, 'academic');
  assert.match(opml, /子组 &amp; &lt;特殊&gt;/);
  assert.match(opml, /a=1&amp;b=2/);
  assert.match(opml, /空组/);
  assert.equal((opml.match(/xmlUrl=/g) || []).length, 2);
});

test('read-only export sees WAL updates and never reads article rows', async t => {
  const {root, paths} = fixture(t);
  const db = new DatabaseSync(paths[0]);
  try {
    db.exec("PRAGMA journal_mode=WAL; INSERT INTO feeds(feed_url,title) VALUES('https://example.org/wal','WAL source'); DROP TABLE articles; DROP TABLE settings;");
    assert.equal((await exportDesktopSources(root)).workspaces[0].feeds[0].title, 'WAL source');
  } finally { db.close(); }
});

test('all real sources round-trip into empty desktop databases without any article data', async t => {
  const catalog = loadCatalog();
  const {root, paths} = fixture(t, catalog.workspaces);
  const plan = await syncDesktopSources(catalog, root);
  assert.equal(plan.applied, false);
  assert.equal(plan.workspaces.reduce((n, w) => n + w.feedsAdded, 0), catalogSummary(catalog).feeds);
  const applied = await syncDesktopSources(catalog, root, {apply: true});
  assert.equal(applied.applied, true);
  assert.deepEqual(await exportDesktopSources(root), catalog);
  const repeated = await syncDesktopSources(catalog, root, {apply: true});
  for (const result of repeated.workspaces) {
    assert.equal(result.feedsAdded + result.feedsUpdated + result.foldersAdded + result.foldersUpdated, 0);
  }
  for (const path of paths) {
    const db = new DatabaseSync(path);
    assert.equal(db.prepare('SELECT count(*) AS n FROM articles').get().n, 0);
    assert.equal(db.prepare("SELECT value FROM settings WHERE key='secret-token'").get().value, 'NEVER_EXPORT_SETTINGS');
    db.close();
  }
});

test('sync preserves existing feed IDs, article state and unrelated subscriptions; folder renames use saved identity', async t => {
  const {root, paths} = fixture(t); seed(paths[0]);
  const catalog = await exportDesktopSources(root);
  await syncDesktopSources(catalog, root, {apply: true});
  const db = new DatabaseSync(paths[0]);
  db.exec("INSERT INTO feeds(id,feed_url,title) VALUES(99,'https://local.example/feed','Local only')");
  const beforeArticles = db.prepare('SELECT * FROM articles').all();
  const beforeFeed = db.prepare('SELECT * FROM feeds WHERE id=42').get();
  catalog.workspaces[0].folders.find(f => f.id === 'folder-12').name = '新名称';
  catalog.workspaces[0].folders.find(f => f.id === 'folder-12').parentId = 'folder-9';
  const feed = catalog.workspaces[0].feeds.find(f => f.url.startsWith('https:'));
  feed.title = '更新标题'; feed.archived = false; feed.refreshIntervalMin = 120;
  const preview = await syncDesktopSources(catalog, root);
  assert.equal(preview.workspaces[0].localOnlyFeedsPreserved, 1);
  assert.deepEqual(db.prepare('SELECT * FROM feeds WHERE id=42').get(), beforeFeed);
  await syncDesktopSources(catalog, root, {apply: true});
  assert.deepEqual(db.prepare('SELECT * FROM articles').all(), beforeArticles);
  assert.equal(db.prepare('SELECT etag FROM feeds WHERE id=42').get().etag, 'LOCAL_ETAG');
  assert.equal(db.prepare('SELECT title FROM feeds WHERE id=42').get().title, '更新标题');
  assert.equal(db.prepare('SELECT count(*) AS n FROM feeds WHERE id=99').get().n, 1);
  assert.equal(db.prepare('SELECT name FROM folders WHERE id=12').get().name, '新名称');
  assert.equal(db.prepare('SELECT parent_id FROM library_folder_links WHERE folder_id=12').get().parent_id, 9);
  assert.equal(db.prepare('SELECT count(*) AS n FROM library_archived_feeds').get().n, 0);
  db.close();
});

test('restoration remaps colliding local IDs and retains parent links and ungrouped feeds', async t => {
  const source = fixture(t); seed(source.paths[0]);
  const catalog = await exportDesktopSources(source.root);
  const destination = fixture(t), db = new DatabaseSync(destination.paths[0]);
  db.exec("INSERT INTO folders VALUES(4,'unrelated',0); INSERT INTO feeds(id,feed_url,title) VALUES(42,'https://unrelated.example/rss','unrelated');");
  await syncDesktopSources(catalog, destination.root, {apply: true});
  const restored = await exportDesktopSources(destination.root);
  const sourceIds = new Set(catalog.workspaces[0].feeds.map(f => f.id));
  assert.deepEqual(restored.workspaces[0].feeds.filter(f => sourceIds.has(f.id)), catalog.workspaces[0].feeds);
  const folderIds = new Set(catalog.workspaces[0].folders.map(f => f.id));
  assert.deepEqual(restored.workspaces[0].folders.filter(f => folderIds.has(f.id)), catalog.workspaces[0].folders);
  assert.equal(db.prepare('SELECT title FROM feeds WHERE id=42').get().title, 'unrelated');
  db.close();
});

test('a failed apply rolls back the entire workspace, including mapping tables', async t => {
  const source = fixture(t); seed(source.paths[0]);
  const catalog = await exportDesktopSources(source.root);
  const destination = fixture(t), db = new DatabaseSync(destination.paths[0]);
  db.exec("CREATE TRIGGER reject_feed BEFORE INSERT ON feeds BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
  await assert.rejects(syncDesktopSources(catalog, destination.root, {apply: true}), /injected failure/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM folders').get().n, 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='rss_catalog_folders'").get().n, 0);
  db.close();
});

test('server/local share one catalog; server reports unresolved connectors and respects archived feeds', async t => {
  const {root, paths} = fixture(t); seed(paths[0]);
  const catalog = await exportDesktopSources(root);
  const server = readWorkspaceSources(catalog, 'academic', {env: {}});
  assert.equal(server.feeds.length, 0); assert.equal(server.unavailable.length, 1);
  assert.equal(server.unavailable[0].requiredEnv, 'TODAY_RSS_FUNDING_ORIGIN');
  const local = readWorkspaceSources(catalog, 'academic', {target: 'local', env: {}});
  assert.equal(local.feeds[0].url, 'http://127.0.0.1:8765/funding.xml');
  const configured = readWorkspaceSources(catalog, 'academic', {env: {TODAY_RSS_FUNDING_ORIGIN: 'https://rss.example.org'}, includeArchived: true});
  assert.equal(configured.feeds.length, 2); assert.equal(configured.unavailable.length, 0);
  assert.ok(configured.feeds.some(f => f.url === 'https://rss.example.org/funding.xml'));
  assert.equal(configured.revision, local.revision);
  assert.throws(() => readWorkspaceSources(catalog, 'academic', {env: {TODAY_RSS_FUNDING_ORIGIN: 'https://user:secret@example.org'}}), /credentials/);
  assert.throws(() => readWorkspaceSources(catalog, 'missing'), /Unknown workspace/);
});

test('validation rejects accidental content, secrets, duplicate identities and broken folder trees', () => {
  const base = loadCatalog();
  const invalid = mutate => { const c = structuredClone(base); mutate(c); assert.throws(() => validateCatalog(c)); };
  invalid(c => c.articles = []);
  invalid(c => c.workspaces[0].feeds[0].content_html = 'private');
  invalid(c => c.workspaces[0].feeds[0].url = 'https://example.org/feed?access_token=secret');
  invalid(c => c.workspaces[0].feeds[0].url = 'https://user:password@example.org/feed');
  invalid(c => c.workspaces[0].folders[0].parentId = c.workspaces[0].folders[0].id);
  invalid(c => c.workspaces[0].feeds[0].folderId = 'missing');
  invalid(c => c.workspaces.push(structuredClone(c.workspaces[0])));
  invalid(c => c.workspaces[0].feeds.push(structuredClone(c.workspaces[0].feeds[0])));
  invalid(c => { c.workspaces[0].feeds[0].url = 'http://127.0.0.1:9999/feed'; c.workspaces[0].feeds[0].connectorId = null; });
});

test('missing or unregistered databases abort instead of exporting an incomplete catalog', async t => {
  const {root, paths} = fixture(t);
  const extra = join(root, 'spaces', 'orphan'); mkdirSync(extra, {recursive: true});
  writeFileSync(join(extra, 'papr.db'), 'not a database');
  assert.throws(() => desktopSpaces(root), /Unregistered/);
  rmSync(extra, {recursive: true}); rmSync(paths[0]);
  await assert.rejects(exportDesktopSources(root), /missing/);
  assert.equal(existsSync(paths[0]), false);
});

test('preflight validates every workspace before applying the first one', async t => {
  const sites = [{spaceId: 'academic', siteId: 'scholay-today', name: '学术'}, {spaceId: 'pets', siteId: 'pets', name: '萌宠'}];
  const source = fixture(t, sites); seed(source.paths[0]);
  const catalog = await exportDesktopSources(source.root);
  const destination = fixture(t, sites);
  const broken = new DatabaseSync(destination.paths[1]);
  broken.exec('DROP TABLE feeds'); broken.close();
  await assert.rejects(syncDesktopSources(catalog, destination.root, {apply: true}), /no such table/);
  const first = new DatabaseSync(destination.paths[0]);
  assert.equal(first.prepare('SELECT count(*) AS n FROM feeds').get().n, 0);
  assert.equal(first.prepare('SELECT count(*) AS n FROM folders').get().n, 0);
  first.close();
});
