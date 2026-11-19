// Codex image provider: one `codex exec` run draws one picture with Codex's own image tool.
// Same {id,start,lookup} contract as the Cursor gallery provider, so rssd-image-staging can use either.
// A request is started at most once; after a crash or timeout only its original Codex thread is looked up.
import {mkdir,readFile,writeFile,rename,rm,readdir,lstat,open} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import fsConstants from 'node:fs';
import protocol from '../contracts/rssd-v1.cjs';
import media from '../contracts/rssd-media.cjs';
import {withFileLock} from './editorial-lock.mjs';
import {validateImagePolicySnapshot} from './rssd-image-policy.mjs';

async function optional(file){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function save(file,value){const temp=file+'.'+randomUUID();try{await writeFile(temp,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});await rename(temp,file);}finally{await rm(temp,{force:true});}}
const pending=reason=>({status:'pending',...(reason?{reason}:{})});
const THREAD=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The drawing model as the picture itself states it. OpenAI signs generated PNGs with a C2PA manifest whose
 * `softwareAgent` names the service and model version (CBOR: "name" → "ChatGPT", "version" → "gpt-image").
 * Returns {service, model} or null when the file carries no such statement; nothing is guessed.
 */
export function drawingModelFromBytes(bytes){
 const text=bytes.toString('latin1'),at=text.indexOf('softwareAgent');if(at<0)return null;
 const window=bytes.subarray(at,at+400);
 const field=key=>{
  const k=Buffer.from(key,'latin1'),i=window.indexOf(Buffer.concat([Buffer.from([0x60+k.length]),k]));if(i<0)return null;
  const head=window[i+1+k.length],len=head>=0x60&&head<0x78?head-0x60:head===0x78?window[i+2+k.length]:-1;if(len<1)return null;
  const start=i+1+k.length+(head===0x78?2:1),value=window.subarray(start,start+len).toString('utf8');
  return /^[\w .:+-]{1,80}$/.test(value)?value:null;
 };
 const service=field('name'),model=field('version');
 return model?{service:service||null,model}:null;
}

/** Spawn `codex exec --json` and resolve with its thread id once the run ends. Rejects on a failed run. */
export function runCodexExec({prompt,cwd,images=[],command=['npx','-y','@openai/codex'],signal,timeoutMs=600000,sandbox='read-only'}){
 return new Promise((resolvePromise,reject)=>{
  const args=[...command.slice(1),'exec','--json','--skip-git-repo-check','--sandbox',sandbox,'-C',cwd,...images.flatMap(file=>['-i',file]),'-'];
  const child=spawn(command[0],args,{cwd,stdio:['pipe','pipe','pipe'],signal,timeout:timeoutMs});
  let threadId=null,buffer='',errors='',failure=null;
  child.stdout.on('data',chunk=>{
   buffer+=chunk;let line;
   while((line=buffer.indexOf('\n'))>=0){
    const row=buffer.slice(0,line);buffer=buffer.slice(line+1);
    try{const event=JSON.parse(row);if(event.type==='thread.started'&&THREAD.test(event.thread_id||''))threadId=event.thread_id;if(event.type==='turn.failed'||event.type==='error')failure=event.error?.message||event.message||'Codex run failed';}catch{}
   }
  });
  child.stderr.on('data',chunk=>{errors=(errors+chunk).slice(-4000);});
  child.on('error',reject);
  child.on('close',code=>{
   if(code===0&&!failure)resolvePromise({threadId});
   else reject(Object.assign(Error(failure||'Codex exited with '+code+': '+errors.trim().slice(-500)),{threadId}));
  });
  child.stdin.end(prompt);
 });
}

/**
 * @param stateDirectory where each request's state is kept (one JSON file per request)
 * @param codexHome Codex's home; drawings land in <codexHome>/generated_images/<threadId>/
 * @param run injected for tests; defaults to runCodexExec
 */
