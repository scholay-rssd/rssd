import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {publicationQueueSpaces,readPublicationQueueIdentity,publicationContinuation,continuationPending,continuationNeedsAttention} from './publication-queue-status.mjs';
import {kickPublicationQueue} from './publication-queue-worker.mjs';
import {validateSite,setSiteContext} from './site-config.mjs';

const optional=async file=>{try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}};
const dir=(root,site)=>site.legacy?join(root,'.local/today'):join(root,'.local/sites',site.id);
export async function publicationRecoveryCandidates(options={}){
 const candidates=[];
 for(const space of await publicationQueueSpaces(options)){
  const directory=dir(space.root,space.site),index=await optional(join(directory,'queue-index.json'));
  for(const id of Object.keys(index?.items||{})){
   if(!/^[a-z0-9][a-z0-9-]{2,99}$/.test(id))continue;
   const receipt=await optional(join(directory,id,'receipt.json')),q=receipt?.asyncQueue;
   if(!q||q.phase==='needs_review')continue;
   const continuation=await publicationContinuation(space.root,receipt),continuing=q.phase==='complete'&&continuationPending(continuation);
   if(continuing&&continuationNeedsAttention(continuation)&&!options.includeAttention)continue;
   const progressed=q.phase==='complete'&&continuationPending(q.continuation||receipt.publishingFlow)&&!continuationPending(continuation);
   if(q.phase==='complete'&&!continuing&&!progressed)continue;
   candidates.push({id,root:space.root,site:space.site});
  }
 }
 return {candidates};
}
export async function resumePublicationQueue({root,id,site},{kick=kickPublicationQueue}={}){
 site=validateSite(site);setSiteContext(site);
 const candidate=(await publicationRecoveryCandidates({root,site,globalData:null,includeAttention:true})).candidates.find(value=>value.id===id);
 if(!candidate)throw Error('原后台任务不存在或已结束');
 const directory=join(dir(root,site),id),receipt=await optional(join(directory,'receipt.json')),packet=await optional(join(directory,'prepared.json'));
 await readPublicationQueueIdentity({root,site,id,receipt,packet});
 await kick({root,site,id,tokenFile:process.env.SCHOLAY_TODAY_TOKEN_FILE});return {resumed:true,id};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{let input='';for await(const part of process.stdin){input+=part;if(input.length>65536)throw Error('恢复请求过大');if(input.endsWith('\n'))break;}
  const {method,params={}}=JSON.parse(input);
  const result=method==='candidates'?await publicationRecoveryCandidates():method==='resume'?await resumePublicationQueue(params):null;
  if(!result)throw Error('未知队列恢复操作');process.stdout.write(JSON.stringify(result));
 }catch(error){process.stderr.write(error.message);process.exitCode=1;}
}
