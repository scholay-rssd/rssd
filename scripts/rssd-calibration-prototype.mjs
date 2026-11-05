// Explicit, isolated prototype: not registered with any production worker.
// One fixed calculation only; no input code, paths, arbitrary modules or shell.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname,join,resolve} from 'node:path';
import {lstat,readFile,realpath,writeFile,rename,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {withFileLock} from './editorial-lock.mjs';
const script=join(dirname(fileURLToPath(import.meta.url)),'rssd-calibration-prototype.py');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===[...keys].sort().join(',');

export function validateCalibrationInput(value){
 if(!exact(value,['predictedProbabilities','observedOutcomes','binCount']))throw Error('Only the fixed calibration input schema is allowed');
 const {predictedProbabilities:p,observedOutcomes:y,binCount}=value;
 if(!Array.isArray(p)||!Array.isArray(y)||p.length<1||p.length>5000||y.length!==p.length||!Number.isSafeInteger(binCount)||binCount<2||binCount>20||p.some(x=>typeof x!=='number'||!Number.isFinite(x)||x<0||x>1)||y.some(x=>x!==0&&x!==1))throw Error('Invalid calibration data or limits');
 return {predictedProbabilities:[...p],observedOutcomes:[...y],binCount};
}
async function privateDirectory(path){
 if(typeof path!=='string'||!path.startsWith('/'))throw Error('A private absolute output directory is required');
 const resolved=resolve(path),st=await lstat(resolved),real=await realpath(resolved);
 if(!st.isDirectory()||st.isSymbolicLink()||real!==resolved||(st.mode&0o077)!==0||(typeof process.getuid==='function'&&st.uid!==process.getuid()))throw Error('Output directory must be owned, private and not symlinked');
 return real;
}
async function atomic(file,bytes){const temporary=file+'.'+randomUUID()+'.tmp';try{await writeFile(temporary,bytes,{flag:'wx',mode:0o600});await rename(temporary,file);}finally{await rm(temporary,{force:true});}}
async function compute(input,source,{python,timeoutMs}){
 return new Promise((resolve,reject)=>{
  const child=spawn(python,['-I','-c',source],{cwd:'/',env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},stdio:['pipe','pipe','pipe']});
  let out='',err='',settled=false;const finish=(e,v)=>{if(settled)return;settled=true;clearTimeout(timer);e?reject(e):resolve(v);};
  const timer=setTimeout(()=>{child.kill('SIGKILL');finish(Error('Calculation timed out'));},timeoutMs);
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',s=>{out+=s;if(out.length>1024*1024){child.kill('SIGKILL');finish(Error('Calculation output exceeds limit'));}});
  child.stderr.on('data',s=>{err=(err+s).slice(0,2000);});
  child.on('error',()=>finish(Error('Calculation process failed to start')));
  child.on('close',code=>{if(code!==0)return finish(Error('Calculation process failed: '+err.slice(0,500)));try{finish(null,JSON.parse(out));}catch{finish(Error('Invalid calculation output'));}});
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(input));
 });
}

/** Executes fixed arithmetic and a matching Vega-Lite spec, saving a private receipt.
 * This prototype never accesses Center, articles, a network or a worker. */
export async function runCalibrationPrototype({input,directory,timeoutMs=6000}={}){
 const data=validateCalibrationInput(input),root=await privateDirectory(directory);
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>10000)throw Error('Invalid isolated process configuration');
 const info=await lstat(script);if(!info.isFile()||info.isSymbolicLink())throw Error('Fixed calculation source is unavailable');
 const source=await readFile(script,'utf8'),sourceHash=sha(source),inputHash=sha(JSON.stringify(data)),recordFile=join(root,'calibration-record.json'),figureFile=join(root,'calibration.vl.json');
 return withFileLock(join(root,'calibration.lock'),async()=>{
  let old;try{old=JSON.parse(await readFile(recordFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(old){
   if(old.inputSha256!==inputHash||old.sourceSha256!==sourceHash)throw Error('Existing calculation has a different input or algorithm');
   const {recordSha256,...body}=old,fig=await readFile(figureFile),savedSource=await readFile(join(root,'calibration-source.py'));
   let chart;try{chart=JSON.parse(fig.toString('utf8'));}catch{throw Error('Saved calculation evidence changed');}
   if(recordSha256!==sha(JSON.stringify(body))||sha(JSON.stringify(old.input))!==inputHash||old.algorithm!=='equal-width-binary-calibration-v1'||old.seed!==null||old.randomness!=='none'||old.source!=='calibration-source.py'||old.figure!=='calibration.vl.json'||old.figureType!=='vega-lite-spec-not-rendered'||typeof old.environment?.python!=='string'||!/^3\./.test(old.environment.python)||!['Darwin','Linux'].includes(old.environment?.system)||old.environment?.limits?.cpuSeconds!==3||!Number.isFinite(old.environment?.limits?.addressSpaceLimitBytes)||old.environment.limits.addressSpaceLimitBytes<=0||sha(fig)!==old.figureSha256||sha(savedSource)!==old.sourceSha256||sha(JSON.stringify(old.output))!==old.outputSha256||chart?.$schema!=='https://vega.github.io/schema/vega-lite/v5.json'||JSON.stringify(chart.layer?.[1]?.data?.values)!==JSON.stringify(old.output?.bins))throw Error('Saved calculation evidence changed');
   return {...old,reused:true};
  }
  const value=await compute(data,source,{python:'/usr/bin/python3',timeoutMs});
  if(value?.result?.algorithm!=='equal-width-binary-calibration-v1'||value.result.sampleCount!==data.predictedProbabilities.length||value.chartSpec?.$schema!=='https://vega.github.io/schema/vega-lite/v5.json'||!Array.isArray(value.chartSpec.layer)||JSON.stringify(value.chartSpec.layer?.[1]?.data?.values)!==JSON.stringify(value.result.bins)||!value.environment?.python||value.environment?.limits?.cpuSeconds!==3)throw Error('Calculation result failed validation');
  const figure=Buffer.from(JSON.stringify(value.chartSpec,null,2)+'\n'),record={version:1,algorithm:value.result.algorithm,seed:null,randomness:'none',input:data,inputSha256:inputHash,source:'calibration-source.py',sourceSha256:sourceHash,environment:value.environment,output:value.result,outputSha256:sha(JSON.stringify(value.result)),figure:'calibration.vl.json',figureType:'vega-lite-spec-not-rendered',figureSha256:sha(figure)};
  const complete={...record,recordSha256:sha(JSON.stringify(record))};
  await atomic(figureFile,figure);await atomic(join(root,'calibration-source.py'),source);await atomic(recordFile,JSON.stringify(complete,null,2)+'\n');return {...complete,reused:false};
 },{timeout:100});
}