export function createCodexImageProvider({stateDirectory,codexHome=process.env.CODEX_HOME||join(homedir(),'.codex'),run=runCodexExec,command,enabled=false,reference=null,timeoutMs}={}){
 if(!stateDirectory)throw Error('Codex image provider needs a state directory');
 const states=resolve(stateDirectory),providerId='codex-image-v1';
 async function inspect(state){
  if(!THREAD.test(state.threadId||''))return pending(state.phase==='failed'?state.error:null);
  const dir=join(resolve(codexHome),'generated_images',state.threadId);let names;
  try{names=(await readdir(dir)).filter(n=>/\.(png|jpe?g|webp)$/i.test(n));}catch{return pending('Codex has not saved a drawing yet');}
  if(names.length!==1)return pending(names.length?'Codex saved more than one drawing; retain for review':'Codex has not saved a drawing yet');
  const file=join(dir,names[0]),info=await lstat(file);
  if(!info.isFile()||info.isSymbolicLink()||info.size>media.MAX_BYTES)return pending('Drawing file is unusable');
  const handle=await open(file,fsConstants.constants.O_RDONLY|fsConstants.constants.O_NOFOLLOW);let bytes;
  try{bytes=await handle.readFile();}finally{await handle.close();}
  const sha256=createHash('sha256').update(bytes).digest('hex'),drawn=drawingModelFromBytes(bytes);
  return {status:'ready',bytes,
   registration:{assetId:sha256.slice(0,24),taskId:state.threadId,sha256},
   // Internal record only: which agent and model drew it. Public captions use the site disclosure, never this.
   provenance:{kind:'generated',provider:'codex',agent:'Codex',model:drawn?.model||null,service:drawn?.service||null,threadId:state.threadId,drawnAt:state.finishedAt||null}};
 }
 function prompt(requestId,scope){
  let policyText='';
  if(scope.imagePolicy){
   const policy=validateImagePolicySnapshot(scope.imagePolicy,{siteId:scope.imagePolicy.siteId,workspaceId:scope.workspaceId,referenceSha256:scope.referenceSha256});
   policyText='\nSite image policy (follow the applicable instructions):\n'+[...policy.skills,...policy.references].map(x=>'['+x.path+' SHA-256 '+x.sha256+']\n'+x.content).join('\n\n');
  }
  return 'RSSD '+requestId+'\nUse your image generation tool exactly once to draw one picture for an article. Do not run shell commands, edit files, browse, or retry.'+
   '\nPicture brief: '+scope.requirement+
   (scope.style?'\nHouse style (use exactly this look; it overrides any style the brief implies): '+scope.style:'')+
   (scope.alt?'\nWhat the picture shows (alt text): '+scope.alt:'')+
   (scope.caption?'\nCaption it will sit above: '+scope.caption:'')+
   (scope.referenceSha256?'\nThe attached image is the approved style reference; follow its style.':'')+
   (scope.lettering?'\nLettering: draw exactly these lines, in this order, and no other words, letters, numbers, logos or watermarks:\n'+scope.lettering.map(line=>'「'+line+'」').join('\n'):'\nNo words, letters, logos or watermarks in the picture.')+
   (scope.aspect==='portrait'?' Portrait 2:3.':' Landscape 3:2.')+policyText+
   '\nWhen the picture is drawn, reply with one word: done.';
 }
 async function operate(requestId,scope,start,signal){
  protocol.id(requestId,'requestId');
  if(!enabled)return pending('Codex image provider is disabled');
  await mkdir(states,{recursive:true,mode:0o700});const file=join(states,protocol.hash(requestId)+'.json');
  return withFileLock(file+'.lock',async()=>{
   let state=await optional(file);const scopeHash=protocol.hash(scope);
   if(state&&(state.requestId!==requestId||state.scopeHash!==scopeHash))throw Error('Image provider request scope differs');
   if(state||!start)return state?inspect(state):pending();
   if(typeof scope?.requirement!=='string'||!scope.requirement.trim()||scope.requirement.length>3500)throw Error('Image requirement is invalid');
   if(scope.style!==undefined&&(typeof scope.style!=='string'||!scope.style.trim()||scope.style.length>1000))throw Error('Image style is invalid');
   if(scope.lettering!==undefined&&(!Array.isArray(scope.lettering)||!scope.lettering.length||scope.lettering.length>5||scope.lettering.some(line=>typeof line!=='string'||!line.trim()||[...line].length>60)))throw Error('Image lettering is invalid');
   if(scope.aspect!==undefined&&!['landscape','portrait'].includes(scope.aspect))throw Error('Image aspect is invalid');
   const work=join(states,protocol.hash(requestId).slice(0,32)+'.run');await mkdir(work,{recursive:true,mode:0o700});
   const images=[];
   if(scope.referenceSha256){
    if(!reference||!Buffer.isBuffer(reference.bytes)||media.imageManifest(reference.bytes).sha256!==scope.referenceSha256)return pending('Approved style reference is unavailable');
    const ref=join(work,'reference');await writeFile(ref,reference.bytes,{mode:0o600});images.push(ref);
   }
   const text=prompt(requestId,scope);
   // Saved before the run starts: a crash after this point is never answered with a second drawing.
   state={version:1,requestId,scopeHash,phase:'running',startedAt:new Date().toISOString(),prompt:text};await save(file,state);
   try{const result=await run({prompt:text,cwd:work,images,command,signal,timeoutMs});state={...state,phase:'finished',threadId:result?.threadId||null,finishedAt:new Date().toISOString()};}
   catch(error){state={...state,phase:'failed',threadId:THREAD.test(error?.threadId||'')?error.threadId:null,error:String(error?.message||error).slice(0,1000)};}
   await save(file,state);
   return inspect(state);
  });
 }
 return {id:providerId,
  start:({requestId,scope,signal})=>operate(requestId,scope,true,signal),
  lookup:({requestId,scope,signal})=>operate(requestId,scope,false,signal),
  // The saved state of a request (phase, thread, error), or null when it was never started. Read-only.
  record:requestId=>optional(join(states,protocol.hash(protocol.id(requestId,'requestId'))+'.json'))};
}
