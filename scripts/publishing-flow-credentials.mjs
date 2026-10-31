// Cloud continuations retain the exact submitter, independently of workspace
// defaults. Only the trusted queue callback supplies a token file; plans and
// incoming article packets never select the path read by a running worker.
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,readFile,rename,rm} from 'node:fs/promises';
import {dirname,isAbsolute,join} from 'node:path';
import {withFileLock} from './editorial-lock.mjs';
import {isPrivateFile,protectPrivateFile} from './private-file.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const failure=()=>Object.assign(Error('Original continuation credential is unavailable or changed; review required'),{code:'FLOW_CREDENTIAL',statusCode:409});
const tokenPath=(root,id)=>{if(!/^[a-f0-9]{40}$/.test(id||''))throw failure();return join(root,'.local/publishing-flow/jobs',id,'website-token');};
async function checkedToken(file,credentialId){
 try{
  if(!isAbsolute(file||'')||!/^[a-f0-9]{64}$/.test(credentialId||'')||!await isPrivateFile(file))throw failure();
  const token=(await readFile(file,'utf8')).trim();
  if(!token||token.length>4096||digest(token)!==credentialId)throw failure();return token;
 }catch{throw failure();}
}
export async function freezeFlowCredential(root,id,{credentialId,tokenFile}){
 const token=await checkedToken(tokenFile,credentialId),file=tokenPath(root,id);
 await mkdir(dirname(file),{recursive:true,mode:0o700});
 return withFileLock(file+'.lock',async()=>{
  try{await readFile(file);await checkedToken(file,credentialId);return;}catch(error){if(error.code!=='ENOENT')throw error;}
  const temporary=file+'.'+randomUUID()+'.tmp';
  try{
   const handle=await open(temporary,'wx',0o600);
   try{await protectPrivateFile(temporary);await handle.writeFile(token+'\n');await handle.sync();}finally{await handle.close();}
   await rename(temporary,file);
   if(process.platform!=='win32'){const parent=await open(dirname(file),'r');try{await parent.sync();}finally{await parent.close();}}
  }finally{await rm(temporary,{force:true});}
 });
}
export async function flowCredential(root,plan,{required=false}={}){
 if(plan?.publicationCredential===undefined){if(required)throw failure();return null;}
 return checkedToken(tokenPath(root,plan.id),plan.publicationCredential);
}

// The transport queue may commit its completion only after the frozen flow is
// durable too. Flush file contents first, then each newly created directory
// entry from the job/source leaves back through .local to the workspace root.
// Windows cannot open directories for fsync; its files are still flushed.
export async function flushCloudFlow(root,id,sourceKey,{openFile=open,platform=process.platform}={}){
 if(!isAbsolute(root)||!/^[a-f0-9]{40}$/.test(sourceKey||''))throw Error('Invalid cloud continuation durability paths');
 const token=tokenPath(root,id),job=dirname(token),flow=join(root,'.local/publishing-flow'),sources=join(flow,'sources');
 async function flush(file,flags){const handle=await openFile(file,flags);try{await handle.sync();}finally{await handle.close();}}
 for(const file of [token,join(job,'plan.json'),join(sources,sourceKey+'.json')])await flush(file,platform==='win32'?'r+':'r');
 if(platform!=='win32')for(const directory of [job,sources,join(flow,'jobs'),flow,join(root,'.local'),root])await flush(directory,'r');
}
