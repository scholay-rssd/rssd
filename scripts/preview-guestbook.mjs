// Five isolated local previews. No production database, credentials or deployment.
import {profiles} from './site-config.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
const root=resolve('.local/guestbook-preview'),children=[];
await mkdir(root,{recursive:true,mode:0o700});
for(const [i,site] of profiles.filter(s=>s.services?.guestbook.enabled).entries()){
 const dir=join(root,site.id);await mkdir(dir,{recursive:true,mode:0o700});
 const config=join(dir,'site.json');await writeFile(config,JSON.stringify(site));
 const port=4280+i,origin='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,['admin/server.mjs'],{stdio:'inherit',env:{...process.env,SCHOLAY_SITE_CONFIG:config,SCHOLAY_ADMIN_DB:join(dir,'admin.sqlite'),SCHOLAY_LABELS_DB:join(dir,'labels.sqlite'),TODAY_GUESTBOOK_DB:join(dir,'guestbook.sqlite'),TODAY_GUESTBOOK_ENABLED:'1',SCHOLAY_ADMIN_ORIGIN:origin,PORT:String(port)}});
 children.push(child);console.log(site.name+': '+origin+'/guestbook/');
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{for(const c of children)c.kill('SIGTERM');});
