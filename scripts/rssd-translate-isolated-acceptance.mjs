import {createHash} from 'node:crypto';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {isAbsolute,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {AgentRegistry,executableCommand} from '../desktop/scripts/agent/agent-registry.mjs';
import {produceCenterEdition} from '../desktop/scripts/agent/center-producer.mjs';
import {ARTICLE_WRITING_POLICY} from '../contracts/article-writing-policy.mjs';
import {writeCenterJson} from './rssd-center-client.mjs';
import {runProductionTurn} from './rssd-production-worker.mjs';
import {enqueueTranslateContinuation,TRANSLATE_CONTRACT} from './rssd-translate-continuation.mjs';
import {createTranslateCenterFixture} from '../tests/fixtures/rssd-translate-center.mjs';

export const ISOLATED_WORK_ID='work-t575-isolated-acceptance';
export const ISOLATED_WORKSPACE='enter';
export const ISOLATED_SECTION='forums';
export const ISOLATED_SOURCE_MARK='T575 isolated acceptance fixture. Not an Enter production work. Does not complete any of the 93 missing English editions.';
export const ISOLATED_ADAPTER='@agentclientprotocol/codex-acp';
const LIVE_TOKEN_KEYS=['RSSD_CENTER_TOKEN','SCHOLAY_TODAY_TOKEN','SCHOLAY_TODAY_TOKEN_FILE'];
const AUTH_NAME=/(^|\/)(\.codex|\.cursor|auth\.json|credentials|id_rsa|token)(\/|$)/i;
function fail(message){throw Object.assign(Error(message),{code:'isolated_acceptance_refused'});}
function sha(value){return createHash('sha256').update(value).digest('hex');}
export function parseIsolatedArgs(argv=process.argv.slice(2)){
  const flags={probe:false,run:false,accepted:false,agent:'codex',timeoutMs:30*60000,home:'',codexPath:''};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];
    if(arg==='--probe')flags.probe=true;
    else if(arg==='--run')flags.run=true;
    else if(arg==='--i-accept-isolated-provider')flags.accepted=true;
    else if(arg==='--agent')flags.agent=argv[++i];
    else if(arg==='--timeout-ms')flags.timeoutMs=Number(argv[++i]);
    else if(arg==='--home')flags.home=argv[++i];
    else if(arg==='--codex-path')flags.codexPath=argv[++i];
    else fail('Unknown argument: '+arg);
  }
  if(flags.run)flags.probe=false;else flags.probe=true;
  return flags;
}
export function assertIsolatedGuards({agent,codexPath,accepted,run,env=process.env}={}){
  if(agent!=='codex')fail('Isolated acceptance is authorized for the installed Codex ACP only');
  for(const key of LIVE_TOKEN_KEYS)if(env[key])fail('Live Center or website tokens are present; isolated acceptance refuses production credentials');
  if(run&&!accepted)fail('Pass --i-accept-isolated-provider before a real provider turn');
  if(codexPath){
    if(!isAbsolute(codexPath)||AUTH_NAME.test(codexPath))fail('Codex path must be an absolute CLI executable, not an auth file');
  }
}
export function isolatedAgentsConfig({codexPath}={}){
  return {version:1,agents:[{id:'codex',enabled:true,command:codexPath||'codex'}]};
}
export async function isolatedSkillSnapshot({claim,directory,writingPolicy}){
  const content=['---','name: t575-isolated-acceptance','version: t575','---','',ISOLATED_SOURCE_MARK,'Frozen writing protocol: '+writingPolicy.version].join('\n');
  const skills=[{id:'t575-isolated-acceptance',version:'t575',contentHash:sha(content),content}];
  const snapshot={snapshotHash:sha(JSON.stringify(skills)),skills};
  await writeCenterJson(join(directory,'writing-skills.json'),snapshot);
  return snapshot;
}
export function isolatedProducer(registry,timeoutMs){
  return input=>produceCenterEdition(input,{registry,skillSnapshot:isolatedSkillSnapshot,timeoutMs});
}
export function adapterLaunchOk(launch){
  const args=launch?.args||[];
  const text=[launch?.command,...args].join(' ');
  return typeof launch?.command==='string'&&args.some(arg=>String(arg).includes('codex-acp'))&&!/\bcodex\b/.test(String(launch.command).split(/[\\/]/).pop()||'')&&!text.includes(' exec');
}
async function cliVersion(command='codex'){
  const resolved=executableCommand(command);
  if(!resolved)return null;
  return await new Promise(resolve=>{
    const child=spawn(resolved.command,[...resolved.args,'--version'],{stdio:['ignore','pipe','pipe'],env:process.env});
    let out='';
    child.stdout.on('data',chunk=>out+=chunk);
    child.stderr.on('data',chunk=>out+=chunk);
    child.on('error',()=>resolve(null));
    child.on('close',()=>resolve(out.trim().split(/\n/)[0]||null));
  });
}
export async function createIsolatedFixture(){
  const center=createTranslateCenterFixture();
  const work=center.addWork({id:ISOLATED_WORK_ID,workspaceId:ISOLATED_WORKSPACE,sectionId:ISOLATED_SECTION,title:ISOLATED_SOURCE_MARK,body:ISOLATED_SOURCE_MARK+'\n\n这是隔离验收用的中文正文，不是学术之门已有作品，不能当作 93 篇缺译已完成。'});
  const source=work.editions.find(edition=>edition.locale==='zh-CN');
  return {center,work,source,client:center.client('t575-isolated')};
}
export async function probeIsolatedAcceptance({home,codexPath}={}){
  const registry=new AgentRegistry(join(home,'agents.json'));
  await writeCenterJson(join(home,'agents.json'),isolatedAgentsConfig({codexPath}));
  let launch=null,adapterError=null;
  try{launch=await registry.launch('codex');}catch(error){adapterError=error.message;}
  const cli=executableCommand(codexPath||'codex');
  const version=cli?await cliVersion(codexPath||'codex'):null;
  const fixture=await createIsolatedFixture();
  const queued=await enqueueTranslateContinuation({client:fixture.client,workId:ISOLATED_WORK_ID});
  return {
    home,fixture,workId:ISOLATED_WORK_ID,source:{workId:ISOLATED_WORK_ID,locale:'zh-CN',revision:fixture.source.revision,hash:fixture.source.hash},
    writingPolicy:ARTICLE_WRITING_POLICY,queued,launch,adapterError,cli:cli&&{command:cli.command,args:cli.args},cliVersion:version,
    adapterOk:adapterLaunchOk(launch),cliOk:!!cli,producer:'produceCenterEdition',adapter:ISOLATED_ADAPTER,
    centerHead:TRANSLATE_CONTRACT.centerHead,fixtureOrigin:fixture.client.origin,
  };
}
export async function runIsolatedAcceptance({home,codexPath,timeoutMs,signal}={}){
  process.env.RSSD_ISOLATED_ACCEPTANCE='1';
  process.env.SCHOLAY_AGENT_HOME=home;
  const probe=await probeIsolatedAcceptance({home,codexPath});
  if(!probe.adapterOk)fail(probe.adapterError||('Official ACP adapter '+ISOLATED_ADAPTER+' is missing; unpack the bundle runtime, do not substitute a fake ACP or call `codex` directly'));
  if(!probe.cliOk)fail('Installed Codex CLI is not on PATH. This VM is not the runner. Shared computer should already have codex 0.163.0.');
  const registry=new AgentRegistry(join(home,'agents.json'));
  const turn=await runProductionTurn({
    client:probe.fixture.client,home,agentId:'codex',workspaceIds:[ISOLATED_WORKSPACE],sectionIds:[ISOLATED_SECTION],
    demandId:probe.queued.id,producer:isolatedProducer(registry,timeoutMs),signal,
  });
  return {probe,turn};
}

