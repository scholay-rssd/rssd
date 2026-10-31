// The native runtime injects the website vault token into this child process.
// Legacy file access is read-only compatibility for an unmanaged workspace.
import {constants} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import {join} from 'node:path';
import {configuredWorkspace} from '../../../scripts/editorial-location.mjs';
import {publicationDirectory} from '../../../scripts/site-config.mjs';
const validToken = value => typeof value === 'string' && /^[\x21-\x7e]{16,2048}$/.test(value);
const privateFile = stat => stat.isFile() && stat.size > 0 && stat.size <= 2048 && (stat.mode & 0o777) === 0o600;

export async function resolveLabelCloudCredential({env=process.env,workspace=configuredWorkspace}={}) {
  // A supplied but invalid token must not silently select another identity.
  if (env.SCHOLAY_TODAY_TOKEN) return validToken(env.SCHOLAY_TODAY_TOKEN) ? env.SCHOLAY_TODAY_TOKEN : null;
  if (env.SCHOLAY_REQUIRE_VAULT === '1') return null;
  let file;
  try { file = env.SCHOLAY_TODAY_TOKEN_FILE || join(publicationDirectory(await workspace()), 'publish-token'); }
  catch { return null; }
  let handle;
  try {
    // Check both the path and opened descriptor; never follow a token symlink
    // or block on a replaced FIFO. Bounds also apply if a file grows mid-read.
    if (!privateFile(await lstat(file))) return null;
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
    if (!privateFile(await handle.stat())) return null;
    const buffer = Buffer.alloc(2049);
    const {bytesRead} = await handle.read(buffer, 0, buffer.length, 0);
    const after = await handle.stat();
    if (!privateFile(after) || bytesRead !== after.size) return null;
    const token = buffer.subarray(0, bytesRead).toString('utf8').trim();
    return validToken(token) ? token : null;
  } catch { return null; }
  finally { if (handle) await handle.close().catch(() => {}); }
}
