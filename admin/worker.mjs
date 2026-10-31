import {verifyLive} from './release-verification.mjs';
import {withPublicationLock} from './publication-lock.mjs';
import {SITE} from '../scripts/site-config.mjs';
import {buildSiteRelease} from '../scripts/site-pages.mjs';
import {readFile,writeFile,rm,rename,symlink,readlink,access} from 'node:fs/promises';
import {join,resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export {publicFiles} from '../web/themes/academic/render.mjs';
export async function buildRelease({job,source=root,target,previousRoot,now=new Date()}){
  return buildSiteRelease({job,source,target,previousRoot,now,site:SITE});
}
async function linkTarget(file){
  try{return await readlink(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function recoverLinkSwap(base){
  const current=join(base,'current'),backup=join(base,'.admin-previous');
  if(await linkTarget(backup)!==null){
    // An interrupted Windows rename must never leave the public root missing.
    // readlink also refuses to remove a real directory at either reserved path.
    if(await linkTarget(current)===null)await rename(backup,current);
    else await rm(backup);
  }
}
async function replaceCurrentLink(base,next){
  const current=join(base,'current');
  if(process.platform!=='win32'){await rename(next,current);return;}
  // Windows cannot rename over an existing directory symlink. Keep the old
  // link until the replacement is installed; recovery restores it after a crash.
  const backup=join(base,'.admin-previous'),previous=await linkTarget(current);
  if(previous!==null)await rename(current,backup);
  try{await rename(next,current);}
  catch(error){if(previous!==null)await rename(backup,current);throw error;}
  if(previous!==null)await rm(backup);
}
export async function activateRelease({base,release,verify}) {
  await recoverLinkSwap(base);
  const current=join(base,'current'),next=join(base,'.admin-next');let previous;
  try{previous=await readlink(current);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(await linkTarget(next)!==null)await rm(next);
  await symlink(release,next,'dir');await replaceCurrentLink(base,next);
  try {await verify();}
  catch(error){
    if(previous){await symlink(previous,next,'dir');await replaceCurrentLink(base,next);}else await rm(current);
    throw error;
  }
}
export async function recoverRelease({base,job,verify}) {
  await recoverLinkSwap(base);
  let current;try{current=JSON.parse(await readFile(join(base,'current/release.json'),'utf8'));}catch{}
  if(current?.jobId!==job.id||current.snapshotHash!==job.snapshot_hash)return {ok:false,error:'执行器重启；上次发布未完成，请检查后重试。'};
  try {await verify(current);return {ok:true,hash:job.snapshot_hash,release:current.release};}
  catch(error){
    if(!/^(?:\d{8}-\d{6}|admin-[a-zA-Z0-9-]+)$/.test(current.previousRelease||''))return {ok:false,error:'恢复校验失败，缺少可自动回退的版本标记，请联系维护人员。'};
    const previous=join(base,'releases',current.previousRelease);
    await access(join(previous,'index.html'));
    await activateRelease({base,release:previous,verify:async()=>{}});
    return {ok:false,error:'重启恢复时线上校验失败，已恢复上一版本。'+String(error.message).slice(0,800)};
  }
}
export async function runWorker({once=false}={}) {
  const api=process.env.SCHOLAY_ADMIN_API||'http://127.0.0.1:4180/manage/api';
  const token=process.env.SCHOLAY_WORKER_TOKEN;
  if(!token)throw new Error('SCHOLAY_WORKER_TOKEN is required');
  const base=process.env.SCHOLAY_PUBLIC_ROOT||'/opt/scholay-today-web';
  const origin=process.env.SCHOLAY_PUBLIC_ORIGIN||'https://today.scholay.com';
  const call=async(path,data={})=>{
    const response=await fetch(api+path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error('发布服务返回 '+response.status);return response.json();
  };
  let stopping=false;for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopping=true;});
  do {
    try {
      await withPublicationLock(process.env.SCHOLAY_PUBLICATION_LOCK,async()=>{
      const {job}=await call('/worker/claim',{reusePublishedAssets:!SITE.legacy});
      if(job){
        const release=join(base,'releases','admin-'+job.id),stage=join(base,'releases','.building-'+job.id);
        if(job.resume){
          const result=await recoverRelease({base,job,verify:manifest=>verifyLive(manifest,origin,process.env.SCHOLAY_VERIFY_LOCAL==='1')});
          await call('/worker/jobs/'+job.id+'/finish',result);
        }else{
          let manifest;const started=performance.now(),metrics={event:'publication',siteId:SITE.id,jobId:job.id};
          try{
            await rm(stage,{recursive:true,force:true});
            const buildStarted=performance.now();
            manifest=await buildRelease({job,target:stage,previousRoot:join(base,'current')});
            metrics.buildMs=Math.round(performance.now()-buildStarted);
            try{manifest.previousRelease=basename(await readlink(join(base,'current')));}catch(e){if(e.code!=='ENOENT')throw e;}
            await writeFile(join(stage,'release.json'),JSON.stringify(manifest));
            await rename(stage,release);
            await activateRelease({base,release,verify:async()=>{metrics.verification=await verifyLive(manifest,origin,process.env.SCHOLAY_VERIFY_LOCAL==='1');}});
          }catch(error){
            await rm(stage,{recursive:true,force:true});
            await call('/worker/jobs/'+job.id+'/finish',{ok:false,error:'构建或线上校验失败，保留上一版本。'+String(error.message).slice(0,1000)});
            console.error('Publish failed:',job.id);manifest=null;
            console.info(JSON.stringify({...metrics,status:'failed',totalMs:Math.round(performance.now()-started)}));
          }
          // A lost acknowledgement is reconciled against the active manifest next time.
          if(manifest){
            await call('/worker/jobs/'+job.id+'/finish',{ok:true,hash:job.snapshot_hash,release:manifest.release});
            console.info(JSON.stringify({...metrics,status:'success',totalMs:Math.round(performance.now()-started)}));
          }
        }
      }
      });
    }catch(error){console.error('Publisher:',error.message);}
    if(once||stopping)break;
    await new Promise(resolve=>setTimeout(resolve,5000));
  }while(!stopping);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await runWorker({once:process.argv.includes('--once')});
