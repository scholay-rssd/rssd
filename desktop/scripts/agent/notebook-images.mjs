import http from 'node:http';
import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {BlockList,isIP} from 'node:net';
import {galleryList} from './image-library.mjs';

// Pin a public DNS answer for each hop; image retrieval must not reach local
// services or carry application credentials through a redirect.
// Match desktop/src-tauri/src/public_fetch.rs. Some configured transparent
// proxies map public names into 198.18/15; that range is not RFC1918.
const denied=new BlockList();
for(const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.168.0.0',16],['192.0.0.0',24],['224.0.0.0',4],['240.0.0.0',4]])denied.addSubnet(address,prefix,'ipv4');
for(const [address,prefix] of [['::',128],['::1',128],['fc00::',7],['fe80::',10],['ff00::',8]])denied.addSubnet(address,prefix,'ipv6');
export function publicAddress(address){const family=isIP(address);return !!family&&!denied.check(address,family===4?'ipv4':'ipv6')&&!/^::ffff:/i.test(address);}
export async function fetchPublicBytes(input,{maxBytes=12*1024*1024,accept='image/*',hops=0}={}){
 const url=new URL(input);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port&&!['80','443'].includes(url.port)||hops>4)throw Error('图片地址格式无效');
 const hostname=url.hostname.replace(/^\[|\]$/g,''),addresses=await lookup(hostname,{all:true});
 if(!addresses.length||addresses.some(x=>!publicAddress(x.address)))throw Error('只支持公开网络图片地址');
 return new Promise((resolve,reject)=>{
  const request=(url.protocol==='https:'?https:http).get(url,{headers:{Accept:accept,'User-Agent':'Today-Content-Workbench/1.0'},lookup:(_host,options,callback)=>{const item=addresses[0];options?.all?callback(null,[item]):callback(null,item.address,item.family);}},response=>{
   if([301,302,303,307,308].includes(response.statusCode)){response.resume();try{resolve(fetchPublicBytes(new URL(response.headers.location,url),{maxBytes,accept,hops:hops+1}));}catch(e){reject(e);}return;}
   if(response.statusCode!==200){response.resume();reject(Error(response.statusCode===429?'搜图服务暂时限流，请稍后重试':'图片服务响应 '+response.statusCode));return;}
   if(Number(response.headers['content-length'])>maxBytes){response.destroy();reject(Error('图片或搜索结果超过大小限制'));return;}
   let size=0;const chunks=[];response.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){response.destroy(Error('图片或搜索结果超过大小限制'));return;}chunks.push(chunk);});response.on('error',reject);response.on('end',()=>resolve(Buffer.concat(chunks)));
  });
  const timeout=setTimeout(()=>request.destroy(Error('图片服务响应超时，请重试')),20000);request.on('close',()=>clearTimeout(timeout));request.on('error',reject);
 });
}
export const fetchImage=url=>fetchPublicBytes(url);
// Public, anonymous keyword endpoint. No account registration or stored key.
// https://api.openverse.org/v1/ documents the query and attribution fields.
export async function searchNotebookImages(store,{query='',mode='local',page=1}={},{read=fetchPublicBytes}={}){
 query=String(query).trim();if(query.length>200)throw Error('检索词不超过 200 字');
 if(mode==='local'){const q=query.toLocaleLowerCase();return {items:(await galleryList(store)).filter(x=>!q||[x.name,x.taskTitle,x.description,x.provenance?.creator].join(' ').toLocaleLowerCase().includes(q)).slice(0,100).map(x=>({...x,kind:'gallery',origin:x.origin||'imported'})),hasMore:false};}
 if(mode!=='online'||!query)throw Error('请填写在线搜图关键词');
 const endpoint=new URL('https://api.openverse.org/v1/images/');endpoint.search=new URLSearchParams({q:query,page:String(Math.max(1,Math.min(20,Math.floor(Number(page)||1)))),page_size:'20',mature:'false'}).toString();
 const result=JSON.parse((await read(endpoint,{maxBytes:2*1024*1024,accept:'application/json'})).toString());
 if(!Array.isArray(result.results))throw Error('搜图服务返回格式无效');
 return {items:result.results.filter(x=>x.url&&x.id).map(x=>({id:x.id,kind:'online',name:x.title||'未命名图片',url:x.url,thumbnail:x.thumbnail,sourceUrl:x.foreign_landing_url||x.url,creator:x.creator||'',license:x.license||'',licenseUrl:x.license_url||'',width:x.width,height:x.height,origin:'web'})),hasMore:Number(result.page||page)<Math.min(20,Number(result.page_count)||1)};
}
