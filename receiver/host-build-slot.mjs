import {join} from 'node:path';
import {withFileLock} from '../scripts/editorial-lock.mjs';

/**
 * Host build coordination for rssd-receiver@.
 *
 * Production is one process per site sharing home/build.lock. Concurrency >1
 * (slots + a reclaimable build.lock fence) is NOT deployed: reclaiming the
 * fence after "no live slots" races with a new slotted holder, and a protocol
 * file cannot bind legacy exclusive builders that only know build.lock.
 * Automatic dead-lock unlink is also not an atomic compare-and-delete.
 *
 * Until a kernel-mediated scheme (e.g. flock held for the whole build) or an
 * explicit stop-the-world drain cutover is proven, only exclusive n=1 is safe.
 */
export const BUILD_SITE_CONCURRENCY_DEFAULT=1;
export const HOST_BUILD_PROTOCOL_VERSION=1;

export function resolveBuildSiteConcurrency(value=process.env.RSSD_RECEIVER_BUILD_SITE_CONCURRENCY){
  if(value===undefined||value===null||value==='')return BUILD_SITE_CONCURRENCY_DEFAULT;
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<1||n>16)throw Error('Invalid build site concurrency');
  return n;
}

export async function withHostBuildSlot(home,concurrency,work,{timeout=100}={}){
  const n=resolveBuildSiteConcurrency(concurrency);
  if(n!==1){
    throw Error('Host build concurrency >1 is not deployed: no atomic cross-process coordination with legacy build.lock');
  }
  return withFileLock(join(home,'build.lock'),work,{timeout});
}

export async function hostBuildBusy(home){
  const {access}=await import('node:fs/promises');
  try{await access(join(home,'build.lock'));return true;}catch{return false;}
}