async function evidenceFiles(home){
  const jobs=join(home,'jobs');
  let job='';
  try{const dirs=await readdir(jobs);job=dirs[0]?join(jobs,dirs[0]):'';}catch{job='';}
  const outboxDir=join(home,'outbox');
  let outbox=[];
  try{outbox=(await readdir(outboxDir)).filter(name=>name.endsWith('.json')).map(name=>join(outboxDir,name));}catch{outbox=[];}
  return {job,claim:job&&join(job,'claim.json'),prompt:job&&join(job,'en.prompt.txt'),output:job&&join(job,'en.agent-output.txt'),result:job&&join(job,'en.result.json'),packet:job&&join(job,'en.packet.json'),outbox};
}

async function writeEvidence(home,probe,turn){
  const files=await evidenceFiles(home);
  let packet=null,prompt='';
  if(files.packet)try{packet=JSON.parse(await readFile(files.packet,'utf8'));}catch{}
  if(files.prompt)try{prompt=await readFile(files.prompt,'utf8');}catch{}
  const evidence={
    authorization:'t575',mode:turn?'run':'probe',producer:'produceCenterEdition',adapter:ISOLATED_ADAPTER,
    workId:ISOLATED_WORK_ID,source:probe.source,writingPolicy:probe.writingPolicy,centerHead:probe.centerHead,
    fixtureOrigin:probe.fixtureOrigin,liveCenter:false,queuedId:probe.queued.id,launch:probe.launch&&{command:probe.launch.command,args:probe.launch.args},
    adapterOk:probe.adapterOk,cliVersion:probe.cliVersion,adapterError:probe.adapterError||null,
    translationOf:packet?.editions?.[0]?.translationOf||null,locales:packet?.editions?.map(edition=>edition.locale)||[],
    promptHasPolicy:prompt.includes(ARTICLE_WRITING_POLICY),promptHasSourceMark:prompt.includes(ISOLATED_SOURCE_MARK),
    turn:turn&&{state:turn.state,workId:turn.workId,demandId:turn.demandId,requestId:turn.submissions?.[0]?.requestId,receipt:turn.submissions?.[0]?.receipt?.status||null},
    files,notProductionWorks:true,
  };
  await writeCenterJson(join(home,'evidence.json'),evidence);
  return evidence;
}

