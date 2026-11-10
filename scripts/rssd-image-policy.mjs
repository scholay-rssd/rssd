// Explicit, private per-job image policy. Existing image requests never gain
// this snapshot retroactively; callers freeze it only before a new request.
import {lstat,open,readFile,realpath} from 'node:fs/promises';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import protocol from '../contracts/rssd-v1.cjs';
import {withFileLock} from './editorial-lock.mjs';
import {writeCenterJson} from './rssd-center-client.mjs';
import {validImageDisclosures} from './rssd-image-disclosure.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const pending=message=>Object.assign(Error(message),{code:'image_pending'});
async function entry(item){
 if(!item||typeof item.path!=='string'||!isAbsolute(item.path)||resolve(item.path)!==item.path||!/^[a-f0-9]{64}$/.test(item.sha256||''))throw pending('Image policy file or hash is not configured');
 const stat=await lstat(item.path).catch(()=>{throw pending('Image policy file is unavailable');});
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>60000||await realpath(item.path)!==item.path)throw pending('Image policy file is unsafe');
 const handle=await open(item.path,constants.O_RDONLY|constants.O_NOFOLLOW);let bytes;
 try{const actual=await handle.stat();if(actual.dev!==stat.dev||actual.ino!==stat.ino||!actual.isFile())throw pending('Image policy file changed');bytes=await handle.readFile();}finally{await handle.close();}
 if(bytes.length!==stat.size||sha(bytes)!==item.sha256)throw pending('Image policy file changed');
 const content=bytes.toString('utf8');if(!Buffer.from(content).equals(bytes))throw pending('Image policy encoding is invalid');
 return {path:item.path,sha256:item.sha256,content};
}
export function validateImagePolicySnapshot(snapshot,{siteId,workspaceId,referenceSha256}={}){
 const {snapshotHash,...body}=snapshot||{};
 if(body.version!==1||body.siteId!==siteId||body.workspaceId!==workspaceId||body.referenceSha256!==referenceSha256||!/^[a-f0-9]{64}$/.test(referenceSha256||'')||!Array.isArray(body.skills)||!body.skills.length||!Array.isArray(body.references)||[...body.skills,...body.references].some(x=>!x||typeof x.path!=='string'||typeof x.content!=='string'||sha(Buffer.from(x.content))!==x.sha256)||(body.disclosures!==undefined&&!validImageDisclosures(body.disclosures))||protocol.hash(body)!==snapshotHash)throw pending('Original image policy snapshot is invalid');
 return snapshot;
}
export async function freezeImagePolicy({directory,siteId,workspaceId,referenceSha256,configuration}){
 if(!siteId||!workspaceId||!/^[a-f0-9]{64}$/.test(referenceSha256||''))throw pending('Site image identity or brand reference is invalid');
 const file=join(directory,'image-policy.json');
 return withFileLock(file+'.lock',async()=>{
  let old;try{old=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw pending('Original image policy snapshot cannot be read');}
  if(old)return validateImagePolicySnapshot(old,{siteId,workspaceId,referenceSha256});
  if(!configuration||!Array.isArray(configuration.skills)||!configuration.skills.length||!Array.isArray(configuration.references)||!validImageDisclosures(configuration.disclosures))throw pending('Site image skill, references and AI disclosures are not configured');
  const skills=[],references=[];for(const item of configuration.skills)skills.push(await entry(item));for(const item of configuration.references)references.push(await entry(item));
  const paths=new Set(references.map(x=>x.path));
  for(const skill of skills)for(const match of skill.content.matchAll(/\]\(([^)]+\.md)\)/g)){
   const target=match[1];if(!/^(?:https?:|#)/i.test(target)&&!paths.has(resolve(dirname(skill.path),target)))throw pending('Site image skill references are not fully configured');
  }
  const body={version:1,siteId,workspaceId,referenceSha256,skills,references,disclosures:structuredClone(configuration.disclosures)},snapshot={...body,snapshotHash:protocol.hash(body)};
  await writeCenterJson(file,snapshot);return validateImagePolicySnapshot(snapshot,{siteId,workspaceId,referenceSha256});
 });
}
