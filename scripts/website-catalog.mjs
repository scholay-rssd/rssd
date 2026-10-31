import {readFile,rm} from 'node:fs/promises';
import {atomicJson} from './editorial-sync.mjs';

// Only catalog GETs use retries. Publishing and version-sensitive operations
// retain their existing single-request / receipt recovery protocol.
export function transientReadError(error){
 return [408,500,502,503,504].includes(error?.statusCode)||
  ['TimeoutError','AbortError'].includes(error?.name)||
  ['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EAI_AGAIN','ENOTFOUND','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT'].includes(error?.cause?.code||error?.code)||
  error instanceof TypeError&&error.message==='fetch failed';
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const partialNotice=count=>`已读取 ${count} 条作品，列表尚未完整；连接恢复后将继续读取。`;

export async function readWebsiteCatalog({api,all=false,locale,file,identity,wait=pause}){
 let items=[],after=0,generation,retries=0,restarted=false;
 const signal=AbortSignal.timeout(120000);
 if(file){
  let saved;try{saved=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
  if(saved?.identity===identity&&Date.now()-saved.updatedAt<24*60*60*1000&&Array.isArray(saved.items)&&saved.items.length<=30000&&Number.isSafeInteger(saved.after)&&saved.after>0&&Number.isSafeInteger(saved.generation)){
   ({items,after,generation}=saved);
  }
 }
 try{
  for(let page=0;page<400;page++){
   let result;
   for(let attempt=0;;attempt++){
    try{
     signal.throwIfAborted();
     result=await api('/catalog?limit=80&after='+after+(all?'&scope=all':'')+(locale?'&locale='+encodeURIComponent(locale):'')+(generation===undefined?'':'&generation='+generation),undefined,signal);
     break;
    }catch(error){
     // A resumed generation may have changed. Discard the checkpoint before
     // starting once from page one, never merge pages from different versions.
     if(error.statusCode===409&&!restarted){
      restarted=true;items=[];after=0;generation=undefined;
      if(file)await rm(file,{force:true});
      await wait(1000);continue;
     }
     if(signal.aborted||error.retryAfterMs>0||!transientReadError(error)||attempt>=2||retries>=4)throw error;
     retries++;await wait(1000*2**attempt+Math.floor(Math.random()*250));
    }
   }
   if(!Array.isArray(result.items)||result.items.length>80||!Number.isSafeInteger(result.generation))throw Error('官网数据库目录格式异常，原缓存保留');
   generation??=result.generation;
   if(generation!==result.generation)throw Error('官网数据在分页期间变化，请重新刷新');
   if(all&&result.scope!=='all')throw Error('官网服务尚不支持完整作品目录，请先更新后台服务');
   if(result.next!==null&&(!Number.isSafeInteger(result.next)||result.next<=after))throw Error('官网分页游标无效');
   if(items.length+result.items.length>30000)throw Error('官网目录超过本次读取上限，原缓存保留');
   items.push(...result.items);
   if(result.next===null){
    if(file)await rm(file,{force:true});
    return {version:2,scope:all?'all':'published',source:'server-database',items,updatedAt:new Date().toISOString()};
   }
   after=result.next;
   if(file)await atomicJson(file,{identity,items,after,generation,updatedAt:Date.now()});
  }
  throw Error('官网目录超过本次读取上限，原缓存保留');
 }catch(error){
  if(items.length&&(transientReadError(error)||error.statusCode===429))error.partialValue={version:2,scope:all?'all':'published',source:'server-database',items,partial:true,notice:partialNotice(items.length),updatedAt:new Date().toISOString()};
  throw error;
 }
}
