import {spawn} from 'node:child_process';
import {open,mkdir,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {withFileLock,lockOwnerAlive} from './editorial-lock.mjs';
import {publicationDirectory,setSiteContext,validateSite} from './site-config.mjs';
import {settlePublicationQueue,publicationContinuation,continuationPending,continuationNeedsAttention} from './publication-queue-status.mjs';

export async function kickPublicationQueue({root,site,tokenFile,id}){
 const directory=join(publicationDirectory(root),id);await mkdir(directory,{recursive:true,mode:0o700});
 try{const owner=JSON.parse(await readFile(join(directory,'queue-worker.lock'),'utf8'));if(await lockOwnerAlive(owner))return;}catch{}
 const log=await open(join(directory,'queue-worker.log'),'a',0o600);
 try{
  const env={...process.env,SCHOLAY_EDITORIAL_ROOT:root,SCHOLAY_SITE_JSON:JSON.stringify(site),SCHOLAY_SITE_ID:site.id,...(tokenFile?{SCHOLAY_TODAY_TOKEN_FILE:tokenFile}:{})};
  delete env.SCHOLAY_SITE_CONFIG;
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),root,id],{env,detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd]});
  child.on('error',()=>{});child.unref();
 }finally{await log.close();}
}

export async function runPublicationQueue({root,id,site,tokenFile,client,signal,budgetMs=15*60000,delayMs=5000,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 setSiteContext(site);
 const directory=join(publicationDirectory(root),id);
 return withFileLock(join(directory,'queue-worker.lock'),async()=>{
  const started=Date.now();let result;
  while(!signal?.aborted&&Date.now()-started<budgetMs){
   result=await client.runQueued(id);
   const receipt=result?.receipt;
   const q=receipt?.asyncQueue;
   const continuation=await publicationContinuation(root,receipt),continuing=continuationPending(continuation);
   if(!q||q.phase==='needs_review'||q.phase==='complete'&&(!continuing||continuationNeedsAttention(continuation))){
    if(q?.phase==='complete'&&!continuing)await settlePublicationQueue(root,site,id);
    break;
   }
   const wait=Math.max(q.phase==='complete'?30000:delayMs,Math.min(60000,(q.retryAt||0)-Date.now()));
   await sleep(wait);
  }
  return result;
 },{timeout:100});
}
// No top-level await: website-publication.mjs imports this module, so the entry
// must finish evaluating before that import can settle, or Node aborts (exit 13).
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))void (async()=>{
 try{
  const [root,id]=process.argv.slice(2),site=validateSite(JSON.parse(process.env.SCHOLAY_SITE_JSON||'null'));setSiteContext(site);
  const {createWebsitePublisher}=await import('./website-publication.mjs');
  const tokenFile=process.env.SCHOLAY_TODAY_TOKEN_FILE;
  await runPublicationQueue({root,id,site,tokenFile,client:createWebsitePublisher({root,site,tokenFile})});
 }catch(error){if(!error.message.startsWith('文件正在保存')){console.error('后台发布：'+error.message);process.exitCode=1;}}
})();
