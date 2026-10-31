import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateAuthorization,authorizationSummary} from '../../contracts/site-authorization.mjs';
import {authorizationTarget,registerAuthorizedSite} from '../../scripts/space-registry.mjs';
import {verifySiteConnection} from './runtime/verify-website.mjs';
import {validateSite} from '../../scripts/site-config.mjs';

export async function verifyAuthorization(data,input,fetcher=fetch){
  const authorization=validateAuthorization(input);
  const target=authorizationTarget(data,authorization.site);
  await verifySiteConnection(authorization.site,authorization.credential.token,fetcher);
  // An existing space may still use an explicitly supported old domain. Verify
  // that endpoint too, without changing its configuration or publication state.
  if(target.site.origin!==authorization.site.origin)await verifySiteConnection(target.site,authorization.credential.token,fetcher);
  return {...authorizationSummary(authorization),site:target.site,existing:target.existing,connected:true};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    let input='';process.stdin.setEncoding('utf8');for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>96*1024)throw Error('授权请求过大');if(input.endsWith('\n'))break;}
    let request;try{request=JSON.parse(input);}catch{throw Error('授权请求格式无效');}
    const {method,params}=request;
    if(typeof params?.dataDirectory!=='string')throw Error('缺少本地空间目录');
    const result=method==='verify'?await verifyAuthorization(params.dataDirectory,params.authorization):method==='verify_existing'?await verifySiteConnection(validateSite(params.site),params.token):method==='register'?registerAuthorizedSite(params.dataDirectory,params.site):null;
    if(!result)throw Error('未知授权操作');
    process.stdout.write(JSON.stringify(result));
  }catch(error){process.stderr.write(error.message);process.exitCode=1;}
}