async function main(){
  const flags=parseIsolatedArgs();
  assertIsolatedGuards(flags);
  const home=flags.home||join(tmpdir(),'rssd-t575-isolated-'+Date.now().toString(36));
  await mkdir(home,{recursive:true,mode:0o700});
  const controller=new AbortController();
  const stop=()=>controller.abort();
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    if(flags.run){
      const {probe,turn}=await runIsolatedAcceptance({home,codexPath:flags.codexPath,timeoutMs:flags.timeoutMs,signal:controller.signal});
      const evidence=await writeEvidence(home,probe,turn);
      console.log(JSON.stringify({ok:turn.state==='accepted',home,evidence},null,2));
      if(turn.state!=='accepted')process.exitCode=1;
      return;
    }
    const probe=await probeIsolatedAcceptance({home,codexPath:flags.codexPath});
    const evidence=await writeEvidence(home,probe,null);
    console.log(JSON.stringify({ok:probe.adapterOk,home,probe:{adapterOk:probe.adapterOk,cliOk:probe.cliOk,cliVersion:probe.cliVersion,adapterError:probe.adapterError,queuedId:probe.queued.id,source:probe.source,launch:evidence.launch},blockers:[!probe.adapterOk&&(probe.adapterError||'adapter missing'),!probe.cliOk&&'codex CLI not on PATH'].filter(Boolean)},null,2));
    if(!probe.adapterOk)process.exitCode=2;
  }finally{
    process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
  }
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])main().catch(error=>{console.error(error.message);process.exitCode=1;});
