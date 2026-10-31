import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {saveCenterConnection,loadCenterConnection,CenterOutbox} from '../../../../scripts/rssd-center-client.mjs';
import {runProductionTurn} from '../../../../scripts/rssd-production-worker.mjs';
import {produceCenterEdition} from '../center-producer.mjs';

export function centerHome(){return resolve(process.env.RSSD_CENTER_HOME||join(process.env.SCHOLAY_GLOBAL_APP_DATA||process.env.SCHOLAY_AGENT_HOME||join(homedir(),'.config/scholay-today'),'center'));}
export async function centerCommand(argv,{emit=value=>console.log(JSON.stringify(value))}={}){
  const [command,...args]=argv,home=centerHome();
  const flag=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
  const values=name=>args.flatMap((value,i)=>value===name?[args[i+1]]:[]).filter(Boolean);
  if(command==='connect'){
    const tokenFile=flag('--token-file');if(!args[0]||!tokenFile)throw Error('Usage: center connect <https://center> --token-file <private-file>');
    const result=await saveCenterConnection(home,{origin:args[0],token:(await readFile(tokenFile,'utf8')).trim()});emit(result);return result;
  }
  if(!command||command==='help'||command==='--help'){
    emit({commands:['connect <origin> --token-file <file>','status','registry','demands [--workspace id]','claim --workspace id [--section id] [--id demandId]','submit <packet.json>','recover [requestId] [--retry]','work --agent id --workspace id [--section id] [--once] [--resume]']});return;
  }
  const {client,identity}=await loadCenterConnection(home),outbox=new CenterOutbox({directory:join(home,'outbox'),client});
  if(command==='status'){const entries=await outbox.list();const result={origin:client.origin,identity,outbox:entries.map(e=>({requestId:e.requestId,workId:e.packet.workId,state:e.state,error:e.error,receipt:e.receipt}))};emit(result);return result;}
  if(command==='registry'){const result=await client.registry();emit(result);return result;}
  if(command==='demands'){const result=await client.demands({workspaceId:flag('--workspace')});emit(result);return result;}
  if(command==='claim'){const result=await client.claim({workspaceIds:values('--workspace'),sectionIds:values('--section'),demandId:flag('--id')});emit(result);return result;}
  if(command==='submit'){
    if(!args[0])throw Error('Provide a complete submission JSON file');
    const entry=await outbox.enqueue(JSON.parse(await readFile(args[0],'utf8'))),result=await outbox.flushOne(entry.requestId);emit(result);return result;
  }
  if(command==='recover'){const result=args[0]&&!args[0].startsWith('--')?await outbox.flushOne(args[0],{retry:args.includes('--retry')}):await outbox.flush();emit(result);return result;}
  if(command!=='work')throw Error('Unknown center command');
  const agentId=flag('--agent'),workspaceIds=values('--workspace');
  if(!agentId||!workspaceIds.length)throw Error('Select --agent and at least one --workspace before starting work');
  const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
  let resume=args.includes('--resume');
  try{
    do{
      const result=await runProductionTurn({client,home,agentId,workspaceIds,sectionIds:values('--section'),demandId:flag('--id'),resume,signal:controller.signal,producer:produceCenterEdition,onEvent:event=>{if(event.type!=='agent_output')emit(event);}});
      resume=false;
      emit(result);if(args.includes('--once')||['blocked','pending'].includes(result.state))return result;
      if(result.state==='idle')await new Promise(resolve=>{const done=()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,15000);controller.signal.addEventListener('abort',done,{once:true});});
    }while(!controller.signal.aborted);
  }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))centerCommand(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
