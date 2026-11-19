import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import test from 'node:test';
import {checkSubmodulePins} from '../scripts/check-submodule-pins.mjs';

const IDENTITY = ['-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false'];

function repository(root) {
  mkdirSync(root);
  const git = (...args) => execFileSync('git', [...IDENTITY, ...args], {cwd: root, stdio: 'pipe', encoding: 'utf8'}).trim();
  git('init', '-q', '-b', 'main');
  return git;
}

// An upstream submodule repository with two commits on main and one on a
// feature branch, and a superproject whose .gitmodules points at it.
function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'rssd-pins-test-'));
  const upstream = join(base, 'upstream');
  const superproject = join(base, 'super');
  const up = repository(upstream);
  up('commit', '-q', '--allow-empty', '-m', 'first');
  const first = up('rev-parse', 'HEAD');
  up('commit', '-q', '--allow-empty', '-m', 'second');
  const tip = up('rev-parse', 'HEAD');
  up('checkout', '-q', '-b', 'feature');
  up('commit', '-q', '--allow-empty', '-m', 'feature only');
  const feature = up('rev-parse', 'HEAD');
  up('checkout', '-q', 'main');

  const sup = repository(superproject);
  writeFileSync(join(superproject, '.gitmodules'),
    `[submodule "center"]\n\tpath = center\n\turl = ${pathToFileURL(upstream).href}\n`);
  // A local checkout URL in the repository config must not be used.
  sup('config', 'submodule.center.url', join(base, 'elsewhere'));
  const pin = (sha, path = 'center') => {
    sup('update-index', '--add', '--cacheinfo', `160000,${sha},${path}`);
    sup('add', '.gitmodules');
    sup('commit', '-q', '--no-verify', '-m', `pin ${path} ${sha.slice(0, 7)}`);
    return sup('rev-parse', 'HEAD');
  };
  return {base, superproject, first, tip, feature, pin};
}

test('pins on main pass, including older commits on main', async () => {
  const {base, superproject, first, tip, pin} = fixture();
  try {
    pin(tip);
    assert.deepEqual(await checkSubmodulePins(superproject), []);
    pin(first);
    assert.deepEqual(await checkSubmodulePins(superproject), []);
  } finally {
    rmSync(base, {recursive: true, force: true});
  }
});

test('a pin on a feature branch is not on main; an unknown commit is not on GitHub', async () => {
  const {base, superproject, tip, feature, pin} = fixture();
  try {
    const good = pin(tip);
    pin(feature);
    assert.deepEqual(await checkSubmodulePins(superproject), [{path: 'center', sha: feature, problem: 'not on main'}]);
    const missing = '1'.repeat(40);
    pin(missing);
    assert.deepEqual(await checkSubmodulePins(superproject), [{path: 'center', sha: missing, problem: 'not on GitHub'}]);
    assert.deepEqual(await checkSubmodulePins(superproject, {rev: good}), []);
  } finally {
    rmSync(base, {recursive: true, force: true});
  }
});

test('a gitlink missing from .gitmodules is reported, since it cannot be checked', async () => {
  const {base, superproject, tip, pin} = fixture();
  try {
    pin(tip);
    pin(tip, 'vendor/stray');
    assert.deepEqual(await checkSubmodulePins(superproject), [{path: 'vendor/stray', sha: tip, problem: 'not in .gitmodules'}]);
  } finally {
    rmSync(base, {recursive: true, force: true});
  }
});

test('the CLI exits non-zero and names the submodule, sha and reason', () => {
  const {base, superproject, feature, pin} = fixture();
  try {
    pin(feature);
    const script = fileURLToPath(new URL('../scripts/check-submodule-pins.mjs', import.meta.url));
    let failure;
    try {
      execFileSync(process.execPath, [script, superproject], {stdio: 'pipe', encoding: 'utf8'});
    } catch (error) {
      failure = error;
    }
    assert.equal(failure?.status, 1);
    assert.match(failure.stderr, new RegExp(`center ${feature}: not on main`));
  } finally {
    rmSync(base, {recursive: true, force: true});
  }
});
