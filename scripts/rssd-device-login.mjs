import {centerOrigin,CenterError} from './rssd-center-client.mjs';
export async function authorizationRequest(origin,path,body,{fetcher=fetch,signal}={}){
 const response=await fetcher(centerOrigin(origin)+'/api/rssd/v1/auth/'+path,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});
 const value=await response.json();if(!response.ok)throw new CenterError(value.message||'Authorization failed',{status:response.status,code:value.code});return value;
}
export async function deviceLogin({origin,name='RSSD Linux',emit,signal,fetcher=fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 origin=centerOrigin(origin);const request=await authorizationRequest(origin,'start',{mode:'device',name},{fetcher,signal});
 if(new URL(request.verificationUriComplete).origin!==origin)throw Error('Authorization address does not match the center');
 emit({state:'authorization_required',verificationUri:request.verificationUri,verificationUriComplete:request.verificationUriComplete,userCode:request.userCode,expiresIn:request.expiresIn});
 const deadline=Date.now()+Math.min(request.expiresIn,600)*1000;let interval=Math.max(5,request.interval||5);
 while(Date.now()<deadline){
  signal?.throwIfAborted();await sleep(interval*1000);signal?.throwIfAborted();
  try{return await authorizationRequest(origin,'token',{grantType:'device_code',deviceCode:request.deviceCode},{fetcher,signal});}
  catch(error){if(error.code==='authorization_pending')continue;if(error.code==='slow_down'){interval+=5;continue;}throw error;}
 }
 throw new CenterError('Authorization expired; start login again',{code:'expired_token'});
}
