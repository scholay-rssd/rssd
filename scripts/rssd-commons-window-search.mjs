// Read-only, bounded Wikimedia Commons candidate search. Result metadata is
// never a rights determination; candidates require independent verification.
// `complete` means only that this configured window was examined. Callers must
// durably retain `coverage` (especially `continuation`) with the decision.
import {fetchExactRightsBytes} from './rssd-original-rights-verifier.mjs';

const endpoint='https://commons.wikimedia.org/w/api.php';
const supported=new Set(['image/jpeg','image/png','image/webp']);
function text(x,max){return typeof x==='string'&&x.trim()===x&&x.length>0&&x.length<=max&&!/[\x00-\x1f]/.test(x);}
function url(x){try{const u=new URL(x);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&!u.port&&u.href===x;}catch{return false;}}
function checkWindow(scope){
 const w=scope?.commonsSearchWindow;
 if(!text(scope?.imageSearchQuery,200)||!w||w.provider!=='wikimedia-commons'||!Number.isSafeInteger(w.maxPages)||w.maxPages<1||w.maxPages>5||!Number.isSafeInteger(w.pageSize)||w.pageSize<1||w.pageSize>20)throw Error('Explicit bounded Commons search scope required');
 return w;
}
function continuation(input){
 if(input===undefined)return null;
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==2||!text(input.continue,200)||!Number.isSafeInteger(input.gsroffset)||input.gsroffset<0)throw Error('Unrecognized Commons continuation');
 return {gsroffset:input.gsroffset,continue:input.continue};
}
function timed(call,timeoutMs,signal){
 signal?.throwIfAborted();const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
 let timeout;return Promise.race([
  Promise.resolve().then(()=>call(combined)),
  new Promise((_,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(Error('Search request timed out'));},timeoutMs);}),
 ]).finally(()=>clearTimeout(timeout));
}

export function createCommonsWindowSearch({read=fetchExactRightsBytes,timeoutMs=8000,retries=1}={}){
 if(typeof read!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>20000||!Number.isSafeInteger(retries)||retries<0||retries>1)throw Error('Invalid Commons search limits');
 return async({scope,signal})=>{
  const w=checkWindow(scope),candidates=[],seen=new Set(),pages=[];
  let next=null,exhausted=false,excludedNonImage=0,excludedInvalid=0,duplicates=0;
  for(let index=0;index<w.maxPages;index++){
   signal?.throwIfAborted();const u=new URL(endpoint);
   for(const [key,value] of Object.entries({action:'query',format:'json',formatversion:'2',generator:'search',gsrnamespace:'6',gsrsearch:scope.imageSearchQuery,gsrlimit:String(w.pageSize),prop:'imageinfo',iiprop:'url|mime',...next}))u.searchParams.set(key,String(value));
   let bytes,lastError,attempts=0;
   for(let n=0;n<=retries;n++){
    attempts++;try{bytes=await timed(s=>read(u.href,{maxBytes:2*1024*1024,accept:'application/json',signal:s}),timeoutMs,signal);break;}catch(e){signal?.throwIfAborted();lastError=e;}
   }
   if(!bytes)throw Error('Commons page unavailable',{cause:lastError});
   let data;try{data=JSON.parse(bytes.toString('utf8'));}catch{throw Error('Invalid Commons response');}
   if(data?.error||!data||typeof data!=='object'||(!data.query&&!Object.hasOwn(data,'batchcomplete'))||data.query&&(!Array.isArray(data.query.pages)))throw Error('Invalid Commons response');
   const results=data.query?.pages||[];if(results.length>w.pageSize)throw Error('Commons page exceeded configured window');
   const requested=next;next=continuation(data.continue);
   if(next&&requested&&next.gsroffset<=requested.gsroffset)throw Error('Commons continuation did not advance');
   for(const p of results){
    const info=Array.isArray(p.imageinfo)&&p.imageinfo.length===1?p.imageinfo[0]:null;
    if(!info||!supported.has(info.mime)){excludedNonImage++;continue;}
    if(!Number.isSafeInteger(p.pageid)||p.pageid<1||p.ns!==6||!url(info.url)||!url(info.descriptionurl)||new URL(info.descriptionurl).origin!=='https://commons.wikimedia.org'||new URL(info.url).origin!=='https://upload.wikimedia.org'){excludedInvalid++;continue;}
    const id='commons:'+p.pageid;if(seen.has(id)){duplicates++;continue;}seen.add(id);candidates.push({id,url:info.url,sourceUrl:info.descriptionurl});
   }
   pages.push({requestContinuation:requested,responseContinuation:next,resultCount:results.length,attempts});
   if(!next){exhausted=true;break;}
  }
  return {complete:true,candidates,coverage:{provider:'wikimedia-commons',endpoint,query:scope.imageSearchQuery,namespace:6,types:[...supported],maxPages:w.maxPages,pageSize:w.pageSize,pages,exhausted,stop:exhausted?'api_exhausted':'window_limit',continuation:next,excludedNonImage,excludedInvalid,duplicates,meaning:'configured_window_only'}};
 };
}

// Primary is attempted for a bounded time; a failed or incomplete primary is
// followed by Commons. This only coordinates read-only searches and leaves
// rights review and generation decisions to the caller.
export function createCommonsFallbackSearch({primary,commons=createCommonsWindowSearch(),primaryTimeoutMs=8000}={}){
 if(typeof primary!=='function'||typeof commons!=='function'||!Number.isSafeInteger(primaryTimeoutMs)||primaryTimeoutMs<100||primaryTimeoutMs>20000)throw Error('Invalid primary image search');
 return async({scope,signal})=>{
  checkWindow(scope);let primaryFailure;
  try{
   const result=await timed(s=>primary({scope,signal:s}),primaryTimeoutMs,signal);
   if(result?.complete===true&&Array.isArray(result.candidates))return {...result,coverage:{selected:'primary',primary:result.coverage||null}};
   // A reachable but incomplete search remains pending; do not replace it
   // with a smaller window and accidentally present that as completed.
   return result;
  }catch(e){signal?.throwIfAborted();primaryFailure='unavailable';}
  const result=await commons({scope,signal});
  if(result?.complete!==true||!Array.isArray(result.candidates)||!result.coverage)throw Error('Commons search incomplete');
  return {...result,coverage:{selected:'commons',primary:{status:primaryFailure},commons:result.coverage}};
 };
}
