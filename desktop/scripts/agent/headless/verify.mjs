#!/usr/bin/env node
// Read-only token check: protocol handshake + authenticated catalog. Never publishes.
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {applySiteEnv} from './env.mjs';

export async function verifySite(siteKey){
 const ctx=applySiteEnv(siteKey);
 const {createWebsitePublisher}=await import('../../../../scripts/website-publication.mjs');
 const c=createWebsitePublisher({root:ctx.root,site:ctx.site,tokenFile:ctx.tokenFile});
 const cat=await c.catalog({all:true});
 const items=cat.articles||cat.items||cat;
 const count=Array.isArray(items)?items.length:Object.keys(cat).length;
 const summary={site:c.siteId||ctx.site.id,space:ctx.site.spaceId,ok:true,count,updatedAt:cat.updatedAt};
 console.log(JSON.stringify(summary));
 return summary;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))verifySite(process.argv[2]||'scholay-today').catch(e=>{console.error(e.message);process.exitCode=1;});
