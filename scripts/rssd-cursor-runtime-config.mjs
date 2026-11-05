// Explicit local configuration only. Importing this module never starts work.
import {open,lstat,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createAutomaticRightsVerifier,createBoundOriginalSearch} from './rssd-original-rights-verifier.mjs';
import {searchOriginalImageLeads} from './rssd-original-first-provider.mjs';
import {createCommonsWindowSearch,createCommonsFallbackSearch} from './rssd-commons-window-search.mjs';
import {freezeImagePolicy} from './rssd-image-policy.mjs';
import {validImageDisclosures} from './rssd-image-disclosure.mjs';
const pending=message=>Object.assign(Error(message),{code:'image_pending'});
const absolute=(path,label)=>{if(typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path)throw pending('Invalid '+label);return path;};
async function readReference(item){
 const path=absolute(item?.path,'approved image reference');if(!/^[a-f0-9]{64}$/.test(item?.sha256||''))throw pending('Approved image reference hash missing');
 const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size<1||info.size>1125000||await realpath(path)!==path)throw pending('Approved image reference is unsafe');
 const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);let bytes;try{const actual=await handle.stat();if(actual.dev!==info.dev||actual.ino!==info.ino||actual.nlink!==1)throw pending('Approved image reference changed');bytes=await handle.readFile();if(bytes.length!==info.size||bytes.length>1125000)throw pending('Approved image reference changed');}finally{await handle.close();}
 if(createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw pending('Approved image reference changed');return {bytes};
}
export function validateCursorImageRuntimeConfiguration(value){
 if(value===undefined||value?.enabled===false)return;
 if(value?.enabled!==true||!value.references||typeof value.references!=='object'||Array.isArray(value.references))throw pending('Cursor image runtime configuration is invalid');
 absolute(value.runtimeIdentityPath,'pinned Cursor identity');
 for(const [siteId,item] of Object.entries(value.references)){if(!/^[a-zA-Z0-9-]{1,100}$/.test(siteId)||!item||typeof item!=='object')throw pending('Invalid site reference');absolute(item.path,'approved image reference');if(!/^[a-f0-9]{64}$/.test(item.sha256||''))throw pending('Approved image reference hash missing');}
 if(value.policies!==undefined){
  if(!value.policies||typeof value.policies!=='object'||Array.isArray(value.policies))throw pending('Invalid site image policies');
  for(const [siteId,policy] of Object.entries(value.policies)){
   if(!/^[a-zA-Z0-9-]{1,100}$/.test(siteId)||!policy||!Array.isArray(policy.skills)||!policy.skills.length||!Array.isArray(policy.references)||!validImageDisclosures(policy.disclosures))throw pending('Invalid site image policy');
   for(const item of [...policy.skills,...policy.references]){absolute(item?.path,'image policy file');if(!/^[a-f0-9]{64}$/.test(item?.sha256||''))throw pending('Image policy file hash missing');}
  }
 }
 createAutomaticRightsVerifier({trustedSources:value.trustedSources??[]});
 const c=value.commonsFallback;
 if(c!==undefined&&c?.enabled!==false){
  if(c?.enabled!==true||!Number.isSafeInteger(c.maxPages)||c.maxPages<1||c.maxPages>5||!Number.isSafeInteger(c.pageSize)||c.pageSize<1||c.pageSize>20)throw pending('Explicit bounded Commons window required');
  try{createCommonsWindowSearch({timeoutMs:c.timeoutMs??8000,retries:c.retries??1});createCommonsFallbackSearch({primary:async()=>{},primaryTimeoutMs:c.primaryTimeoutMs??8000});}catch{throw pending('Invalid Commons search limits');}
 }
}
export async function configuredCursorImageRuntime(value,{registrarFactory,search,commonsRead}={}){
 validateCursorImageRuntimeConfiguration(value);if(value===undefined||value?.enabled===false)return undefined;
 if(typeof registrarFactory!=='function')throw pending('Licensed-image registrar is not configured');
 const identityPath=absolute(value.runtimeIdentityPath,'pinned Cursor identity'),info=await lstat(identityPath);
 if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>100000||(info.mode&0o077)!==0||await realpath(identityPath)!==identityPath)throw pending('Pinned Cursor identity is unsafe');
 const pin=await open(identityPath,constants.O_RDONLY|constants.O_NOFOLLOW);let identityBytes;try{const actual=await pin.stat();if(actual.dev!==info.dev||actual.ino!==info.ino||actual.nlink!==1)throw pending('Pinned Cursor identity changed');identityBytes=await pin.readFile();if(identityBytes.length!==info.size||identityBytes.length>100000)throw pending('Pinned Cursor identity changed');}finally{await pin.close();}
 const expectedRuntime=JSON.parse(identityBytes.toString('utf8'));
 if(expectedRuntime?.version!==1||!expectedRuntime.files)throw pending('Pinned Cursor identity is invalid');
 const review=createAutomaticRightsVerifier({trustedSources:value.trustedSources??[]}),primary=search||searchOriginalImageLeads,originalSearch=createBoundOriginalSearch(primary);
 const c=value.commonsFallback,window=c?.enabled===true?{provider:'wikimedia-commons',maxPages:c.maxPages,pageSize:c.pageSize}:undefined;
 let boundSearch=originalSearch;
 if(window){
  const commons=createCommonsWindowSearch({timeoutMs:c.timeoutMs??8000,retries:c.retries??1,...(commonsRead?{read:commonsRead}:{})});
  const boundedFallback=createCommonsFallbackSearch({primary:({scope,signal})=>primary({query:scope.imageSearchQuery,signal}),commons,primaryTimeoutMs:c.primaryTimeoutMs??8000});
  // Previously frozen requests have no window and retain their old search.
  boundSearch=args=>args.scope?.commonsSearchWindow?boundedFallback(args):originalSearch(args);
 }
 return {expectedRuntime,resolveReference:async({siteId})=>{const item=value.references[siteId];if(!item)throw pending('Approved site reference is not configured');return readReference(item);},resolveImagePolicy:args=>freezeImagePolicy({...args,configuration:value.policies?.[args.siteId]}),originalSource:{search:boundSearch,review,registrarFactory,...(window?{commonsSearchWindow:window}:{})}};
}
