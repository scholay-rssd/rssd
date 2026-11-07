import {readFile,rm,mkdir,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {centerHome} from './agent/headless/center.mjs';
import {AgentRegistry} from './agent/agent-registry.mjs';
import {produceCenterEdition} from './agent/center-producer.mjs';
import {runProductionTurn} from '../../scripts/rssd-production-worker.mjs';
import {CenterError,CenterOutbox,clearCompletedClaim,hasCompletedClaimReceipt,createCenterClient,saveCenterConnection,loadCenterConnection,writeCenterJson} from '../../scripts/rssd-center-client.mjs';
import {withFileLock,lockOwnerAlive} from '../../scripts/editorial-lock.mjs';
import protocol from '../../contracts/rssd-v1.cjs';
import {COLUMN_RULES} from '../../contracts/editorial-column-policy.mjs';
import {assistantLocal,runCenterAssistant} from './agent/center-assistant.mjs';
import {readConfiguredLabels} from './runtime/labels-source.mjs';
import {assertAutomaticTopicScope,automaticTopicTick} from './rssd-topic-auto.mjs';
import {preparedReferencePreview,submitPreparedReferenceRevision} from '../../scripts/rssd-prepared-reference-revision.mjs';
import {completeStoredEdition} from '../../scripts/rssd-device-media.mjs';
import {enqueueTranslateContinuation} from '../../scripts/rssd-translate-continuation.mjs';
const read=async path=>{try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};

export async function centerDesktopCall(method,params={},home=centerHome()){
  const stateFile=join(home,'worker.json');
  if(['assistant_status','assistant_cancel','assistant_reset'].includes(method))return assistantLocal(method,params,home);
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
    for(const name of ['daemon.lock','worker.lock','assistant.lock']){const owner=await read(join(home,name));if(owner&&await lockOwnerAlive(owner))throw Error('中心生产任务仍在运行，请先停止领取并等待本单完成后安装更新');}
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
    const outbox=connection?new CenterOutbox({directory:join(home,'outbox'),client:{origin:connection.origin}}):null;
    const entries=outbox?await outbox.list():[];
    let draftFiles=[];try{draftFiles=await readdir(join(home,'drafts'));}catch(e){if(e.code!=='ENOENT')throw e;}
    const drafts=[];for(const file of draftFiles.filter(f=>/^[a-f0-9]{64}\.json$/.test(f))){const d=await read(join(home,'drafts',file));if(d&&d.origin===connection?.origin&&d.orgId===connection?.identity.orgId)drafts.push({workId:d.work.id,workspaceId:d.work.workspaceId,title:d.title,locale:d.locale,updatedAt:d.updatedAt});}
    let active=await read(join(home,'active-claim.json'));
    // Recover completed claims left by older clients or an interrupted write.
    // Never race a live producer or clear a claim merely because it is offline.
    if(outbox&&!['starting','working','idle','stopping'].includes(worker?.state)&&hasCompletedClaimReceipt(active,connection.origin,entries,connection.identity?.workerId)){
      try{await withFileLock(join(home,'worker.lock'),async()=>{
        const current=await read(join(home,'connection.json'));
        if(current?.origin===connection.origin&&current.identity?.orgId===connection.identity?.orgId&&current.identity?.workerId===connection.identity?.workerId)
          await clearCompletedClaim(home,connection.origin,await outbox.list(),connection.identity?.workerId);
      },{timeout:0});}
      catch(error){if(error.message!=='文件正在保存，请稍后重试；现有内容已保留')throw error;}
      active=await read(join(home,'active-claim.json'));
    }
    const activeClaim=active?.claim;
    // A broken optional operator configuration must not hide the connection or
    // prevent recovery of an existing claim.
    const multisite=await read(join(home,'multisite-config.json')).catch(()=>null);
    return {configured:Boolean(connection&&!connection.disconnected),multisiteConfigured:multisite?.enabled===true,preparedReference:await preparedReferencePreview(home),origin:connection?.origin,identity:connection?.identity,worker,activeClaim:activeClaim?{id:activeClaim.id,title:activeClaim.title}:null,drafts,outbox:entries.map(e=>({requestId:e.requestId,workId:e.packet.workId,state:e.state,error:e.error,receipt:e.receipt})),agents:await new AgentRegistry().list()};
  }
  if(method==='connect')return saveCenterConnection(home,{origin:params.origin,token:process.env.RSSD_CENTER_TOKEN,persistToken:false,credentialService:params.credentialService});
  if(method==='labels')return (await readConfiguredLabels({home})).feed;
  if(method==='stop'){await writeCenterJson(join(home,'stop.json'),{requestedAt:new Date().toISOString()});return {state:'stopping',message:'当前需求完成后停止领取'};}
  const {client,identity}=await loadCenterConnection(home),outbox=new CenterOutbox({directory:join(home,'outbox'),client});
  if(method==='submit_prepared_revision')return submitPreparedReferenceRevision({home,client,identity,outbox});
  if(method==='registry'){
    try{const value=await client.registry();await writeCenterJson(join(home,'registry.json'),{origin:client.origin,value});return value;}
    catch(error){const cached=await read(join(home,'registry.json'));if((!error.status||error.status>=500)&&cached?.origin===client.origin)return {...cached.value,offline:true};throw error;}
  }
  if(['overview','calendar','channels','goals'].includes(method)){
    const query=new URLSearchParams(Object.entries(params).filter(([k,v])=>['workspaceIds','workspaceId','from','to','limit','offset'].includes(k)&&v!==undefined));
    return client.request((method==='goals'?'/goals':'/coordination/'+method)+'?'+query);
  }
  if(method==='edit_demand')return client.request('/demands/'+encodeURIComponent(protocol.id(params.id))+'/definition',{method:'PATCH',body:{requestId:params.requestId,baseGeneration:params.baseGeneration,changes:params.changes}});
  if(method==='demands')return client.demands({workspaceId:params.workspaceId,search:params.search,limit:params.limit,offset:params.offset});
  if(method==='create_demand'){
    // This bridge is deliberately scoped to the research-methods site and its
    // owner-confirmed columns. The caller retains the supplied ID and
    // reconciles it after an uncertain POST.
    const allowed=new Set(['id','workspaceId','sectionId','kind','title','brief','requiredLocales','source','priority']);
    if(!params||typeof params!=='object'||Array.isArray(params)||Object.keys(params).some(key=>!allowed.has(key)))throw Error('选题参数无效');
    protocol.id(params.id);protocol.text(params.title,'title',500);protocol.text(params.brief,'brief',100000,true);
    if(params.workspaceId!=='metho'||!Object.hasOwn(COLUMN_RULES.metho,params.sectionId)||params.kind!=='write'||!Array.isArray(params.requiredLocales)||params.requiredLocales.length!==1||params.requiredLocales[0]!=='zh-CN'||(params.source!==undefined&&params.source!==null)||(params.priority!==undefined&&params.priority!==0))throw Error('选题不在研究方法站已确认栏目范围内');
    const input=protocol.demand({id:params.id,workspaceId:'metho',sectionId:params.sectionId,kind:'write',title:params.title,brief:params.brief||'',requiredLocales:['zh-CN'],source:null,priority:0});
    const result=await client.createDemand(input);
    if(result?.id!==input.id||result.workspaceId!==input.workspaceId||result.sectionId!==input.sectionId||protocol.canonical(result.payload)!==protocol.canonical(input))throw Error('选题回执与原请求不符，请按原 ID 核对');
    return {id:input.id,workspaceId:input.workspaceId,sectionId:input.sectionId,title:input.title,state:result.state,payload:input};
  }
  if(method==='enqueue_translate'){
    const allowed=new Set(['workId','revision']);
    if(!params||typeof params!=='object'||Array.isArray(params)||Object.keys(params).some(key=>!allowed.has(key)))throw Error('补译参数无效');
    return enqueueTranslateContinuation({client,workId:params.workId,revision:params.revision});
  }
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
  if(method==='submit'){
    const packet=await completeStoredEdition({packet:params.packet,home,directory:home,client});
    const entry=await outbox.enqueue(packet);return outbox.flushOne(entry.requestId);
  }
  if(method==='recover')return params.requestId?outbox.flushOne(params.requestId,{retry:true}):outbox.flush();
  if(method==='retry_website'){
    protocol.id(params.workspaceId,'workspaceId');protocol.id(params.requestKey,'requestKey');protocol.id(params.jobId,'jobId');
    if(Array.isArray(identity.workspaceIds)&&!identity.workspaceIds.includes(params.workspaceId))throw Error('Workspace access denied');
    return client.editorialRetry(params.workspaceId,params.requestKey,{jobId:params.jobId});
  }
  throw Error('Unknown center operation');
}
export async function runDesktopWorker(params,{home=centerHome(),producer=produceCenterEdition,topicTick=automaticTopicTick,turn=runProductionTurn,connect=loadCenterConnection,retryDelaysMs=[5000,15000,30000],idleRetryCapMs=300000,pause=ms=>new Promise(r=>setTimeout(r,ms))}={}){
  if(typeof params.agentId!=='string'||!params.agentId||!Array.isArray(params.workspaceIds)||!params.workspaceIds.length)throw Error('先选择工作范围与智能体');
  const autoTopics=assertAutomaticTopicScope(params);
  const activeProducer=autoTopics?input=>producer({...input,expectedModel:'gpt-6.1-terra'}):producer;
  await mkdir(home,{recursive:true,mode:0o700});
  return withFileLock(join(home,'daemon.lock'),async()=>{
    const saved=await read(join(home,'worker.json'));
    if(saved&&['working','idle','starting','stopping'].includes(saved.state)&&await lockOwnerAlive(saved))throw Error('已有工作实例正在运行');
    const owner=await read(join(home,'daemon.lock'));
    const state={pid:process.pid,...(owner?.identity?{identity:owner.identity}:{}),state:'starting',agentId:params.agentId,workspaceIds:params.workspaceIds,autoTopics,startedAt:new Date().toISOString()};
    const status=async patch=>{Object.assign(state,patch,{updatedAt:new Date().toISOString()});await writeCenterJson(join(home,'worker.json'),state);};
    await rm(join(home,'stop.json'),{force:true});await status({});
    const stopping=async()=>Boolean(await read(join(home,'stop.json'))),stopped=Symbol('stopped');
    // Each retry re-enters the original operation. Production turns first
    // reconcile the durable outbox and the worker's existing center claim;
    // topic maintenance reconciles any saved demand ID before making another.
    // One-shot actions and errors other than a known transport interruption
    // remain explicit failures, as do blocked/pending results.
    const safeIdleRetry=async client=>{
      try{
        const active=await read(join(home,'active-claim.json'));
        if(active?.claim)return false;
        const topics=await read(join(home,'topic-maintainer.json'));
        if(topics&&(!Array.isArray(topics.entries)||topics.entries.some(entry=>entry.status!=='accepted')))return false;
        const entries=await new CenterOutbox({directory:join(home,'outbox'),client}).list();
        return entries.every(entry=>entry.state==='accepted');
      }catch{return false;}
    };
    const retryNetwork=async (operation,{idlePolling=false,client}={})=>{
      let attempt=0;
      while(true){
        if(await stopping())return stopped;
        try{return await operation();}
        catch(error){
          if(params.once||params.demandId||!(error instanceof CenterError)||error.status!==0||error.code!=='network_error')throw error;
          // The idle poll can wait for a prolonged outage only while local
          // state has no retained claim or uncertain submission/demand. A
          // lost claim response is safe here: each new turn queries the
          // center's current claim before it can request another one.
          if(attempt>=retryDelaysMs.length&&!(idlePolling&&await safeIdleRetry(client)))throw error;
          await status({state:'idle',message:'中心暂时不可用，正在等待安全重试'});
          let remaining=attempt<retryDelaysMs.length?retryDelaysMs[attempt]:Math.min(idleRetryCapMs,(retryDelaysMs.at(-1)||1000)*2**Math.min(attempt-retryDelaysMs.length+1,20));attempt++;
          if(!Number.isSafeInteger(remaining)||remaining<0)throw Error('Invalid network retry delay');
          while(remaining>0){if(await stopping())return stopped;const step=Math.min(remaining,1000);await pause(step);remaining-=step;}
        }
      }
    };
    let connectedClient;
    try{
      const {client}=await connect(home);connectedClient=client;
      let nextTopicCheck=0;
      do{
        if(await read(join(home,'stop.json')))break;
        await status({state:'working',message:'正在处理需求'});
        const result=await retryNetwork(()=>turn({client,home,agentId:params.agentId,workspaceIds:params.workspaceIds,sectionIds:params.sectionIds||[],demandId:params.demandId,resume:params.resume===true,...(autoTopics?{requiredModel:'gpt-6.1-terra'}:{}),producer:activeProducer}),{idlePolling:true,client});
        if(result===stopped)break;
        await status({state:result.state==='idle'?'idle':result.state==='accepted'?'working':'blocked',result,message:result.state==='idle'?'等待新的需求':result.state==='accepted'?'本单已交给中心':result.message||'结果已保留，请检查任务状态'});
        if(params.once||params.demandId||['blocked','pending'].includes(result.state))return result;
        if(autoTopics&&result.state==='idle'&&Date.now()>=nextTopicCheck){
          await status({state:'working',message:'正在核查并补充选题'});
          const tick=await retryNetwork(()=>topicTick({client,home,shouldStop:stopping}));
          if(tick===stopped)break;
          if(tick.state==='stopped')break;
          if(['created','recovered'].includes(tick.state)){nextTopicCheck=Date.now()+60000;continue;}
          nextTopicCheck=Date.now()+15*60000;
          await status({state:'idle',message:'今日自动选题已达到上限，等待已有需求'});
        }
        // Resume authorization applies only to the task the owner restarted.
        params.resume=false;
        if(result.state==='idle')for(let i=0;i<15;i++){if(await read(join(home,'stop.json')))break;await new Promise(r=>setTimeout(r,1000));}
      }while(true);
      await status({state:'stopped',message:'已停止领取，现有结果保留'});
    }catch(error){
      const message=String(error.message).slice(0,2000);
      if(autoTopics&&connectedClient)try{await connectedClient.heartbeat({state:'blocked',agentId:params.agentId,message});}catch{/* Preserve the original failure if the center is unavailable. */}
      await status({state:'blocked',message});throw error;
    }
    finally{if(state.state==='working')await status({state:'stopped',message:'本单已处理，工作实例已停止'});}
  },{timeout:100});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>24*1024*1024)throw Error('Center request is too large');}
  try{const request=JSON.parse(input);const result=process.argv.includes('--assistant')?await runCenterAssistant(request.params,centerHome()):process.argv.includes('--worker')?await runDesktopWorker(request.params):await centerDesktopCall(request.method,request.params);if(result!==undefined)console.log(JSON.stringify(result));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
