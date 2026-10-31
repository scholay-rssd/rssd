// Apply the shared configuration to existing desktop workspaces. Article IDs,
// caches and reading state are deliberately absent from all queries/mutations.
import {createHash} from 'node:crypto';
import {validateCatalog, catalogRevision, desktopSpaces, openDesktopDatabase, readSourceRows} from './rss-sources.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const snapshotHash = rows => createHash('sha256').update(JSON.stringify({
  feeds: rows.feeds, folders: rows.folders, links: rows.links, archived: rows.archived, folderMap: rows.folderMap,
})).digest('hex');

function planSpace(space, rows) {
  const existingFolders = new Map(rows.folders.map(f => [f.id, f]));
  const parents = new Map(rows.links.map(l => [l.folder_id, l.parent_id]));
  const previousMap = new Map(rows.folderMap.map(m => [m.catalog_id, m.folder_id]));
  const folderIds = new Map(), used = new Set(), folders = [];
  let nextFolder = Math.max(0, ...rows.folders.map(f => f.id)) + 1;
  for (const f of space.folders) if (existingFolders.has(previousMap.get(f.id))) {
    folderIds.set(f.id, previousMap.get(f.id)); used.add(previousMap.get(f.id));
  }
  const planned = new Set();
  function folderPlan(f) {
    if (planned.has(f.id)) return;
    if (f.parentId !== null) folderPlan(space.folders.find(p => p.id === f.parentId));
    const parentId = f.parentId === null ? null : folderIds.get(f.parentId);
    if (!folderIds.has(f.id)) {
      const matches = rows.folders.filter(row => !used.has(row.id) && row.name === f.name && (parents.get(row.id) ?? null) === parentId);
      if (matches.length > 1) throw Error(`${space.spaceId}/${f.id}: ambiguous local folders; resolve duplicate siblings before syncing`);
      const id = matches[0]?.id ?? nextFolder++;
      folderIds.set(f.id, id); used.add(id);
    }
    const id = folderIds.get(f.id), old = existingFolders.get(id);
    folders.push({catalogId: f.id, id, name: f.name, position: f.position, parentId,
      added: !old, changed: Boolean(old && (old.name !== f.name || old.position !== f.position || (parents.get(id) ?? null) !== parentId))});
    planned.add(f.id);
  }
  for (const folder of space.folders) folderPlan(folder);
  const existingFeeds = new Map(rows.feeds.map(f => [f.feed_url, f]));
  const archived = new Set(rows.archived), feeds = [];
  let nextFeed = Math.max(0, ...rows.feeds.map(f => f.id)) + 1;
  for (const f of space.feeds) {
    const old = existingFeeds.get(f.url), id = old?.id ?? nextFeed++;
    const fields = {site_url: f.siteUrl, title: f.title, folder_id: f.folderId === null ? null : folderIds.get(f.folderId),
      source_type: f.sourceType, custom_title: Number(f.customTitle), refresh_interval_min: f.refreshIntervalMin,
      auto_translate: Number(f.autoTranslate), open_mode: f.openMode};
    const changed = old && (!same(fields, Object.fromEntries(Object.keys(fields).map(k => [k, old[k]]))) || archived.has(id) !== f.archived);
    feeds.push({id, url: f.url, fields, archived: f.archived, added: !old, changed: Boolean(changed)});
  }
  const configured = new Set(space.feeds.map(f => f.url));
  return {folders, feeds, snapshot: snapshotHash(rows), summary: {
    spaceId: space.spaceId, foldersAdded: folders.filter(f => f.added).length, foldersUpdated: folders.filter(f => f.changed).length,
    feedsAdded: feeds.filter(f => f.added).length, feedsUpdated: feeds.filter(f => f.changed).length,
    localOnlyFeedsPreserved: rows.feeds.filter(f => !configured.has(f.feed_url)).length,
    localOnlyFoldersPreserved: rows.folders.filter(f => !used.has(f.id)).length,
  }};
}

