import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import protocol from '../contracts/rssd-v1.cjs';
import {withFileLock} from './editorial-lock.mjs';
import {CenterOutbox,writeCenterJson} from './rssd-center-client.mjs';

const read=async path=>{try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}};
const save=writeCenterJson;
export async function runProductionTurn({client,home,producer,agentId,workspaceIds,sectionIds=[],demandId,resume=false,signal,onEvent=()=>{}}){
  await mkdir(home,{recursive:true,mode:0o700});
  return withFileLock(join(home,'worker.lock'),async()=>{
    const outbox=new CenterOutbox({directory:join(home,'outbox'),client});
    await outbox.flush();
    const activeFile=join(home,'active-claim.json');let claim,offline=false;
    try{claim=await client.activeClaim();}
    catch(error){
      if(error.status>=400&&error.status<500&&![408,429].includes(error.status))throw error;
      const cached=await read(activeFile);if(!cached||cached.origin!==client.origin||!cached.claim)throw error;
      claim=cached.claim;offline=true;
    }
    if(claim?.state==='blocked'){
      if(!resume)return {state:'blocked',demandId:claim.id,message:claim.payload.lastError};
      if(!offline){await client.changeDemand(claim.id,{action:'resume',claimToken:claim.claimToken});claim=await client.activeClaim();}
    }
    if(claim&&(!workspaceIds.includes(claim.workspaceId)||sectionIds.length&&!sectionIds.includes(claim.sectionId)))throw Error('The active demand is outside the selected scope; resume that scope or release it explicitly');
    if(!claim){await save(activeFile,{origin:client.origin,claim:null});claim=await client.claim({workspaceIds,sectionIds,...(demandId?{demandId}:{})});}
    if(!claim){await client.heartbeat({state:'idle',agentId});return {state:'idle'};}
    const directory=join(home,'jobs',protocol.hash(claim.id+':'+claim.generation));await mkdir(directory,{recursive:true,mode:0o700});
    const claimFile=join(directory,'claim.json');await save(claimFile,claim);
    const workId=claim.payload.workId||claim.payload.source?.workId||'work-'+protocol.hash(claim.id).slice(0,32);
    const contextFile=join(directory,'context.json');
    let context=await read(contextFile);
    if(!context){
      let work=null;try{work=await client.work(workId);}catch(error){if(error.status!==404)throw error;}
      context={work,baseRevisions:Object.fromEntries((work?.editions||[]).map(e=>[e.locale,e.revision]))};
      if(claim.payload.source){const source=claim.payload.source;context.source=await client.request('/works/'+encodeURIComponent(source.workId)+'/editions/'+source.locale+'/'+source.revision);}
      await save(contextFile,context);
    }
    await save(activeFile,{origin:client.origin,claim});
    const heartbeat=()=>client.heartbeat({state:'running',agentId,message:claim.title}).catch(()=>{});
    await heartbeat();const timer=setInterval(heartbeat,30000);timer.unref?.();
    try{
      const results=[];
      const locales=[...claim.payload.requiredLocales].sort((a,b)=>a===b?0:a==='zh-CN'?-1:1);
      for(const locale of locales){
        if(claim.payload.submittedLocales?.includes(locale))continue;
        if(signal?.aborted)throw Error('Work was paused on this device');
        const packetFile=join(directory,locale+'.packet.json');let packet=await read(packetFile);
        if(!packet){
          onEvent({type:'producing',demandId:claim.id,locale,agentId});
          let translationOf=null,source=context.source;
          if(claim.kind==='translate')translationOf=claim.payload.source;
          else if(locale==='en'&&claim.payload.requiredLocales.includes('zh-CN')){
            const chinese=await read(join(directory,'zh-CN.packet.json'));
            const old=context.work?.editions.find(e=>e.locale==='zh-CN');
            if(chinese){source={payload:chinese.editions[0]};translationOf={workId,locale:'zh-CN',revision:chinese.baseRevisions['zh-CN']+1};}
            else if(old){source=old;translationOf={workId,locale:'zh-CN',revision:old.revision};}
          }
          const output=await producer({claim,locale,workId,source,directory,agentId,signal,onEvent});
          await save(join(directory,locale+'.result.json'),output);
          packet=protocol.submission({requestId:randomUUID(),workId,workspaceId:claim.workspaceId,sectionId:claim.sectionId,
            demandId:claim.id,claimToken:claim.claimToken,baseRevisions:{[locale]:context.baseRevisions[locale]||0},
            editions:[{...output,locale,translationOf}]});
          // Durable packet exists before the first request is made.
          await save(packetFile,packet);
        }
        await outbox.enqueue(packet);await outbox.flush();
        const result=await outbox.flushOne(packet.requestId,{retry:resume});results.push(result);
        onEvent({type:result.state,demandId:claim.id,locale,requestId:packet.requestId});
        if(result.state==='needs_attention')throw Error(result.error?.message||'Submission needs attention');
        // Continue producing the remaining language even if the center goes offline.
      }
      const pending=results.some(r=>r.state==='pending');
      await client.heartbeat({state:pending?'blocked':'idle',agentId,message:pending?'Content is retained locally; waiting for the center':''}).catch(()=>{});
      return {state:pending?'pending':'accepted',demandId:claim.id,workId,submissions:results.map(r=>({requestId:r.requestId,state:r.state,receipt:r.receipt}))};
    }catch(error){
      await client.changeDemand(claim.id,{action:'blocked',claimToken:claim.claimToken,message:String(error.message).slice(0,2000)}).catch(()=>{});
      await client.heartbeat({state:'blocked',agentId,message:String(error.message).slice(0,2000)}).catch(()=>{});
      await save(join(directory,'failure.json'),{message:error.message,at:new Date().toISOString()});
      throw error;
    }finally{clearInterval(timer);}
  },{timeout:100});
}
