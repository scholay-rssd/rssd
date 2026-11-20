#!/usr/bin/env node
// Enforces rule 4 of the root CLAUDE.md: every submodule pin must be a commit
// on that submodule's GitHub `main`. Submodules and their URLs come from
// .gitmodules as committed in the checked revision, never from
// `git config submodule.<name>.url`, which may point at a local checkout.
// Each repository's `main` is cloned without trees or blobs into a temporary
// directory, so no submodule checkout is needed.
// Usage: node scripts/check-submodule-pins.mjs [--rev <rev>] [dir]
import {execFile} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';

const BRANCH = 'main';
const NOT_FOUND = /not our ref|couldn't find remote ref|no such remote ref|unadvertised object/i;
const run = promisify(execFile);

// GIT_NO_LAZY_FETCH keeps a missing commit missing in the partial clone
// instead of fetching it behind our back; older git ignores it harmlessly.
const git = (args, cwd) => run('git', args, {
  cwd,
  env: {...process.env, GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1'},
  maxBuffer: 64 * 1024 * 1024,
});
const succeeds = (args, cwd) => git(args, cwd).then(() => true, () => false);
const lastLine = (error) => String(error.stderr || error.message).trim().split('\n').pop();

export async function readGitmodules(root, rev) {
  if (!(await succeeds(['cat-file', '-e', `${rev}:.gitmodules`], root))) return new Map();
  const {stdout} = await git(['config', '--blob', `${rev}:.gitmodules`, '-z', '--get-regexp', '^submodule\\..*\\.(path|url)$'], root)
    .catch((error) => (error.code === 1 ? {stdout: ''} : Promise.reject(error)));
  const byName = new Map();
  for (const record of stdout.split('\0').filter(Boolean)) {
    const [key, value = ''] = record.split(/\n(.*)/s);
    const name = key.slice('submodule.'.length, key.lastIndexOf('.'));
    const field = key.slice(key.lastIndexOf('.') + 1);
    byName.set(name, {...byName.get(name), name, [field]: value});
  }
  return new Map([...byName.values()].filter((entry) => entry.path).map((entry) => [entry.path, entry]));
}

export async function readPins(root, rev) {
  const {stdout} = await git(['ls-tree', '-r', '-z', '--full-tree', rev], root);
  return stdout.split('\0').filter((line) => line.startsWith('160000 ')).map((line) => {
    const [meta, path] = line.split('\t');
    return {path, sha: meta.split(' ')[2]};
  });
}

async function checkPin({path, sha, url}, repo) {
  try {
    await git(['clone', '--quiet', '--bare', '--filter=tree:0', '--single-branch', '--branch', BRANCH, '--no-tags', url, repo]);
  } catch (error) {
    return `cannot fetch ${BRANCH} from ${url}: ${lastLine(error)}`;
  }
  if (!(await succeeds(['cat-file', '-e', `${sha}^{commit}`], repo))) {
    try {
      await git(['fetch', '--quiet', '--no-tags', 'origin', sha], repo);
    } catch (error) {
      return NOT_FOUND.test(String(error.stderr)) ? 'not on GitHub' : `cannot fetch it from ${url}: ${lastLine(error)}`;
    }
  }
  return (await succeeds(['merge-base', '--is-ancestor', sha, BRANCH], repo)) ? null : `not on ${BRANCH}`;
}

// Returns one {path, sha, problem} per bad pin; an empty array means every pin
// is on its submodule's main.
export async function checkSubmodulePins(root, {rev = 'HEAD'} = {}) {
  const [modules, pins] = await Promise.all([readGitmodules(root, rev), readPins(root, rev)]);
  const scratch = mkdtempSync(join(tmpdir(), 'rssd-pins-'));
  try {
    const results = await Promise.all(pins.map(async (pin, index) => {
      const url = modules.get(pin.path)?.url;
      const problem = !modules.has(pin.path) ? 'not in .gitmodules'
        : !url ? 'no url in .gitmodules'
        : await checkPin({...pin, url}, join(scratch, String(index)));
      return problem && {...pin, problem};
    }));
    return results.filter(Boolean);
  } finally {
    rmSync(scratch, {recursive: true, force: true});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  let rev = 'HEAD';
  let dir = '.';
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--rev') rev = args[++index];
    else dir = args[index];
  }
  const problems = await checkSubmodulePins(resolve(dir), {rev});
  if (problems.length) {
    console.error(`Submodule pins must be commits on the submodule's GitHub ${BRANCH} (CLAUDE.md rule 4).`);
    console.error('Merge the submodule PR first, then pin the merged commit:');
    for (const {path, sha, problem} of problems) console.error(`  ${path} ${sha}: ${problem}`);
    process.exit(1);
  }
  console.log(`Submodule pins OK (${rev}): every pin is on its submodule's ${BRANCH}`);
}