function applyPlan(db, plan) {
  db.exec(`CREATE TABLE IF NOT EXISTS library_folder_links (
    folder_id INTEGER PRIMARY KEY REFERENCES folders(id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES folders(id) ON DELETE SET NULL);
    CREATE TABLE IF NOT EXISTS library_archived_feeds (
    feed_id INTEGER PRIMARY KEY REFERENCES feeds(id) ON DELETE CASCADE,
    archived_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS rss_catalog_folders (
    catalog_id TEXT PRIMARY KEY, folder_id INTEGER NOT NULL UNIQUE REFERENCES folders(id) ON DELETE CASCADE);`);
  for (const f of plan.folders) {
    if (f.added) db.prepare('INSERT INTO folders(id,name,position) VALUES(?,?,?)').run(f.id, f.name, f.position);
    else if (f.changed) db.prepare('UPDATE folders SET name=?,position=? WHERE id=?').run(f.name, f.position, f.id);
    if (f.added || f.changed) db.prepare('INSERT INTO library_folder_links(folder_id,parent_id) VALUES(?,?) ON CONFLICT(folder_id) DO UPDATE SET parent_id=excluded.parent_id').run(f.id, f.parentId);
    db.prepare('DELETE FROM rss_catalog_folders WHERE folder_id=? AND catalog_id<>?').run(f.id, f.catalogId);
    db.prepare('INSERT INTO rss_catalog_folders(catalog_id,folder_id) VALUES(?,?) ON CONFLICT(catalog_id) DO UPDATE SET folder_id=excluded.folder_id WHERE folder_id<>excluded.folder_id').run(f.catalogId, f.id);
  }
  for (const f of plan.feeds) {
    if (!f.added && !f.changed) continue;
    const columns = Object.keys(f.fields), values = Object.values(f.fields);
    if (f.added) db.prepare(`INSERT INTO feeds(id,feed_url,${columns.join(',')}) VALUES(?,?,${columns.map(() => '?').join(',')})`).run(f.id, f.url, ...values);
    else db.prepare(`UPDATE feeds SET ${columns.map(c => `${c}=?`).join(',')} WHERE id=?`).run(...values, f.id);
    if (f.archived) db.prepare('INSERT OR IGNORE INTO library_archived_feeds(feed_id) VALUES(?)').run(f.id);
    else db.prepare('DELETE FROM library_archived_feeds WHERE feed_id=?').run(f.id);
  }
  if (plan.folders.some(f => f.added || f.changed) || plan.feeds.some(f => f.added || f.changed)) {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='library_meta'").get();
    if (exists) db.prepare('UPDATE library_meta SET revision=revision+1 WHERE id=1').run();
  }
}

export async function syncDesktopSources(catalog, dataDir, {apply = false, spaceId} = {}) {
  validateCatalog(catalog);
  const wanted = spaceId ? catalog.workspaces.filter(s => s.spaceId === spaceId) : catalog.workspaces;
  if (!wanted.length) throw Error(`Unknown workspace: ${spaceId}`);
  const registered = desktopSpaces(dataDir);
  const targets = wanted.map(source => {
    const target = registered.find(s => s.spaceId === source.spaceId && s.siteId === source.siteId);
    if (!target) throw Error(`${source.spaceId}: initialize/authorize this workspace in the app first`);
    return {source, ...target};
  });
  const plans = [];
  // Preflight every target before writing any workspace. Incompatible schemas,
  // ambiguous folders and missing databases must not cause a partial restore.
  for (const target of targets) {
    const db = await openDesktopDatabase(target.dbPath);
    try {
      db.exec('BEGIN'); plans.push(planSpace(target.source, readSourceRows(db))); db.exec('COMMIT');
    } finally { db.close(); }
  }
  const completed = [];
  if (apply) for (let i = 0; i < targets.length; i++) {
    const target = targets[i], plan = plans[i], db = await openDesktopDatabase(target.dbPath, {readOnly: false});
    try {
      db.exec('BEGIN IMMEDIATE');
      if (snapshotHash(readSourceRows(db)) !== plan.snapshot) throw Error('Source configuration changed during sync; rerun the preview');
      applyPlan(db, plan);
      db.exec('COMMIT'); completed.push(target.spaceId);
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw Error(`${target.spaceId}: ${error.message}. Completed workspaces: ${completed.join(', ') || 'none'}. Each workspace is atomic; retry is safe.`);
    } finally { db.close(); }
  }
  return {applied: apply, revision: catalogRevision(catalog), workspaces: plans.map(p => p.summary)};
}
