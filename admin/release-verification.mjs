import http from 'node:http';
import https from 'node:https';
import {performance} from 'node:perf_hooks';
import {byteHash} from '../web/engine/theme-homepage.mjs';
import {digest} from './model.mjs';

// One serial connection per verification, including TLS when resolving locally.
// Read every manifest file; connection reuse must not weaken release validation.
export async function verifyLive(manifest,origin,resolveLocal,{timeoutMs=20000,maxBytes=32*1024*1024}={}) {
  const base=new URL(origin);
  if(!['http:','https:'].includes(base.protocol)||base.username||base.password)throw Error('发布站点地址无效');
  const transport=base.protocol==='https:'?https:http;
  const agent=new transport.Agent({keepAlive:true,maxSockets:1,maxFreeSockets:1});
  const started=performance.now();let files=0,bytes=0;
  const read=url=>new Promise((resolve,reject)=>{
    let failed=false;
    const fail=error=>{failed=true;clearTimeout(timer);reject(error);request.destroy();};
    const options={agent,headers:{'Accept-Encoding':'identity'}};
    // Keep the public Host and TLS server name, replacing only DNS resolution.
    // No environment proxy is used, matching the old curl --noproxy behavior.
    if(resolveLocal)options.lookup=(_host,options,callback)=>callback(null,...(options.all?[[{address:'127.0.0.1',family:4}]]:['127.0.0.1',4]));
    const request=transport.get(url,options,response=>{
      if(response.statusCode!==200){fail(Error('线上文件返回 HTTP '+response.statusCode+'：'+url.pathname));return;}
      const chunks=[];let size=0;
      response.on('data',chunk=>{
        size+=chunk.length;
        if(size>maxBytes){fail(Error('线上文件超过校验大小限制：'+url.pathname));return;}
        chunks.push(chunk);
      });
      response.on('end',()=>{if(!failed){clearTimeout(timer);resolve(Buffer.concat(chunks,size));}});
      response.on('error',fail);
    });
    const timer=setTimeout(()=>fail(Error('线上文件校验超时：'+url.pathname)),timeoutMs);
    request.on('error',fail);
    request.on('close',()=>clearTimeout(timer));
  });
  try{
    for(const file of new Set(['release.json',...Object.keys(manifest.hashes||{}),...Object.keys(manifest.byteHashes||{})])){
      const url=new URL('/'+file,base);
      if(!file||file.startsWith('/')||file.includes('\\')||file.split('/').some(p=>p==='.'||p==='..')||url.origin!==base.origin||url.search||url.hash)throw Error('发布文件路径无效：'+file);
      const data=await read(url);files++;bytes+=data.length;
      if(file==='release.json'){
        const live=JSON.parse(data.toString('utf8'));
        if(['jobId','snapshotHash','release'].some(key=>live[key]!==manifest[key]))throw Error('线上版本标记不一致');
      }else if(manifest.byteHashes?.[file]?byteHash(data)!==manifest.byteHashes[file]:digest(data.toString('utf8'))!==manifest.hashes[file])throw Error('线上文件校验失败：'+file);
    }
    return {files,bytes,durationMs:Math.round(performance.now()-started)};
  }finally{agent.destroy();}
}
