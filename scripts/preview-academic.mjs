// Build an isolated static preview from the existing manual exports. Never
// export desktop data, write manuscripts, or contact a production service.
import {cp,mkdir,readFile} from 'node:fs/promises';import {join,resolve} from 'node:path';
import {writeCalendarData} from '../web/themes/academic/calendar-data.mjs';
import {spawn} from 'node:child_process';import {buildSeoSite} from './build-seo.mjs';
import {publicFiles} from '../web/themes/academic/render.mjs';
const target=resolve('.local/academic-preview');await mkdir(target,{recursive:true});
await buildSeoSite({output:target,previousRoot:target});
for(const file of publicFiles){if(file!=='index.html')await cp(join('web/themes/academic/public',file),join(target,file));}
await cp('web/themes/academic/public/fonts',join(target,'fonts'),{recursive:true});
for(const file of ['data.json','open-source.json'])await cp(file,join(target,file));
await writeCalendarData(target,JSON.parse(await readFile('data.json','utf8')));
if(!process.argv.includes('--build-only')){
 const child=spawn('python3',['-m','http.server','--bind','127.0.0.1','--directory',target,'4173'],{stdio:'inherit'});
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
 child.on('exit',code=>{process.exitCode=code||0;});
}
console.log('Academic preview: '+target);
