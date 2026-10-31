import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {applySiteEnv} from './env.mjs';
import {createWebsitePublisher} from '../../../../scripts/website-publication.mjs';
import {publicationQueueSnapshot} from '../../../../scripts/publication-queue-status.mjs';
import {publicationDirectory} from '../../../../scripts/site-config.mjs';
import {sha} from '../../../../scripts/editorial-workspace.mjs';
import {resumePublicationQueue} from '../../../../scripts/publication-queue-recover.mjs';

export async function publicationJobs([siteKey,command='list',id,...options]){
 const {root,site,tokenFile}=applySiteEnv(siteKey),client=createWebsitePublisher({root,site,tokenFile});
 if(command==='list')return publicationQueueSnapshot({root,site,globalData:null});
 if(!id)throw Error('请指定原文章编号');
 if(command==='status')return client.status(id);
 if(command==='resume')return resumePublicationQueue({root,id,site});
 if(command==='enqueue'){
  if(!options.includes('--confirmed'))throw Error('请在核对原预览后使用 --confirmed 确认入队');
  const packet=JSON.parse(await readFile(join(publicationDirectory(root),id,'prepared.json'),'utf8'));
  return client.enqueue(id,{packetSha256:sha(JSON.stringify(packet)),intent:packet.intent||'publish'});
 }
 throw Error('Usage: headless jobs <site> list|status <articleId>|resume <articleId>|enqueue <articleId> --confirmed');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(await publicationJobs(process.argv.slice(2))));}catch(error){console.error(error.message);process.exitCode=1;}
}
