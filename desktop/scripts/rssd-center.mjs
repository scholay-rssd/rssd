import {readFile,rm,mkdir,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {centerHome} from './agent/headless/center.mjs';
import {AgentRegistry} from './agent/agent-registry.mjs';
import {produceCenterEdition} from './agent/center-producer.mjs';
import {runProductionTurn} from '../../scripts/rssd-production-worker.mjs';
import {CenterOutbox,createCenterClient,saveCenterConnection,loadCenterConnection,writeCenterJson} from '../../scripts/rssd-center-client.mjs';
import {withFileLock,lockOwnerAlive} from '../../scripts/editorial-lock.mjs';
import protocol from '../../contracts/rssd-v1.cjs';
import {readConfiguredLabels} from './runtime/labels-source.mjs';
const read=async path=>{try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};

export async function centerDesktopCall(method,params={},home=centerHome()){
  const stateFile=join(home,'worker.json');
  if(method==='validate_connect'){
    await centerDesktopCall('prepare_update',{},home);
    const identity=await createCenterClient({origin:params.origin,token:process.env.RSSD_CENTER_TOKEN}).identity();
    const previous=await read(join(home,'connection.json')),active=await read(join(home,'active-claim.json'));
    if(active?.claim&&previous?.identity?.workerId!==identity.workerId)throw Error('请先恢复或释放当前认领，再更换连接');
    return {identity};
  }
  if(method==='disconnect'){
    await centerDesktopCall('prepare_update',{},home);
    const active=await read(join(home,'active-claim.json'));if(active?.claim)throw Error('请先恢复或释放当前认领，再退出连接');
    const connection=await read(join(home,'connection.json'));if(connection){delete connection.token;await writeCenterJson(join(home,'connection.json'),{...connection,disconnected:true});}return {disconnected:true};
  }
  if(method==='prepare_update'){
    for(const name of ['daemon.lock','worker.lock']){const owner=await read(join(home,name));if(owner&&await lockOwnerAlive(owner))throw Error('中心生产任务仍在运行，请先停止领取并等待本单完成后安装更新');}
    return {ready:true};
  }
  const draftPath=(id,locale)=>join(home,'drafts',protocol.hash([protocol.id(id),protocol.locale(locale)])+'.json');
  if(method==='save_local'){
    protocol.id(params.work?.id);protocol.locale(params.locale);protocol.text(params.title,'title',1000,true);protocol.text(params.body,'body',2000000,true);
    const connection=await read(join(home,'connection.json'));if(!connection)throw Error('Connect a center before creating a draft');
    const value={...params,origin:connection.origin,orgId:connection.identity.orgId,updatedAt:new Date().toISOString()};
    await writeCenterJson(draftPath(params.work.id,params.locale),value);return {saved:true};
  }
  if(method==='local_draft'){
    const draft=await read(draftPath(params.workId,params.locale)),connection=await read(join(home,'connection.json'));
    if(draft&&(draft.origin!==connection?.origin||draft.orgId!==connection?.identity.orgId))throw Error('草稿属于另一个中心，请保留并在原中心恢复');return draft;
  }
  if(method==='delete_local'){await rm(draftPath(params.workId,params.locale),{force:true});return {removed:true};}
  if(method==='status'){
    const connection=await read(join(home,'connection.json')),saved=await read(stateFile);
    const worker=saved&&['starting','working','idle','stopping'].includes(saved.state)&&!await lockOwnerAlive(saved)?{...saved,state:'interrupted',message:'执行进程已结束，原任务与稿件保留，可恢复'}:saved;
    const entries=connection?await new CenterOutbox({directory:join(home,'outbox'),client:{origin:connection.origin}}).list():[];
    let draftFiles=[];try{draftFiles=await readdir(join(home,'drafts'));}catch(e){if(e.code!=='ENOENT')throw e;}
    const drafts=[];for(const file of draftFiles.filter(f=>/^[a-f0-9]{64}\.json$/.test(f))){const d=await read(join(home,'drafts',file));if(d&&d.origin===connection?.origin&&d.orgId===connection?.identity.orgId)drafts.push({workId:d.work.id,workspaceId:d.work.workspaceId,title:d.title,locale:d.locale,updatedAt:d.updatedAt});}
    const activeClaim=(await read(join(home,'active-claim.json')))?.claim;
    return {configured:Boolean(connection&&!connection.disconnected),origin:connection?.origin,identity:connection?.identity,worker,activeClaim:activeClaim?{id:activeClaim.id,title:activeClaim.title}:null,drafts,outbox:entries.map(e=>({requestId:e.requestId,workId:e.packet.workId,state:e.state,error:e.error,receipt:e.receipt})),agents:await new AgentRegistry().list()};
  }
  if(method==='connect')return saveCenterConnection(home,{origin:params.origin,token:process.env.RSSD_CENTER_TOKEN,persistToken:false,credentialService:params.credentialService});
  if(method==='labels')return (await readConfiguredLabels({home})).feed;
  if(method==='stop'){await writeCenterJson(join(home,'stop.json'),{requestedAt:new Date().toISOString()});return {state:'stopping',message:'当前需求完成后停止领取'};}
  const {client}=await loadCenterConnection(home),outbox=new CenterOutbox({directory:join(home,'outbox'),client});
  if(method==='registry'){
    try{const value=await client.registry();await writeCenterJson(join(home,'registry.json'),{origin:client.origin,value});return value;}
    catch(error){const cached=await read(join(home,'registry.json'));if((!error.status||error.status>=500)&&cached?.origin===client.origin)return {...cached.value,offline:true};throw error;}
  }
  if(method==='demands')return client.demands({workspaceId:params.workspaceId,search:params.search,limit:params.limit,offset:params.offset});
  if(method==='works')return client.works({workspaceId:params.workspaceId,search:params.search,limit:params.limit,offset:params.offset});
  if(method==='work')return client.work(params.workId);
  if(method==='publications')return client.publications({workspaceId:params.workspaceId,limit:params.limit,offset:params.offset});
  if(method==='claim')return client.claim({workspaceIds:[params.workspaceId],sectionIds:params.sectionId?[params.sectionId]:[],demandId:params.demandId});
  if(method==='release'){
    await centerDesktopCall('prepare_update',{},home);const active=await read(join(home,'active-claim.json'));
    if(!active?.claim)throw Error('本机没有待释放的认领');
    const current=await client.activeClaim();
    if(current&&current.id!==active.claim.id)throw Error('中心认领与本机记录不同，请先核对任务');
    if(current)await client.changeDemand(current.id,{action:'release',claimToken:current.claimToken});
    await writeCenterJson(join(home,'active-claim.json'),{origin:client.origin,claim:null});return {released:true};
  }
  if(method==='submit'){const entry=await outbox.enqueue(params.packet);return outbox.flushOne(entry.requestId);}
  if(method==='recover')return params.requestId?outbox.flushOne(params.requestId,{retry:true}):outbox.flush();
  throw Error('Unknown center operation');
}
export async function runDesktopWorker(params,{home=centerHome(),producer=produceCenterEdition}={}){
  if(typeof params.agentId!=='string'||!params.agentId||!Array.isArray(params.workspaceIds)||!params.workspaceIds.length)throw Error('先选择工作范围与智能体');
  await mkdir(home,{recursive:true,mode:0o700});
  return withFileLock(join(home,'daemon.lock'),async()=>{
    const saved=await read(join(home,'worker.json'));
    if(saved&&['working','idle','starting','stopping'].includes(saved.state)&&await lockOwnerAlive(saved))throw Error('已有工作实例正在运行');
    const state={pid:process.pid,state:'starting',agentId:params.agentId,workspaceIds:params.workspaceIds,startedAt:new Date().toISOString()};
    const status=async patch=>{Object.assign(state,patch,{updatedAt:new Date().toISOString()});await writeCenterJson(join(home,'worker.json'),state);};
    await rm(join(home,'stop.json'),{force:true});await status({});
    try{
      const {client}=await loadCenterConnection(home);
      do{
        if(await read(join(home,'stop.json')))break;
        await status({state:'working',message:'正在处理需求'});
        const result=await runProductionTurn({client,home,agentId:params.agentId,workspaceIds:params.workspaceIds,sectionIds:params.sectionIds||[],demandId:params.demandId,resume:params.resume===true,producer});
        await status({state:result.state==='idle'?'idle':result.state==='accepted'?'working':'blocked',result,message:result.state==='idle'?'等待新的需求':result.state==='accepted'?'本单已交给中心':result.message||'结果已保留，请检查任务状态'});
        if(params.once||params.demandId||['blocked','pending'].includes(result.state))return result;
        // Resume authorization applies only to the task the owner restarted.
        params.resume=false;
        if(result.state==='idle')for(let i=0;i<15;i++){if(await read(join(home,'stop.json')))break;await new Promise(r=>setTimeout(r,1000));}
      }while(true);
      await status({state:'stopped',message:'已停止领取，现有结果保留'});
    }catch(error){await status({state:'blocked',message:String(error.message).slice(0,2000)});throw error;}
    finally{if(state.state==='working')await status({state:'stopped',message:'本单已处理，工作实例已停止'});}
  },{timeout:100});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>24*1024*1024)throw Error('Center request is too large');}
  try{const request=JSON.parse(input);const result=process.argv.includes('--worker')?await runDesktopWorker(request.params):await centerDesktopCall(request.method,request.params);if(result!==undefined)console.log(JSON.stringify(result));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
