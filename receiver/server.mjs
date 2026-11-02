import Fastify from 'fastify';
import {readFile,open,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,join,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {timingSafeEqual} from 'node:crypto';
import {ReceiverStore} from './store.mjs';
import {BindingStore} from './trusted-store.mjs';
import {ReceiverMedia} from './media.mjs';
import {GuestbookMirror} from './guestbook.mjs';
import {CommunityMirror} from './community.mjs';
import {buildAndActivate} from './build.mjs';
import {withFileLock} from '../scripts/editorial-lock.mjs';
import {validateSite} from '../scripts/site-config.mjs';
import {sectionsForSite} from '../contracts/site-sections.mjs';
import p from '../contracts/rssd-v1.cjs';

async function loadBindingKeys(file,publicRoot){
  if(file===undefined)return Object.create(null);
  if(typeof file!=='string'||!isAbsolute(file))throw Error('Invalid binding key configuration');
  const path=resolve(file);if(path===publicRoot||path.startsWith(publicRoot+sep))throw Error('Invalid binding key configuration');
  let h;try{
    const realFile=await realpath(path);let realRoot;try{realRoot=await realpath(publicRoot);}catch(error){if(error.code!=='ENOENT')throw error;realRoot=publicRoot;}if(realFile===realRoot||realFile.startsWith(realRoot+sep))throw Error('Invalid binding key configuration');
    h=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);const st=await h.stat();
    if(!st.isFile()||(st.mode&0o077)!==0||st.size>65536||st.size<2||(st.uid!==0&&st.uid!==process.getuid()))throw Error('Invalid binding key configuration');
    const data=JSON.parse(await h.readFile({encoding:'utf8'}));if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length>16)throw Error('Invalid binding key configuration');
    const keys=Object.create(null);for(const [id,encoded] of Object.entries(data)){
      if(!/^[a-zA-Z0-9_-]{1,64}$/.test(id)||typeof encoded!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw Error('Invalid binding key configuration');
      const key=Buffer.from(encoded,'base64');if(key.length<32||key.length>64||key.toString('base64')!==encoded)throw Error('Invalid binding key configuration');keys[id]=key;
    }return keys;
  }catch{throw Error('Invalid binding key configuration');}finally{await h?.close();}
}
export async function createReceiver({config,build=buildAndActivate}) {
  const home=resolve(config.home),source=resolve(config.source),sites=new Map();
  for(const entry of config.sites){
    const site=validateSite(entry.site),tokenHash=p.text(entry.tokenHash,'tokenHash',64);
    if(!/^[a-f0-9]{64}$/.test(tokenHash)||sites.has(site.id))throw Error('Invalid receiver site credential or duplicate identity');
    site.sections=sectionsForSite(site);const base=resolve(entry.publicRoot);
    if(base===home||base===source)throw Error('Public release root must be separate from private state and source');
    const baselineBytes=entry.baseline?await readFile(entry.baseline,'utf8'):null;
    const bindingKeys=await loadBindingKeys(entry.bindingKeyFile,base);
    const bindingOrgId=entry.bindingKeyFile!==undefined?p.id(entry.bindingOrgId,'bindingOrgId'):null,bindingDestinationId=entry.bindingKeyFile!==undefined?p.id(entry.bindingDestinationId,'bindingDestinationId'):null;
    sites.set(site.id,{site,base,tokenHash,accepting:entry.accepting!==false,baselineSha256:baselineBytes?p.hash(baselineBytes):null,baseline:baselineBytes?JSON.parse(baselineBytes):{},store:new ReceiverStore(join(home,site.id,'receiver.sqlite'),site),media:new ReceiverMedia(join(home,site.id,'media'))});
    const configured=sites.get(site.id);configured.store.seedLegacyHeads(configured.baseline);
    configured.bindings=new BindingStore({db:configured.store.db,keys:bindingKeys,siteId:site.id,workspaceId:site.spaceId,orgId:bindingOrgId,destinationId:bindingDestinationId,lookupPacket:id=>{const r=configured.store.db.prepare('SELECT payload FROM requests WHERE id=?').get(id);return r?JSON.parse(r.payload):null;}});
    if(entry.guestbook)configured.guestbook=new GuestbookMirror({...entry.guestbook,siteId:site.id,directory:join(base,'services','guestbook')});
    if(entry.community)configured.community=new CommunityMirror({...entry.community,siteId:site.id,directory:join(base,'services','community')});
  }
  const app=Fastify({logger:false,bodyLimit:8*1024*1024});
  app.setErrorHandler((error,req,reply)=>reply.code(error.status||error.statusCode||500).send({code:error.code||'receiver_error',message:error.status||error.statusCode?error.message:'Receiver operation failed'}));
  app.addHook('preHandler',async req=>{
    const entry=sites.get(req.params.siteId);const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
    if(!entry||!timingSafeEqual(Buffer.from(entry.tokenHash),Buffer.from(p.hash(token))))p.fail('Invalid site credential',401,'unauthorized');
    req.rssdSite=entry;
  });
  app.get('/api/rssd-receiver/v1/sites/:siteId/status',async req=>({...req.rssdSite.store.status(),accepting:req.rssdSite.accepting,baselineSha256:req.rssdSite.baselineSha256}));
  app.get('/api/rssd-receiver/v1/sites/:siteId/heads/:workId/:locale',async req=>req.rssdSite.store.head(req.params.workId,req.params.locale));
  app.post('/api/rssd-receiver/v1/sites/:siteId/submissions',async req=>{if(!req.rssdSite.accepting)p.fail('Site intake is paused for handoff',409,'site_paused');return req.rssdSite.store.accept(req.body);});
  app.get('/api/rssd-receiver/v1/sites/:siteId/submissions/:id',async req=>req.rssdSite.store.receipt(req.params.id));
  app.post('/api/rssd-receiver/v1/sites/:siteId/submissions/:id/retry',async req=>req.rssdSite.store.retry(req.params.id));
  app.get('/api/rssd-receiver/v1/sites/:siteId/media/:sha256',async req=>req.rssdSite.media.status(req.params.sha256));
  app.post('/api/rssd-receiver/v1/sites/:siteId/media/:sha256',{bodyLimit:30*1024*1024},async req=>req.rssdSite.media.accept(req.params.sha256,req.body));
  app.post('/api/rssd-receiver/v1/sites/:siteId/translation-bindings',async req=>{if(!req.rssdSite.bindings)p.fail('Bindings unavailable',404);try{return req.rssdSite.bindings.accept(req.body);}catch(e){p.fail('Binding authentication or identity rejected',e.message==='unauthenticated'?401:409,'binding_rejected');}});
  app.post('/api/rssd-receiver/v1/sites/:siteId/translation-bindings/:id/retry',async req=>{const entry=req.rssdSite;if(!entry.bindings)p.fail('Bindings unavailable',404);try{if(req.body?.binding?.receiverRequestId!==req.params.id)p.fail('Binding identity mismatch',409);const age=entry.bindings.now()-req.body.issuedAt;if(!Number.isSafeInteger(req.body.issuedAt)||age< -30||age>300)p.fail('Retry authorization expired',409);if(!entry.store.db.prepare('SELECT 1 FROM bindings WHERE request_id=?').get(req.params.id))p.fail('Binding not previously accepted',409);const result=entry.bindings.accept(req.body);if(!result.replayed)p.fail('Binding not previously accepted',409);entry.store.db.prepare("UPDATE binding_refreshes SET state='queued',error=NULL WHERE request_id=? AND state='failed'").run(req.params.id);return {state:result.state,refresh:entry.store.db.prepare('SELECT state,release,error FROM binding_refreshes WHERE request_id=?').get(req.params.id)};}catch(e){p.fail('Binding authentication or identity rejected',e.message==='unauthenticated'?401:409,'binding_rejected');}});
  app.get('/api/rssd-receiver/v1/sites/:siteId/translation-bindings/:id',async req=>{const entry=req.rssdSite;if(!entry.bindings)p.fail('Bindings unavailable',404);const r=entry.store.db.prepare('SELECT payload FROM requests WHERE id=?').get(req.params.id);if(!r)p.fail('Request not found',404);const binding=entry.bindings.lookup(JSON.parse(r.payload)),refresh=entry.store.db.prepare('SELECT state,release,error FROM binding_refreshes WHERE request_id=?').get(req.params.id);return {...binding,refresh:refresh||null};});
  let running=false;
  async function tick(){
    if(running)return;running=true;
    try{
      await Promise.all([...sites.values()].filter(entry=>entry.guestbook).map(entry=>entry.guestbook.tick().catch(error=>console.error('Guestbook replica:',entry.site.id,error.message))));
      await Promise.all([...sites.values()].filter(entry=>entry.community).map(entry=>entry.community.tick().catch(error=>console.error('Community replica:',entry.site.id,error.message))));
      await withFileLock(join(home,'build.lock'),async()=>{
      // One build for the whole host at a time. A failed site does not prevent
      // the next site's turn; no ten long-lived render workers are required.
      for(const entry of sites.values()){
        const turn=value=>entry.store.db.prepare("INSERT INTO state(key,value) VALUES('bindingRefreshTurn',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(value);
        const row=entry.bindings&&entry.accepting?entry.store.db.prepare("SELECT b.request_id,b.binding_hash,b.state,r.payload,r.work_key,r.operation_sequence,r.state AS request_state FROM binding_refreshes b JOIN requests r ON r.id=b.request_id WHERE b.state IN ('queued','building') AND r.state='success' ORDER BY r.created LIMIT 1").get():null;
        const preferred=entry.store.db.prepare("SELECT value FROM state WHERE key='bindingRefreshTurn'").get()?.value==='1';
        const unfinished=Boolean(entry.store.db.prepare("SELECT 1 FROM requests WHERE state='building' LIMIT 1").get());
        if(unfinished||!row||!preferred){const job=entry.store.claim();if(job){try{entry.store.finish(job.id,await build({job,site:entry.site,base:entry.base,source,baseline:entry.baseline,media:entry.media,bindingStore:entry.bindings}));}catch(error){entry.store.fail(job.id,error.message);}turn('1');continue;}}
        if(!row)continue;
        const current=entry.store.db.prepare('SELECT payload FROM published WHERE work_key=?').get(row.work_key);
        if(!current||p.hash(JSON.parse(current.payload))!==p.hash(JSON.parse(row.payload))){entry.store.db.prepare("UPDATE binding_refreshes SET state='superseded' WHERE request_id=?").run(row.request_id);turn('0');continue;}
        const packet=JSON.parse(row.payload),published=entry.store.db.prepare('SELECT payload,previous_payload FROM published').all();
        const packets=published.map(x=>JSON.parse(x.payload)),previousPackets=published.flatMap(x=>x.previous_payload?[JSON.parse(x.previous_payload)]:[]);
        const refresh={id:row.request_id,packet,packets,previousPackets,operationSequence:row.operation_sequence,bindingRefresh:row.binding_hash,resume:row.state==='building'};
        entry.store.db.prepare("UPDATE binding_refreshes SET state='building' WHERE request_id=?").run(row.request_id);
        try{const receipt=await build({job:refresh,site:entry.site,base:entry.base,source,baseline:entry.baseline,media:entry.media,bindingStore:entry.bindings});entry.store.db.prepare("UPDATE binding_refreshes SET state='success',release=?,error=NULL WHERE request_id=?").run(receipt.release,row.request_id);}
        catch(error){entry.store.db.prepare("UPDATE binding_refreshes SET state='failed',error=? WHERE request_id=?").run(String(error.message).slice(0,1000),row.request_id);}
        turn('0');
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
