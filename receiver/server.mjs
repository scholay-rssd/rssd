import Fastify from 'fastify';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {timingSafeEqual} from 'node:crypto';
import {ReceiverStore} from './store.mjs';
import {ReceiverMedia} from './media.mjs';
import {buildAndActivate} from './build.mjs';
import {withFileLock} from '../scripts/editorial-lock.mjs';
import {validateSite} from '../scripts/site-config.mjs';
import {sectionsForSite} from '../contracts/site-sections.mjs';
import p from '../contracts/rssd-v1.cjs';

export async function createReceiver({config,build=buildAndActivate}) {
  const home=resolve(config.home),source=resolve(config.source),sites=new Map();
  for(const entry of config.sites){
    const site=validateSite(entry.site),tokenHash=p.text(entry.tokenHash,'tokenHash',64);
    if(!/^[a-f0-9]{64}$/.test(tokenHash)||sites.has(site.id))throw Error('Invalid receiver site credential or duplicate identity');
    site.sections=sectionsForSite(site);const base=resolve(entry.publicRoot);
    if(base===home||base===source)throw Error('Public release root must be separate from private state and source');
    const baselineBytes=entry.baseline?await readFile(entry.baseline,'utf8'):null;
    sites.set(site.id,{site,base,tokenHash,accepting:entry.accepting!==false,baselineSha256:baselineBytes?p.hash(baselineBytes):null,baseline:baselineBytes?JSON.parse(baselineBytes):{},store:new ReceiverStore(join(home,site.id,'receiver.sqlite'),site),media:new ReceiverMedia(join(home,site.id,'media'))});
    const configured=sites.get(site.id);configured.store.seedLegacyHeads(configured.baseline);
  }
  const app=Fastify({logger:false,bodyLimit:8*1024*1024});
  app.setErrorHandler((error,req,reply)=>reply.code(error.status||error.statusCode||500).send({code:error.code||'receiver_error',message:error.status||error.statusCode?error.message:'Receiver operation failed'}));
  app.addHook('preHandler',async req=>{
    const entry=sites.get(req.params.siteId);const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
    if(!entry||!timingSafeEqual(Buffer.from(entry.tokenHash),Buffer.from(p.hash(token))))p.fail('Invalid site credential',401,'unauthorized');
    req.rssdSite=entry;
  });
  app.get('/api/rssd-receiver/v1/sites/:siteId/status',async req=>({...req.rssdSite.store.status(),accepting:req.rssdSite.accepting,baselineSha256:req.rssdSite.baselineSha256}));
  app.post('/api/rssd-receiver/v1/sites/:siteId/submissions',async req=>{if(!req.rssdSite.accepting)p.fail('Site intake is paused for handoff',409,'site_paused');return req.rssdSite.store.accept(req.body);});
  app.get('/api/rssd-receiver/v1/sites/:siteId/submissions/:id',async req=>req.rssdSite.store.receipt(req.params.id));
  app.post('/api/rssd-receiver/v1/sites/:siteId/submissions/:id/retry',async req=>req.rssdSite.store.retry(req.params.id));
  app.get('/api/rssd-receiver/v1/sites/:siteId/media/:sha256',async req=>req.rssdSite.media.status(req.params.sha256));
  app.post('/api/rssd-receiver/v1/sites/:siteId/media/:sha256',{bodyLimit:30*1024*1024},async req=>req.rssdSite.media.accept(req.params.sha256,req.body));
  let running=false;
  async function tick(){
    if(running)return;running=true;
    try{await withFileLock(join(home,'build.lock'),async()=>{
      // One build for the whole host at a time. A failed site does not prevent
      // the next site's turn; no ten long-lived render workers are required.
      for(const entry of sites.values()){
        const job=entry.store.claim();if(!job)continue;
        try{entry.store.finish(job.id,await build({job,site:entry.site,base:entry.base,source,baseline:entry.baseline,media:entry.media}));}
        catch(error){entry.store.fail(job.id,error.message);}
      }
    },{timeout:100});}finally{running=false;}
  }
  app.addHook('onClose',async()=>{for(const entry of sites.values())entry.store.close();});
  return {app,tick,sites};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.env.RSSD_RECEIVER_CONFIG)throw Error('RSSD_RECEIVER_CONFIG is required');
  const config=JSON.parse(await readFile(process.env.RSSD_RECEIVER_CONFIG,'utf8')),receiver=await createReceiver({config});
  await receiver.app.listen({host:'127.0.0.1',port:config.port||4190});
  let stopping=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;});
  while(!stopping){await receiver.tick().catch(e=>console.error('Receiver:',e.message));if(!stopping)await new Promise(r=>setTimeout(r,3000));}
  await receiver.app.close();
}
