// Private data that replaces the synthetic public corpus for manual exports and
// corpus tests. Public checkouts have no overlay and keep the synthetic files;
// application builds never read it.
import {existsSync, readdirSync, statSync} from 'node:fs';
import {isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const CALENDAR_DIR = 'desktop/src/calendar';
export const SITE_SEEDS_DIR = 'sites/seeds';

export function dataOverlayRoot(repoRoot = REPO_ROOT, env = process.env) {
  const configured = env.RSSD_DATA_DIR;
  if (configured) {
    if (!isAbsolute(configured)) throw Error('RSSD_DATA_DIR must be an absolute path');
    if (!existsSync(configured) || !statSync(configured).isDirectory()) throw Error('RSSD_DATA_DIR is not a directory: ' + configured);
    return configured;
  }
  const conventional = join(repoRoot, 'deploy', 'data');
  return existsSync(conventional) && statSync(conventional).isDirectory() ? conventional : null;
}

// Whole-directory replacement: mixing private and synthetic files would make a
// corpus look complete when it is not.
export function overlayDirectory(relativeDir, {repoRoot = REPO_ROOT, env = process.env} = {}) {
  const publicDir = join(repoRoot, relativeDir);
  const root = dataOverlayRoot(repoRoot, env);
  const candidate = root && join(root, relativeDir);
  if (!candidate || !existsSync(candidate)) return {directory: publicDir, overlay: false};
  const missing = readdirSync(publicDir).filter((name) => name.endsWith('.json') && !existsSync(join(candidate, name)));
  if (missing.length) throw Error(`${candidate} is missing ${missing.join(', ')}`);
  return {directory: candidate, overlay: true};
}
