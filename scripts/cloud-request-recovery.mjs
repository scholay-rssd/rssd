#!/usr/bin/env node
// Explicit recovery input contains identity and credential-file paths, never a
// plaintext token. The recovery itself performs GET requests only.
import {readFile} from 'node:fs/promises';
import {isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateSite,setSiteContext} from './site-config.mjs';
import {createWebsitePublisher} from './website-publication.mjs';

export async function recoverCloudRequestFromFile(file){
 if(process.env.SCHOLAY_TODAY_TOKEN||process.env.SCHOLAY_TODAY_ORIGIN||process.env.SCHOLAY_SITE_ID||process.env.SCHOLAY_SITE_CONFIG||process.env.SCHOLAY_SITE_JSON)throw Error('Cloud request recovery requires a neutral environment and its original site credential file');
 const input=JSON.parse(await readFile(file,'utf8'));
 const keys=['version','root','site','tokenFile','localId','expected'];
 if(!input||Object.keys(input).length!==keys.length||Object.keys(input).some(key=>!keys.includes(key))||input.version!==1||!isAbsolute(input.root||'')||!isAbsolute(input.tokenFile||''))throw Error('Use an exact site-bound cloud request recovery input');
 const site=validateSite(input.site),bound=JSON.parse(await readFile(join(input.root,'.site.json'),'utf8'));
 if(bound.id!==site.id||bound.origin!==site.origin)throw Error('Recovery workspace site identity differs');
 setSiteContext(site);
 return createWebsitePublisher({root:input.root,site,tokenFile:input.tokenFile}).recoverCloudRequest(input.localId,input.expected);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv.length!==3)throw Error('Usage: cloud-request-recovery.mjs <exact-recovery-input.json>');console.log(JSON.stringify(await recoverCloudRequestFromFile(process.argv[2])));}catch(error){console.error(error.message);process.exitCode=1;}
}
