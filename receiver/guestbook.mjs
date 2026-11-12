import {mkdir,writeFile,rename,readFile,chmod} from 'node:fs/promises';
import {join,resolve,relative,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import p from '../contracts/rssd-v1.cjs';
export function approvedMessages(value){
 if(!value||!Array.isArray(value.messages)||value.messages.length>50)throw Error('Invalid guestbook replica');
 return {messages:value.messages.map(m=>({id:p.id(m.id),kind:p.id(m.kind),name:p.text(m.name,'name',60),message:p.text(m.message,'message',3000),created:p.integer(m.created,'created')}))};
}
export class GuestbookMirror{
 constructor(config,{fetchImpl=fetch,now=Date.now}={}){
  const origin=new URL(config.origin);if(origin.protocol!=='https:'||origin.origin!==config.origin)throw Error('Guestbook center requires an HTTPS origin');
  if(typeof config.token!=='string'||config.token.length<32||/[\r\n]/.test(config.token))throw Error('Guestbook site credential is invalid');
  const directory=resolve(config.directory),root=resolve(config.root??directory);if(relative(root,directory).startsWith('..'))throw Error('Guestbook replica must be inside its public root');
  this.config={...config,siteId:p.id(config.siteId),directory,root};this.fetch=fetchImpl;this.now=now;this.next=0;
 }
 async tick(){
  if(this.now()<this.next)return;this.next=this.now()+60000;
  const c=this.config,response=await this.fetch(c.origin+'/api/rssd/public/v1/guestbooks/'+encodeURIComponent(c.siteId)+'/messages',{headers:{'x-rssd-site-token':c.token,'x-rssd-client-ip':'127.0.0.1'},redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('Guestbook replica unavailable: '+response.status);
  let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>1024*1024)throw Error('Oversize guestbook replica');chunks.push(chunk);}
  const bytes=JSON.stringify(approvedMessages(JSON.parse(Buffer.concat(chunks).toString('utf8'))));await mkdir(c.directory,{recursive:true,mode:0o755});
  // The web server reads this replica: set its modes explicitly, whatever the service umask (receivers run with 0027).
  let folder=c.root;for(const part of relative(c.root,c.directory).split(sep).filter(Boolean)){folder=join(folder,part);await chmod(folder,0o755);}
  const target=join(c.directory,'messages.json');try{if(await readFile(target,'utf8')===bytes){await chmod(target,0o644);return;}}catch(e){if(e.code!=='ENOENT')throw e;}
  const temporary=join(c.directory,'messages-'+randomUUID()+'.tmp');await writeFile(temporary,bytes,{mode:0o644});await chmod(temporary,0o644);await rename(temporary,target);
 }
}
