// Resolve the profile before importing model/editorial modules. Each deployed
// instance is one process and one SQLite store; host placement is independent.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const [config,command,...args]=process.argv.slice(2);
if(!config||!['server','worker','cli','seed'].includes(command))throw Error('Usage: run-site.mjs site.json server|worker|cli|seed');
const site=JSON.parse(await readFile(config,'utf8'));
process.env.SCHOLAY_SITE_CONFIG=resolve(config);process.env.SCHOLAY_SITE_ID=site.id;process.env.SCHOLAY_SITE_JSON=JSON.stringify(site);
const {validateSite}=await import('./site-config.mjs');validateSite(site);
if(command==='server'){const {createApp}=await import('../admin/server.mjs');const app=await createApp();await app.listen({host:'127.0.0.1',port:Number(process.env.PORT)});}
if(command==='worker'){const {runWorker}=await import('../admin/worker.mjs');await runWorker({once:args.includes('--once')});}
if(command==='cli'){process.argv=[process.argv[0],new URL('../admin/cli.mjs',import.meta.url).pathname,...args];await import('../admin/cli.mjs');}
if(command==='seed'){const {seedSite}=await import('./seed-site.mjs');console.log(JSON.stringify(await seedSite(site,args[0])));}
