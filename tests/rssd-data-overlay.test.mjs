import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {dataOverlayRoot, overlayDirectory, CALENDAR_DIR} from '../scripts/data-overlay.mjs';

async function repo(t, files = ['historyEvents.json', 'yearSeeds.json']) {
  const root = await mkdtemp(join(tmpdir(), 'rssd-overlay-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, CALENDAR_DIR), {recursive: true});
  for (const name of files) await writeFile(join(root, CALENDAR_DIR, name), '[]');
  return root;
}
async function overlay(base, files) {
  await mkdir(join(base, CALENDAR_DIR), {recursive: true});
  for (const name of files) await writeFile(join(base, CALENDAR_DIR, name), '[{"real":true}]');
  return base;
}

test('public checkouts without an overlay keep the synthetic directory', async (t) => {
  const root = await repo(t);
  assert.equal(dataOverlayRoot(root, {}), null);
  assert.deepEqual(overlayDirectory(CALENDAR_DIR, {repoRoot: root, env: {}}), {directory: join(root, CALENDAR_DIR), overlay: false});
});

test('RSSD_DATA_DIR must be an existing absolute directory', async (t) => {
  const root = await repo(t);
  assert.throws(() => dataOverlayRoot(root, {RSSD_DATA_DIR: 'relative/data'}), /absolute/);
  assert.throws(() => dataOverlayRoot(root, {RSSD_DATA_DIR: join(root, 'missing')}), /not a directory/);
});

test('a complete overlay replaces the whole directory', async (t) => {
  const root = await repo(t);
  const data = await overlay(join(root, 'elsewhere'), ['historyEvents.json', 'yearSeeds.json']);
  assert.deepEqual(overlayDirectory(CALENDAR_DIR, {repoRoot: root, env: {RSSD_DATA_DIR: data}}), {directory: join(data, CALENDAR_DIR), overlay: true});
});

test('an incomplete overlay is rejected instead of mixing private and synthetic files', async (t) => {
  const root = await repo(t);
  const data = await overlay(join(root, 'elsewhere'), ['historyEvents.json']);
  assert.throws(() => overlayDirectory(CALENDAR_DIR, {repoRoot: root, env: {RSSD_DATA_DIR: data}}), /missing yearSeeds\.json/);
});

test('an overlay without this directory falls back to the public files', async (t) => {
  const root = await repo(t);
  const data = join(root, 'elsewhere');
  await mkdir(data);
  assert.equal(overlayDirectory(CALENDAR_DIR, {repoRoot: root, env: {RSSD_DATA_DIR: data}}).overlay, false);
});

test('the private deployment checkout is used when RSSD_DATA_DIR is unset', async (t) => {
  const root = await repo(t);
  await overlay(join(root, 'deploy', 'data'), ['historyEvents.json', 'yearSeeds.json']);
  assert.equal(dataOverlayRoot(root, {}), join(root, 'deploy', 'data'));
  assert.equal(overlayDirectory(CALENDAR_DIR, {repoRoot: root, env: {}}).overlay, true);
});
