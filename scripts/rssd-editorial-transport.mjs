import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {centerHome} from '../desktop/scripts/runtime/center-home.mjs';
import {createCenterClient,centerOrigin} from './rssd-center-client.mjs';

// Selecting a center is durable. Missing credentials, revocation, an offline
// center or a migration fence must never silently select the previous writer.
export function createEditorialCenterTransport({site,directory=centerHome(),fetcher=fetch,token=process.env.RSSD_CENTER_TOKEN}={}){
  let verified;
  const config=()=>readFile(join(directory,'connection.json'),'utf8').then(text=>{
    let value;try{value=JSON.parse(text);}catch{throw Error('中心连接配置无法读取，请保留原稿并检查中心连接。');}
    return {...value,origin:centerOrigin(value.origin)};
  }).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  const client=async()=>{
    const connection=await config();
    if(!connection)return null;
    try{return createCenterClient({origin:connection.origin,token:token||connection.token,fetcher});}
    catch{throw Error('已选择 RSSD 中心，请先检查中心设备凭据；稿件和原请求仍保留在本机。');}
  };
  const request=async(path,options)=>{
    const connected=await client();
    if(!connected)throw Error('RSSD center is not configured');
    try{return await connected.request(path,options);}
    catch(error){error.statusCode=error.status||0;throw error;}
  };
  const verify=async({write=false}={})=>{
    const connection=await config();
    const key=JSON.stringify([connection?.origin,connection?.identity?.orgId,token||connection?.token]);
    if(!write&&verified?.key===key&&Date.now()-verified.at<30000)return verified.value;
    if(connection?.identity?.orgId){
      const identity=await request('/identity');
      if(identity.orgId!==connection.identity.orgId)throw Object.assign(Error('中心设备凭据属于另一个组织，请重新核对连接配置'),{statusCode:403});
    }
    const registry=await request('/registry');
    const workspace=registry.workspaces?.find(item=>item.id===site.spaceId);
    if(!workspace||workspace.siteId!==site.id)throw Object.assign(Error('中心工作空间、站点身份或设备授权与当前稿件不匹配'),{statusCode:403});
    if(write&&workspace.writable===false)throw Object.assign(Error('此站点正在迁移，中心暂不能接收修改；请保留本机稿件，待交接完成后提交。'),{statusCode:409,code:'migration_staged'});
    const descriptor=await request('/editorial/'+encodeURIComponent(site.spaceId)+'/site');
    if(descriptor.centerManaged!==true||descriptor.protocol!=='scholay-content'||descriptor.version!==1||descriptor.siteId!==site.id||descriptor.spaceId!==site.spaceId||descriptor.origin!==site.origin)throw Object.assign(Error('中心发布接口的站点身份不匹配'),{statusCode:403});
    const value={workspace,descriptor};verified={key,at:Date.now(),value};return value;
  };
  return {
    active:async()=>Boolean(await config()),
    cacheIdentity:async()=>{const value=await config();return value?JSON.stringify([value.origin,value.identity?.orgId||null,site.spaceId]):null;},
    connection:async()=>{const value=await config();return value?{configured:true,origin:site.origin,centerOrigin:value.origin,centerManaged:true}:null;},
    verify,
    request:async(path,data,signal)=>{
      await verify({write:data!==undefined});
      if(typeof path!=='string'||!path.startsWith('/')||path.startsWith('//')||/[\\#]/.test(path)||/\/(?:\.{1,2})(?:\/|\?|$)|%2e|%2f/i.test(path))throw Error('Invalid center editorial path');
      return request('/editorial/'+encodeURIComponent(site.spaceId)+path,{method:data===undefined?'GET':'POST',...(data===undefined?{}:{body:data}),signal});
    }
  };
}
