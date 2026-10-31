import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import p from '../../contracts/rssd-v1.cjs';
import {writeCenterJson} from '../../scripts/rssd-center-client.mjs';

/** Owner-only migration: retain old bundled evidence outside the public app artifact. */
export async function captureLegacyCalendar(source,home){
 const files={};for(const name of (await readdir(source)).sort().filter(n=>/^(historyEvents|year[A-Za-z]+)\.json$/.test(n)))files[name]=await readFile(join(source,name),'utf8');
 if(!JSON.parse(files['historyEvents.json']||'[]').length)throw Error('The source has no historical calendar evidence');
 const sha256=p.hash(files),directory=join(home,'legacy-calendar');await mkdir(directory,{recursive:true,mode:0o700});
 const value={version:1,sha256,files};const path=join(directory,sha256+'.json');
 try{await writeFile(path,JSON.stringify(value),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;if(p.hash(JSON.parse(await readFile(path,'utf8')))!==p.hash(value))throw Error('Existing calendar archive checksum differs');}
 await writeCenterJson(join(directory,'current.json'),{version:1,sha256});
 const result=await readLegacyCalendar(home);return {sha256,files:Object.keys(files).length,history:result.history.length,harvested:result.harvested.length,official:result.official.length,path};
}
export async function readLegacyCalendar(home=process.env.SCHOLAY_GLOBAL_APP_DATA){
 if(!home)return null;const directory=join(home,'legacy-calendar');let pointer;
 try{pointer=JSON.parse(await readFile(join(directory,'current.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}
 if(pointer.version!==1||!/^[a-f0-9]{64}$/.test(pointer.sha256))throw Error('Invalid local calendar archive identity');
 const value=JSON.parse(await readFile(join(directory,pointer.sha256+'.json'),'utf8'));if(value.version!==1||value.sha256!==pointer.sha256||p.hash(value.files)!==pointer.sha256)throw Error('Local calendar evidence checksum differs');
 const get=name=>JSON.parse(value.files[name]||'[]'),history=get('historyEvents.json'),cache=get('yearOfficialBodyCache.json');
 const canonical=url=>{try{const value=new URL(url);value.hash='';return value.href;}catch{return '';}};
 const bodies=new Map((Array.isArray(cache.entries)?cache.entries:[]).map(e=>[e.articleId+'\0'+canonical(e.sourceUrl),e]));
 const attach=seeds=>seeds.map(seed=>{const e=bodies.get(seed.article.id+'\0'+canonical(seed.article.url));return !seed.article.body?.trim()&&e?.body?.trim()?{...seed,article:{...seed.article,body:e.body,...(e.truncated?{bodyTruncated:true}:{})}}:seed;});
 const harvested=attach(['yearProgramSeeds','yearWindowSeeds','yearTalentSeeds','yearLocalSeeds','yearSocialSeeds','yearSeeds'].flatMap(name=>get(name+'.json')));
 const official=attach(Object.keys(value.files).filter(name=>/^yearOfficial.*Seeds\.json$/.test(name)).flatMap(get));
 return {version:1,sha256:pointer.sha256,history,harvested,official};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [source,home]=process.argv.slice(2);if(!source||!home)throw Error('Usage: legacy-calendar.mjs PRIVATE-CALENDAR-SOURCE APP-DATA-DIRECTORY');
 console.log(JSON.stringify(await captureLegacyCalendar(resolve(source),resolve(home))));
}
