#!/usr/bin/env node
// Rejects private material in this public repository. Private overlays
// (editorial/, deploy/, real data, receipts, credentials) live in separate
// private repositories checked out on top of this tree and must never be
// committed here. Scans tracked files by default; `--staged` scans the index
// (pre-commit). Usage: node scripts/check-public-boundary.mjs [--staged] [dir]
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync, readlinkSync, statSync} from 'node:fs';
import {posix, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const PRIVATE_PATHS = [
  [/^(editorial|deploy|\.local|\.codex|theme-homepages)\//, 'private overlay directory'],
  [/^\.claude\/(?!launch\.json$)/, 'private agent state'],
  [/^(data|open-source|news)\.json$/, 'real data export'],
  [/(^|\/)\.env(\.(?!example$)[^/]*)?$/, 'environment file'],
  [/\.(sqlite|sqlite-wal|sqlite-shm|db|p12|pfx|key|pem)$/, 'database or key file'],
  [/(^|\/)(receipts?|\.receipts)\//, 'receipt directory'],
];
const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/, 'GitHub token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'API secret key'],
  [/\brssd_device_(?=[A-Za-z0-9_-]*[A-Z0-9])[A-Za-z0-9_-]{48}(?![A-Za-z0-9_-])/, 'RSSD device token'],
];
const PLACEHOLDER_HOMES = new Set(['a', 'example', 'user', 'username', 'you', 'me', 'name', 'demo', 'runner', 'someone', 'alice', 'bob', 'editor', 'shared', 'public']);
const HOME_PATH = /(?<![\w.\-/])(?:\/Users\/|\/home\/|[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2})([A-Za-z0-9._-]+)/g;
// SHA-256 of private host addresses, so the list itself discloses nothing.
const PRIVATE_HOST_HASHES = new Set([
  '1d62b9dafda687f895d5db57401a77d46c811400b5f23e3b4ae55189c4aa9bef',
  '76b42cfe53c50f45a54570e7af8608d08bc71ff8dfbc0868a14c14847c66ed31',
  'c16f16247b13b4b21bb15f52a7588cffac12cca0dcc21f8b817d37d0eeded640',
]);
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const SKIP_CONTENT = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|Cargo\.lock)$|\.min\.js$|(^|\/)draco\//;
const MAX_SCAN = 2 * 1024 * 1024;

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

export function contentProblems(text) {
  const found = [];
  for (const [pattern, label] of SECRET_PATTERNS) if (pattern.test(text)) found.push(label);
  for (const match of text.matchAll(HOME_PATH)) {
    if (!PLACEHOLDER_HOMES.has(match[1].toLowerCase())) { found.push('personal home path'); break; }
  }
  for (const match of text.matchAll(IPV4)) {
    if (PRIVATE_HOST_HASHES.has(sha256(match[0]))) { found.push('private host address'); break; }
  }
  return found;
}

export function pathProblem(path) {
  for (const [pattern, label] of PRIVATE_PATHS) if (pattern.test(path)) return label;
  return null;
}

export function linkProblem(path, target) {
  if (posix.isAbsolute(target)) return 'absolute symlink';
  const joined = posix.normalize(posix.join(posix.dirname(path), target));
  if (joined === '..' || joined.startsWith('../')) return 'symlink leaves the repository';
  const label = pathProblem(joined.endsWith('/') ? joined : joined + '/') || pathProblem(joined);
  return label ? `symlink into ${label}` : null;
}

export function checkBoundary(root, {staged = false} = {}) {
  const git = (args, options = {}) => execFileSync('git', args, {cwd: root, maxBuffer: 256 * 1024 * 1024, ...options});
  const entries = git(['ls-files', '-s', '-z'], {encoding: 'utf8'}).split('\0').filter(Boolean).map((line) => {
    const [meta, path] = line.split('\t');
    return {mode: meta.split(' ')[0], path};
  });
  const changed = staged
    ? new Set(git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'], {encoding: 'utf8'}).split('\0').filter(Boolean))
    : null;
  const read = (path) => staged ? git(['show', ':' + path]) : readFileSync(resolve(root, path));
  const problems = [];
  for (const {mode, path} of entries) {
    if (changed && !changed.has(path)) continue;
    if (mode === '160000') continue;
    const label = pathProblem(path);
    if (label) { problems.push(`${path}: ${label}`); continue; }
    if (mode === '120000') {
      const target = staged ? read(path).toString('utf8') : readlinkSync(resolve(root, path));
      const link = linkProblem(path, target);
      if (link) problems.push(`${path}: ${link}`);
      continue;
    }
    if (SKIP_CONTENT.test(path)) continue;
    if (!staged && statSync(resolve(root, path), {throwIfNoEntry: false})?.size > MAX_SCAN) continue;
    let data;
    try { data = read(path); } catch { continue; }
    if (data.length > MAX_SCAN || data.subarray(0, 8000).includes(0)) continue;
    for (const finding of contentProblems(data.toString('utf8'))) problems.push(`${path}: ${finding}`);
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const staged = args.includes('--staged');
  const root = resolve(args.find((arg) => !arg.startsWith('--')) || '.');
  const problems = checkBoundary(root, {staged});
  if (problems.length) {
    console.error('Private material must stay in the private overlay repositories:');
    for (const problem of problems) console.error('  ' + problem);
    process.exit(1);
  }
  console.log(`Public boundary OK (${staged ? 'staged changes' : 'tracked files'})`);
}
