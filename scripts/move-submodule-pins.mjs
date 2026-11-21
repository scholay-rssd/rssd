#!/usr/bin/env node
// Moves every submodule pin to the tip of that submodule's GitHub `main`
// (rule 4 of the root CLAUDE.md). The "Move submodule pins" workflow runs this
// on a schedule, so nobody has to open pin-only pull requests by hand.
// Like check-submodule-pins.mjs it needs no submodule checkout: URLs come from
// .gitmodules in the checked revision, and each main is cloned without trees
// or blobs, only to read the subjects of the commits a pin moves over.
// Usage: node scripts/move-submodule-pins.mjs [--apply] [--message <file>] [dir]
//   without --apply it only prints what would move;
//   --apply updates the index (no commit) and, when anything moved, writes a
//   commit message to <file>.
import {execFile} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {readGitmodules, readPins} from './check-submodule-pins.mjs';

const BRANCH = 'main';
const MAX_SUBJECTS = 20;
const run = promisify(execFile);
const git = (args, cwd) => run('git', args, {
  cwd,
  env: {...process.env, GIT_TERMINAL_PROMPT: '0'},
  maxBuffer: 64 * 1024 * 1024,
});

async function mainTip(url) {
  const {stdout} = await git(['ls-remote', url, `refs/heads/${BRANCH}`]);
  const sha = stdout.split(/\s/)[0];
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`no ${BRANCH} at ${url}`);
  return sha;
}

// "owner/name" for a GitHub URL, so a PR number in the message links to the
// submodule's repository rather than to rssd's own pull request of that number.
export function githubRepo(url) {
  return /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url)?.[1] ?? '';
}

async function subjects(url, from, to, repo) {
  await git(['clone', '--quiet', '--bare', '--filter=tree:0', '--single-branch', '--branch', BRANCH, '--no-tags', url, repo]);
  const known = await git(['cat-file', '-e', `${from}^{commit}`], repo).then(() => true, () => false);
  const range = known ? `${from}..${to}` : to;
  // First parent only: on a main that merges pull requests this lists one line
  // per merged PR, named by its title (the merge commit's body).
  const {stdout} = await git(['log', '--first-parent', '--format=%h%x1f%s%x1f%b%x1e', `-${MAX_SUBJECTS + 1}`, range], repo);
  const lines = stdout.split('\x1e').map((record) => record.trim()).filter(Boolean).map((record) => {
    const [hash, subject, body = ''] = record.split('\x1f');
    const merged = /^Merge pull request (#\d+)/.exec(subject);
    const title = body.trim().split('\n')[0];
    return merged && title ? `${hash} ${githubRepo(url)}${merged[1]} ${title}` : `${hash} ${subject}`;
  });
  return lines.length > MAX_SUBJECTS ? [...lines.slice(0, MAX_SUBJECTS), '…'] : lines;
}

// Returns one {path, from, to, log} per pin that is behind its submodule's
// main; an empty array means every pin is already at the tip.
export async function planPinMoves(root, {rev = 'HEAD'} = {}) {
  const [modules, pins] = await Promise.all([readGitmodules(root, rev), readPins(root, rev)]);
  const scratch = mkdtempSync(join(tmpdir(), 'rssd-move-pins-'));
  try {
    const moves = await Promise.all(pins.map(async ({path, sha}, index) => {
      const url = modules.get(path)?.url;
      if (!url) throw new Error(`${path} has no url in .gitmodules`);
      const tip = await mainTip(url);
      if (tip === sha) return null;
      return {path, from: sha, to: tip, log: await subjects(url, sha, tip, join(scratch, String(index)))};
    }));
    return moves.filter(Boolean);
  } finally {
    rmSync(scratch, {recursive: true, force: true});
  }
}

const listing = (paths) => paths.length === 1 ? paths[0]
  : `${paths.slice(0, -1).join(', ')} and ${paths.at(-1)}`;

export function commitMessage(moves) {
  const names = moves.map(({path}) => path.split('/').pop());
  const head = `Move the ${listing(names)} ${moves.length === 1 ? 'pin' : 'pins'} to ${moves.length === 1 ? 'its main' : 'their mains'}`;
  const body = moves.map(({path, from, to, log}) =>
    [`${path} ${from.slice(0, 7)}..${to.slice(0, 7)}`, ...log.map((line) => `  ${line}`)].join('\n'));
  return `${head}\n\n${body.join('\n\n')}\n`;
}

export async function applyPinMoves(root, moves) {
  for (const {path, to} of moves) await git(['update-index', '--cacheinfo', `160000,${to},${path}`], root);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  let apply = false;
  let message = null;
  let dir = '.';
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--apply') apply = true;
    else if (args[index] === '--message') message = args[++index];
    else dir = args[index];
  }
  const root = resolve(dir);
  const moves = await planPinMoves(root);
  if (!moves.length) {
    console.log(`Every submodule pin is at its ${BRANCH}`);
    process.exit(0);
  }
  const text = commitMessage(moves);
  console.log(text);
  if (apply) {
    await applyPinMoves(root, moves);
    if (message) writeFileSync(message, text);
  }
}
