// One online baseline per writing session. A saved baseline survives a resume;
// a new session never silently substitutes a workspace's older rule files.
import {readFile,access,mkdir,writeFile,rename} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import contract from '../contracts/writing-defaults-v1.cjs';
import {withFileLock} from './editorial-lock.mjs';
import {centerHome} from '../desktop/scripts/runtime/center-home.mjs';
function centerOrigin(value){const u=new URL(value);if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||!(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw Error('Invalid writing Center origin');return u.origin;}
export async function writeWritingJson(file,value){await mkdir(dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});await rename(tmp,file);}

const unavailable=e=>Object.assign(Error('无法取得线上写作默认配置；请恢复 Center 连接后继续，未使用旧本地尺度代替。'+(e?.code?' ['+e.code+']':'')),{code:'writing_defaults_unavailable',cause:e});
export async function writingConnectionHome(env=process.env){
 const primary=centerHome(env);
 try{await access(join(primary,'connection.json'));return primary;}catch(e){if(e.code!=='ENOENT')throw e;}
 if(!env.RSSD_CENTER_HOME&&!env.SCHOLAY_GLOBAL_APP_DATA&&!env.SCHOLAY_AGENT_HOME&&process.platform==='darwin'){
  const native=join(homedir(),'Library/Application Support/com.thomas.papr/center');
  try{await access(join(native,'connection.json'));return native;}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 return primary;
}
export function createWritingDefaultsReader({origin,fetcher=fetch,timeoutMs=20000}){
 origin=centerOrigin(origin);
 const request=async suffix=>{
  const response=await fetcher(origin+'/api/rssd/public/v1/writing-defaults'+suffix,{method:'GET',redirect:'error',headers:{Accept:'application/json'},signal:AbortSignal.timeout(timeoutMs)});
  if(!response.ok)throw Object.assign(Error('Writing defaults request failed'),{code:'writing_defaults_http_'+response.status});
  const contentLength=Number(response.headers.get('content-length')||0);if(contentLength>1000000)throw Error('Writing defaults response is too large');
  const text=await response.text();if(Buffer.byteLength(text)>1000000)throw Error('Writing defaults response is too large');return JSON.parse(text);
 };
 const id=value=>{if(typeof value!=='string'||!/^[a-z0-9][a-z0-9-]{0,79}$/.test(value))throw Error('Invalid writing defaults scope');return encodeURIComponent(value);};
 return {origin,writingDefaultCatalog:async()=>contract.catalog(await request('')),writingDefaults:(workspaceId,sectionId)=>request('/'+id(workspaceId)+'/'+id(sectionId))};
}
export async function configuredWritingDefaultsReader({home,origin,env=process.env}={}){
 if(!origin){const value=JSON.parse(await readFile(join(home||await writingConnectionHome(env),'connection.json'),'utf8'));origin=value.origin;}
 // This endpoint serves only the already-public GitHub catalog. Reading it
 // never requires copying or exposing a device token or native keychain item.
 return createWritingDefaultsReader({origin});
}
export async function onlineWritingDefaults({client,workspaceId,sectionId,siteId}){
 try{
  if(typeof client?.writingDefaults!=='function')throw Object.assign(Error('Writing defaults API is unavailable'),{code:'writing_defaults_api_unavailable'});
  return contract.snapshot(await client.writingDefaults(workspaceId,sectionId),{workspaceId,sectionId,...(siteId?{siteId}:{})});
 }catch(e){throw unavailable(e);}
}
export async function freezeWritingDefaults({directory,client,workspaceId,sectionId,siteId,binding={},providedBaseline}){
 const file=join(directory,'writing-defaults.json');
 return withFileLock(file+'.lock',async()=>{
  let previous;try{previous=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Object.assign(Error('原写作基线无法读取，未替换快照'),{code:'writing_defaults_conflict',cause:e});}
  if(previous){
   if(previous.schemaVersion!==1||previous.origin!==client.origin||contract.canonical(previous.binding)!==contract.canonical(binding))throw Object.assign(Error('原写作基线的设备连接或任务绑定已变化'),{code:'writing_defaults_conflict'});
   contract.snapshot(previous.baseline,{workspaceId,sectionId,...(siteId?{siteId}:{})});
   if(providedBaseline&&previous.baseline.hash!==contract.snapshot(providedBaseline,{workspaceId,sectionId}).hash)throw Object.assign(Error('原任务线上基线已变化，未替换快照'),{code:'writing_defaults_conflict'});
   return previous;
  }
  const baseline=providedBaseline?contract.snapshot(providedBaseline,{workspaceId,sectionId,...(siteId?{siteId}:{})}):await onlineWritingDefaults({client,workspaceId,sectionId,siteId});
  const record={schemaVersion:1,origin:client.origin,binding:structuredClone(binding),fetchedAt:new Date().toISOString(),acquiredVia:providedBaseline?'center-claim':'center-read',baseline};
  await writeWritingJson(file,record);return record;
 });
}
export async function authoringWritingDefaults({workspaceId,sectionId,siteId,directory,binding={},home,client,local={},providedBaseline}){
 if(!client){try{client=await configuredWritingDefaultsReader({home});}catch(e){throw unavailable(e);}}
 const record=directory?await freezeWritingDefaults({directory,client,workspaceId,sectionId,siteId,binding,providedBaseline}):{origin:client.origin,fetchedAt:new Date().toISOString(),acquiredVia:'center-read',baseline:await onlineWritingDefaults({client,workspaceId,sectionId,siteId})};
 return {...contract.compose(record.baseline,local),retrieval:{origin:record.origin,fetchedAt:record.fetchedAt,acquiredVia:record.acquiredVia}};
}
export async function managedWritingWorkspace(root){try{return JSON.parse(await readFile(join(root,'.local/writing-defaults/managed.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
export async function workspaceWritingContext(root,sectionId,{directory,local,client}={}){
 const managed=await managedWritingWorkspace(root);if(!managed)return null;
 if(!sectionId)throw Object.assign(Error('开始写作前选择栏目并拉取统一规则'),{code:'writing_defaults_scope'});
 if(!local){try{local=JSON.parse(await readFile(join(root,'.local/writing-defaults/adjustments.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;local={};}}
 client=client||createWritingDefaultsReader({origin:managed.origin});
 return authoringWritingDefaults({workspaceId:managed.workspaceId,siteId:managed.siteId,sectionId,client,local,directory,binding:{workspaceId:managed.workspaceId,sectionId,kind:'workspace-authoring'}});
}

// Unbound local exploration is distinct from an installed site's workspace.
// Existing drafts remain readable without changing their text or user mounts.
export async function boundWritingWorkspace(root,env=process.env){
 try{await access(join(root,'.site.json'));return true;}catch(e){if(e.code!=='ENOENT')throw e;}
 if(env.SCHOLAY_EDITORIAL_ROOT&&resolve(env.SCHOLAY_EDITORIAL_ROOT)===resolve(root))return true;
 const data=env.SCHOLAY_GLOBAL_APP_DATA||env.SCHOLAY_AGENT_HOME||(process.platform==='darwin'?join(homedir(),'Library/Application Support/com.thomas.papr'):join(homedir(),'.config/scholay-today'));
 try{const preference=JSON.parse(await readFile(join(data,'editorial-workspace.json'),'utf8'));return typeof preference.path==='string'&&resolve(preference.path)===resolve(root);}catch(e){if(e.code!=='ENOENT')throw e;return false;}
}
