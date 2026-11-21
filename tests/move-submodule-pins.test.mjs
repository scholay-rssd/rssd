import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {applyPinMoves, commitMessage, githubRepo, planPinMoves} from '../scripts/move-submodule-pins.mjs';

const IDENTITY = ['-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false'];

function repository(root) {
  mkdirSync(root);
  const git = (...args) => execFileSync('git', [...IDENTITY, ...args], {cwd: root, stdio: 'pipe', encoding: 'utf8'}).trim();
  git('init', '-q', '-b', 'main');
  return git;
}

// Two upstream repositories: "center" gains a merged pull request after the
// pin, "themes" does not move. The superproject pins both.
function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'rssd-move-pins-test-'));
  const center = repository(join(base, 'center'));
  center('commit', '-q', '--allow-empty', '-m', 'first');
  const pinned = center('rev-parse', 'HEAD');
  center('checkout', '-q', '-b', 'feature');
  center('commit', '-q', '--allow-empty', '-m', 'work in progress');
  center('checkout', '-q', 'main');
  center('merge', '-q', '--no-ff', 'feature', '-m', 'Merge pull request #7 from org/feature\n\nServe the new page');
  center('commit', '-q', '--allow-empty', '-m', 'Direct fix on main');
  const tip = center('rev-parse', 'HEAD');
  const themes = repository(join(base, 'themes'));
  themes('commit', '-q', '--allow-empty', '-m', 'only');
  const themesTip = themes('rev-parse', 'HEAD');

  const superproject = join(base, 'super');
  const sup = repository(superproject);
  writeFileSync(join(superproject, '.gitmodules'),
    `[submodule "center"]\n\tpath = center\n\turl = ${pathToFileURL(join(base, 'center')).href}\n` +
    `[submodule "web/themes"]\n\tpath = web/themes\n\turl = ${pathToFileURL(join(base, 'themes')).href}\n`);
  sup('update-index', '--add', '--cacheinfo', `160000,${pinned},center`);
  sup('update-index', '--add', '--cacheinfo', `160000,${themesTip},web/themes`);
  sup('add', '.gitmodules');
  sup('commit', '-q', '--no-verify', '-m', 'pins');
  return {base, superproject, sup, pinned, tip};
}

test('only pins behind their main move, listed by merged pull request title', async () => {
  const {base, superproject, sup, pinned, tip} = fixture();
  try {
    const moves = await planPinMoves(superproject);
    assert.equal(moves.length, 1);
    assert.equal(moves[0].path, 'center');
    assert.equal(moves[0].from, pinned);
    assert.equal(moves[0].to, tip);
    assert.deepEqual(moves[0].log.map((line) => line.replace(/^\w+ /, '')), ['Direct fix on main', '#7 Serve the new page']);
    const message = commitMessage(moves);
    assert.match(message, /^Move the center pin to its main\n\ncenter [0-9a-f]{7}\.\.[0-9a-f]{7}\n/);

    await applyPinMoves(superproject, moves);
    assert.equal(sup('rev-parse', ':center'), tip);
    sup('commit', '-q', '--no-verify', '-m', 'moved');
    assert.deepEqual(await planPinMoves(superproject), []);
  } finally {
    rmSync(base, {recursive: true, force: true});
  }
});

test('PR numbers name the submodule repository on GitHub', () => {
  assert.equal(githubRepo('https://github.com/scholay-rssd/rssd-obsidian.git'), 'scholay-rssd/rssd-obsidian');
  assert.equal(githubRepo('git@github.com:scholay-rssd/rssd-center'), 'scholay-rssd/rssd-center');
  assert.equal(githubRepo('/tmp/upstream/center'), '');
});

test('the message names every moved submodule', () => {
  const move = (path) => ({path, from: 'a'.repeat(40), to: 'b'.repeat(40), log: ['bbbbbbb #1 Title']});
  assert.match(commitMessage([move('center'), move('obsidian'), move('web/themes')]),
    /^Move the center, obsidian and themes pins to their mains\n/);
});
