import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {checkBoundary, contentProblems, linkProblem, pathProblem} from '../scripts/check-public-boundary.mjs';

function repository(files) {
  const root = mkdtempSync(join(tmpdir(), 'rssd-boundary-'));
  const git = (...args) => execFileSync('git', args, {cwd: root, stdio: 'pipe'});
  git('init', '-q');
  for (const [path, value] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), {recursive: true});
    if (typeof value === 'object') symlinkSync(value.link, join(root, path));
    else writeFileSync(join(root, path), value);
  }
  git('add', '-f', '-A');
  return {root, git};
}

test('private overlay paths, data exports and credentials files are rejected', () => {
  for (const path of ['editorial/articles/a.md', 'deploy/data/seeds/x.json', '.local/state.json', 'data.json', 'open-source.json',
    '.env', 'admin/.env.production', 'db/content.sqlite', 'keys/server.pem', 'admin/receipts/1.json', '.claude/settings.json']) {
    assert.ok(pathProblem(path), path);
  }
  for (const path of ['.env.example', '.claude/launch.json', 'tests/admin-coordination-receipt.test.mjs', 'sites/seeds/demo.json', 'docs/editorial.md']) {
    assert.equal(pathProblem(path), null, path);
  }
});

test('symlinks may not point into private overlays or outside the repository', () => {
  assert.match(linkProblem('AGENTS.md', 'deploy/workspace/AGENTS.md'), /overlay/);
  assert.match(linkProblem('docs/bot-writing-flow', '../deploy/docs/bot-writing-flow'), /overlay/);
  assert.match(linkProblem('docs/x', '../../outside'), /leaves/);
  assert.match(linkProblem('x', '/etc/passwd'), /absolute/);
  assert.equal(linkProblem('web/current', 'themes/academic'), null);
});

test('content scan finds credentials, personal home paths and private hosts', () => {
  const token = 'rssd_device_' + 'Ab3'.repeat(16);
  assert.deepEqual(contentProblems(`token=${token}`), ['RSSD device token']);
  assert.deepEqual(contentProblems('table rssd_device_authorizations'), []);
  assert.deepEqual(contentProblems('-----BEGIN OPENSSH ' + 'PRIVATE KEY-----'), ['private key']);
  assert.deepEqual(contentProblems('path /Users/' + 'somebody/Library'), ['personal home path']);
  assert.deepEqual(contentProblems('C:\\Users\\' + 'somebody\\AppData'), ['personal home path']);
  assert.deepEqual(contentProblems('home /Users/example/Library and https://site.test/home/nav'), []);
  assert.deepEqual(contentProblems('server 127.0.0.1 and 10.0.0.1'), []);
});

test('the checker scans tracked files and, with --staged, only the staged changes', () => {
  const {root, git} = repository({'README.md': 'clean\n', 'AGENTS.md': {link: 'deploy/workspace/AGENTS.md'}, 'notes.txt': 'see /Users/' + 'somebody/x\n'});
  try {
    const problems = checkBoundary(root);
    assert.deepEqual(problems.sort(), ['AGENTS.md: symlink into private overlay directory', 'notes.txt: personal home path']);
    git('-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-q', '--no-verify', '-m', 'seed');
    writeFileSync(join(root, 'README.md'), 'still clean\n');
    git('add', 'README.md');
    assert.deepEqual(checkBoundary(root, {staged: true}), []);
    mkdirSync(join(root, 'editorial'));
    writeFileSync(join(root, 'editorial/draft.md'), 'private\n');
    git('add', '-f', 'editorial/draft.md');
    assert.deepEqual(checkBoundary(root, {staged: true}), ['editorial/draft.md: private overlay directory']);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
