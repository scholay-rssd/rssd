import {open} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {flowDirectory,optional} from './publishing-flow.mjs';
import {lockOwnerAlive} from './editorial-lock.mjs';

export async function kickPublishingFlow({root,site,tokenFile}){
 const policy=await optional(join(flowDirectory(root),'policy.json'));if(!policy?.enabled||!policy.autoRun)return;
 const owner=await optional(join(flowDirectory(root),'worker.lock'));if(owner&&await lockOwnerAlive(owner))return;
 // The publication process only freezes a task and starts this detached worker.
 // Keep the launcher independent of the CLI's top-level execution.
 const log=await open(join(flowDirectory(root),'worker.log'),'a',0o600);
 try{const env={...process.env,SCHOLAY_EDITORIAL_ROOT:root,SCHOLAY_SITE_JSON:JSON.stringify(site),...(tokenFile?{SCHOLAY_TODAY_TOKEN_FILE:tokenFile}:{})};const child=spawn(process.execPath,[fileURLToPath(new URL('./publishing-flow-cli.mjs',import.meta.url)),'root',root,'drain'],{detached:true,stdio:['ignore',log.fd,log.fd],env,windowsHide:true});child.on('error',()=>{});child.unref();}finally{await log.close();}
}
