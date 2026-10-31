import {mkdir,writeFile,rename,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import p from '../contracts/rssd-v1.cjs';
export function publicCommunity(value){
 if(value?.version!==1||!value.links||typeof value.links!=='object'||Array.isArray(value.links)||Object.keys(value.links).length>10000)throw Error('Invalid community replica');
 const links={};for(const [route,target] of Object.entries(value.links)){
  const decoded=decodeURIComponent(route);if(!/^\/(?:news|calendar|history|open-source)\/[^?#]+\/$/.test(route)||route.length>2000||/%2f/i.test(route)||decoded.includes('\\')||decoded.includes('\0')||decoded.split('/').some(s=>s==='..'||s==='.'))throw Error('Invalid community source');
  const url=new URL(target);if(url.origin!=='https://enterscholar.com'||url.username||url.password||url.search||url.hash||!/^\/t\/(?:[^/]+\/)?[1-9][0-9]{0,14}\/?$/.test(url.pathname))throw Error('Invalid community topic');
  links[route]=url.href;
 }
 return {version:1,links};
}
export class CommunityMirror{
 constructor(config,{fetchImpl=fetch,now=Date.now}={}){
  const origin=new URL(config.origin);if(origin.protocol!=='https:'||origin.origin!==config.origin)throw Error('Community center requires HTTPS');
  this.config={...config,siteId:p.id(config.siteId),directory:resolve(config.directory)};this.fetch=fetchImpl;this.now=now;this.next=0;
 }
 async tick(){
  if(this.now()<this.next)return;this.next=this.now()+60000;const c=this.config;
  const response=await this.fetch(c.origin+'/api/rssd/public/v1/community/sites/'+encodeURIComponent(c.siteId),{redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('Community replica unavailable: '+response.status);
  const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>4*1024*1024)throw Error('Community replica is too large');chunks.push(chunk);}
  const bytes=JSON.stringify(publicCommunity(JSON.parse(Buffer.concat(chunks))));await mkdir(c.directory,{recursive:true,mode:0o755});const target=join(c.directory,'links.json');
  try{if(await readFile(target,'utf8')===bytes)return;}catch(e){if(e.code!=='ENOENT')throw e;}
  const temporary=join(c.directory,'links-'+randomUUID()+'.tmp');await writeFile(temporary,bytes,{mode:0o644});await rename(temporary,target);
 }
}
