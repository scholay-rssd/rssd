import {createServer} from 'node:http';
import {CLOUD_QUEUE_PROTOCOL,CLOUD_PACKET_BYTES} from './cloud-queue.mjs';

const fail=(message,statusCode)=>{throw Object.assign(Error(message),{statusCode});};
async function body(request){
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']||''))fail('JSON request required',415);
 const size=Number(request.headers['content-length']);if(size>CLOUD_PACKET_BYTES+4096)fail('Request is too large',413);
 const chunks=[];let bytes=0;
 for await(const chunk of request){bytes+=chunk.length;if(bytes>CLOUD_PACKET_BYTES+4096)fail('Request is too large',413);chunks.push(chunk);}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('Invalid JSON request',400);}
}
export function createCloudQueueServer({queue,bodyTimeoutMs=15000,basePath=''}){
 if(basePath&&!/^\/[a-zA-Z0-9/_-]+$/.test(basePath))throw Error('Invalid queue HTTP base path');
 const server=createServer(async(request,response)=>{
  const send=(status,value)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(value));};
  try{
   const url=new URL(request.url,'http://queue.local');if(basePath&&url.pathname.startsWith(basePath+'/'))url.pathname=url.pathname.slice(basePath.length);
   if(request.method==='GET'&&url.pathname==='/health')return send(200,{protocol:CLOUD_QUEUE_PROTOCOL,version:1,status:'ok'});
   const siteId=request.headers['x-scholay-site'];if(typeof siteId!=='string')fail('Site credential required',401);const principal=await queue.authorize(siteId,request.headers.authorization),scope={credentialId:principal.credentialId};
   if(request.method==='POST'&&url.pathname==='/v1/jobs'){
    let timer;const timed=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('Request body timed out'),{statusCode:408})),bodyTimeoutMs);});
    let input;try{input=await Promise.race([body(request),timed]);}finally{clearTimeout(timer);}
    if(input?.siteId!==siteId)fail('Body site differs from authenticated site',409);
    return send(202,await queue.enqueue(siteId,input.packet,{...scope,continuationOwner:input.continuationOwner}));
   }
   if(request.method==='GET'&&url.pathname==='/v1/jobs')return send(200,{jobs:await queue.list(siteId,scope)});
   const artifact=url.pathname.match(/^\/v1\/jobs\/([a-f0-9]{64})\/continuation-artifact$/);if(request.method==='GET'&&artifact)return send(200,await queue.continuationArtifact(siteId,artifact[1],scope));
   const recovery=url.pathname.match(/^\/v1\/jobs\/([a-f0-9]{64})\/recovery-packet$/);if(request.method==='GET'&&recovery)return send(200,await queue.recoveryPacket(siteId,recovery[1],scope));
   const match=url.pathname.match(/^\/v1\/jobs\/([a-f0-9]{64})$/);if(request.method==='GET'&&match)return send(200,await queue.get(siteId,match[1],scope));
   fail('Route not found',404);
  }catch(error){if(!response.headersSent)send(error.statusCode||500,{error:error.statusCode?error.message:'Queue execution error'});if(!request.complete)request.resume();}
 });
 server.requestTimeout=20000;server.headersTimeout=10000;server.keepAliveTimeout=5000;server.maxHeadersCount=32;server.maxRequestsPerSocket=100;server.maxConnections=128;return server;
}
