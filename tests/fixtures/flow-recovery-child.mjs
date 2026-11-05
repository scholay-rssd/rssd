import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {todayTick,atomic,optional,flowDirectory} from '../../scripts/publishing-flow.mjs';
const root=process.argv[2],fixture=JSON.parse(await readFile(join(root,'fixture.json'),'utf8'));
await todayTick({root,site:fixture.site,readSource:async()=>({version:1,publishedVersion:1,data:fixture.source}),fetcher:async()=>Response.json({version:1,links:{['/news/'+fixture.source.id+'/']:'https://enterscholar.com/t/-/415722'}}),translate:async(source,{plan})=>{
 const calls=(await optional(join(root,'calls.json')))||0;await atomic(join(root,'calls.json'),calls+1);
 await atomic(join(flowDirectory(root),'jobs',plan.id,'translation-result.json'),{planId:plan.id,sourceSha256:plan.sha256,edition:fixture.english});
 await writeFile(join(root,'checkpoint-ready'),'1');
 while(!await optional(join(root,'gate.json')))await delay(20);
 return fixture.english;
},publishEdition:async()=>{await atomic(join(root,'published.json'),true);return {status:'verified'};}});
