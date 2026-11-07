import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {saveCenterConnection,loadCenterConnection,CenterOutbox} from '../../../../scripts/rssd-center-client.mjs';
import {completeStoredEdition} from '../../../../scripts/rssd-device-media.mjs';
import {runProductionTurn} from '../../../../scripts/rssd-production-worker.mjs';
import {produceCenterEdition} from '../center-producer.mjs';
import {deviceLogin} from '../../../../scripts/rssd-device-login.mjs';
import {enqueueStoreOnlyTranslate,enqueueTranslateContinuation,requireStoreOnlyContract,storeOnlyClaimBody} from '../../../../scripts/rssd-translate-continuation.mjs';

import {centerHome} from '../../runtime/center-home.mjs';
export {centerHome};
export const CENTER_WORK_PRODUCER=produceCenterEdition;
export async function centerCommand(argv,{emit=value=>console.log(JSON.stringify(value))}={}){
  const [command,...args]=argv,home=centerHome();
  const flag=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
  const values=name=>args.flatMap((value,i)=>value===name?[args[i+1]]:[]).filter(Boolean);
  if(command==='login'){
    if(!args[0])throw Error('Usage: center login <https://center> [--name device-name]');
    const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
    try{const granted=await deviceLogin({origin:args[0],name:flag('--name')||'RSSD Linux',emit,signal:controller.signal});const result=await saveCenterConnection(home,{origin:args[0],token:granted.token});emit({state:'connected',...result});return result;}
    finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
  }
  if(command==='connect'){
    const tokenFile=flag('--token-file');if(!args[0]||!tokenFile)throw Error('Usage: center connect <https://center> --token-file <private-file>');
    const result=await saveCenterConnection(home,{origin:args[0],token:(await readFile(tokenFile,'utf8')).trim()});emit(result);return result;
  }
  if(!command||command==='help'||command==='--help'){
    emit({commands:['login <origin> [--name device-name]','connect <origin> --token-file <file>','status','registry','demands [--workspace id]','store-en --work workId [--revision n]','enqueue-translate --work workId [--revision n]','claim --workspace id [--section id] [--id demandId] [--store-only]','submit <packet.json> [--store-only]','recover [requestId] [--retry]','retry-website --workspace id --request-key key --job-id id','work --agent id --workspace id [--section id] [--id demandId] [--once] [--resume] [--store-only]']});return;
  }
  const {client,identity}=await loadCenterConnection(home),outbox=new CenterOutbox({directory:join(home,'outbox'),client});
  if(command==='status'){const entries=await outbox.list();const result={origin:client.origin,identity,outbox:entries.map(e=>({requestId:e.requestId,workId:e.packet.workId,state:e.state,error:e.error,receipt:e.receipt}))};emit(result);return result;}
  if(command==='registry'){const result=await client.registry();emit(result);return result;}
  if(command==='demands'){const result=await client.demands({workspaceId:flag('--workspace')});emit(result);return result;}
  if(command==='enqueue-translate'){
    if(args.includes('--store-only'))throw Error('enqueue-translate may publish; use center store-en for one existing work stored as English only');
    const workIds=values('--work');if(workIds.length!==1)throw Error('Usage: center enqueue-translate --work <workId> [--revision n]');
    const revisionFlag=flag('--revision');
    const result=await enqueueTranslateContinuation({client,workId:workIds[0],...(revisionFlag===undefined?{}:{revision:Number(revisionFlag)})});
    emit(result);return result;
  }
  if(command==='store-en'){
    const workIds=values('--work');if(workIds.length!==1)throw Error('Usage: center store-en --work <existingWorkId> [--revision n]');
    const revisionFlag=flag('--revision');
    const result=await enqueueStoreOnlyTranslate({client,workId:workIds[0],...(revisionFlag===undefined?{}:{revision:Number(revisionFlag)})});
    emit(result);return result;
  }
  if(command==='claim'){
    const storeOnly=args.includes('--store-only');
    if(storeOnly)await requireStoreOnlyContract(client);
    const result=await client.claim(storeOnly?storeOnlyClaimBody({workspaceIds:values('--workspace'),sectionIds:values('--section'),demandId:flag('--id')}):{workspaceIds:values('--workspace'),sectionIds:values('--section'),demandId:flag('--id')});
    emit(result);return result;
  }
  if(command==='submit'){
    const packetFile=args.find(value=>value&&!value.startsWith('--'));if(!packetFile)throw Error('Provide a complete submission JSON file');
    const storeOnly=args.includes('--store-only');
    if(storeOnly)await requireStoreOnlyContract(client);
    const packet=await completeStoredEdition({packet:JSON.parse(await readFile(packetFile,'utf8')),home,directory:home,client});
    const entry=await outbox.enqueue(packet,{storeOnly});const result=await outbox.flushOne(entry.requestId);emit(result);return result;
  }
  if(command==='recover'){const result=args[0]&&!args[0].startsWith('--')?await outbox.flushOne(args[0],{retry:args.includes('--retry')}):await outbox.flush();emit(result);return result;}
  if(command==='retry-website'){
    const workspaceId=flag('--workspace'),requestKey=flag('--request-key'),jobId=flag('--job-id');
    if(!workspaceId||!requestKey||!jobId)throw Error('Usage: center retry-website --workspace id --request-key key --job-id id');
    const result=await client.editorialRetry(workspaceId,requestKey,{jobId});emit(result);return result;
  }
  if(command!=='work')throw Error('Unknown center command');
  const agentId=flag('--agent'),workspaceIds=values('--workspace'),storeOnly=args.includes('--store-only');
  if(!agentId||!workspaceIds.length)throw Error('Select --agent and at least one --workspace before starting work');
  if(storeOnly&&!flag('--id'))throw Error('Usage: center work --agent <id> --workspace <id> --id <demandId> --once --store-only');
  const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
  let resume=args.includes('--resume');
  try{
    do{
      const result=await runProductionTurn({client,home,agentId,workspaceIds,sectionIds:values('--section'),demandId:flag('--id'),resume,storeOnly,signal:controller.signal,producer:CENTER_WORK_PRODUCER,onEvent:event=>{if(event.type!=='agent_output')emit(event);}});
      resume=false;
      emit(result);if(args.includes('--once')||['blocked','pending'].includes(result.state))return result;
      if(result.state==='idle')await new Promise(resolve=>{const done=()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,15000);controller.signal.addEventListener('abort',done,{once:true});});
    }while(!controller.signal.aborted);
  }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))centerCommand(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
