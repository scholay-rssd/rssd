import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {centerHome} from './center-home.mjs';
import {readCloudLabels} from './labels-cloud-read.mjs';
import {resolveLabelCloudCredential} from './labels-cloud-credential.mjs';

// Once this device has chosen a center, authentication/network failures must not
// silently read a different organization's legacy website cache.
export async function readConfiguredLabels({env=process.env,home=centerHome(env),fetcher=fetch,legacyCredential=resolveLabelCloudCredential}={}){
  let connection;
  try{connection=JSON.parse(await readFile(join(home,'connection.json'),'utf8'));}
  catch(error){if(error.code!=='ENOENT')throw Error('中心连接配置无法读取，请检查中心连接');}
  if(connection){
    if(typeof connection.origin!=='string'||!connection.origin)throw Error('中心连接配置无法读取，请检查中心连接');
    const token=env.RSSD_CENTER_TOKEN || (env.SCHOLAY_DESKTOP_RUNTIME==='1'?undefined:connection.token);
    return {source:'center',feed:await readCloudLabels(token,fetcher,{origin:connection.origin})};
  }
  const token=await legacyCredential({env});
  if(!token)return {source:'none',feed:null};
  return {source:'cloud',feed:await readCloudLabels(token,fetcher)};
}
