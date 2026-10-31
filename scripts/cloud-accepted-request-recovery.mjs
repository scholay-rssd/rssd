#!/usr/bin/env node
// Explicit local identity repair. All remote operations are authenticated GETs.
import {readFile,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

export async function recoverAcceptedCloudRequestFromFile(file){
 // Reject ambient credentials before importing site-dependent modules.
 for(const name of ['SCHOLAY_TODAY_TOKEN','SCHOLAY_TODAY_TOKEN_FILE','SCHOLAY_TODAY_ORIGIN','SCHOLAY_SITE_ID','SCHOLAY_SITE_CONFIG','SCHOLAY_SITE_JSON','SCHOLAY_PUBLICATION_QUEUE_CONFIG'])if(process.env[name])throw Error('Accepted cloud request recovery requires a neutral environment and its original private site credential file');
 const {restoreEquivalentAcceptedCloudRequest}=await import('./publication-accepted-request-recovery.mjs');
 return restoreEquivalentAcceptedCloudRequest(JSON.parse(await readFile(file,'utf8')));
}
if(process.argv[1]&&await realpath(process.argv[1]).catch(()=>null)===await realpath(fileURLToPath(import.meta.url))){
 try{if(process.argv.length!==3)throw Error('Usage: cloud-accepted-request-recovery.mjs <exact-accepted-recovery-input.json>');console.log(JSON.stringify(await recoverAcceptedCloudRequestFromFile(process.argv[2])));}catch(error){console.error(error.message);process.exitCode=1;}
}
