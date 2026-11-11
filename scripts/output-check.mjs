// Read-only check of every article against the output package spec (contracts/output-package.mjs) and
// every destination profile in it.
//
//   RSSD_CENTER_TOKEN=... node scripts/output-check.mjs                 the Center's records, every space
//   node scripts/output-check.mjs --vaults <folder of vaults>          local Obsidian copies (provisional)
//   options: --space <workspaceId> (repeatable)  --out <folder>  --origin <Center origin>
//
// It only sends GET requests and only writes its report, by default under git-ignored
// .local/output-check/<time>/: report.json (everything), summary.md (per site), articles.csv (one line per
// finding) and fill.md / fill.json (what to fill at the source, with the proposed value and where it comes
// from). The Center origin comes from --origin, RSSD_CENTER_ORIGIN or the desktop app's saved connection;
// the device credential comes only from RSSD_CENTER_TOKEN and is never written or printed.
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {OUTPUT_DESTINATIONS,sourceRecord,checkSource,outputFields,characters,fitText} from '../contracts/output-package.mjs';
import {sectionsForSite} from '../contracts/site-sections.mjs';

const LOCALES=['zh-CN','en'],BATCH=8;
// The WeChat draft/add API documents a shorter title than the editor accepts; counted, not enforced.
export const WECHAT_API_TITLE=32;
const IMAGE=/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g;

/** Everything the spec says about one article in one language. Pure. */
export function checkArticle(record,site){
 const s=sourceRecord(record),{errors,warnings,notes}=checkSource(record),findings=[];
 for(const [level,list] of [['error',errors],['warning',warnings],['note',notes]])for(const f of list)findings.push({level,code:f.code,message:f.message});
 const fields={};
 if(!errors.length)for(const [destination,{format}] of Object.entries(OUTPUT_DESTINATIONS)){
  const out=outputFields(format,record,{site,destination});fields[destination]=out.fields;
  for(const w of out.warnings)findings.push({level:'output',format,destination,code:w.code,message:w.message});
 }
 if(characters(s.title)>WECHAT_API_TITLE)findings.push({level:'note',code:'title_longer_than_wechat_api',message:'The title is longer than the '+WECHAT_API_TITLE+' characters the WeChat draft API documents'});
 return {articleId:s.id,locale:s.locale,sectionId:s.sectionId,kind:s.kind,title:s.title,titleLength:characters(s.title),summaryLength:characters(s.summary),
  version:s.version,publishedVersion:s.publishedVersion,findings,fields};
}

/** A shorter title that is already in the article: the part before its first subtitle mark. */
export function shorterTitle(title,limit){
 const head=title.split(/[：:｜|]|——|\s[-–—]\s/)[0].trim();
 return head&&head!==title&&characters(head)<=limit&&characters(head)>=4?{value:head,from:'the title before its subtitle; check it still says enough'}:{value:fitText(title,limit),from:'the title cut at '+limit+' characters; needs an editor'};
}

/** What to fill at the source for one article, with the proposed value and where it comes from. Pure. */
export function fillItems(record,site){
 const s=sourceRecord(record),items=[],section=sectionsForSite(site||{}).find(x=>x.id===s.sectionId);
 if(!s.author)items.push({field:'author',proposed:site?.author||'',from:site?.author?'the site profile author (sites/profiles.json)':'no site author; needs a decision'});
 else if(characters(s.author)>OUTPUT_DESTINATIONS['wechat-official-account'].limits.author&&site?.author&&site.author!==s.author)items.push({field:'author (WeChat only)',current:s.author,proposed:site.author,from:'the site profile author, which fits the limit'});
 if(!s.category)items.push({field:'category',proposed:section?.name||'',from:section?'the name of section '+s.sectionId:'section '+(s.sectionId||'(none)')+' is not in the site profile; needs a decision'});
 for(const match of s.markdown.matchAll(IMAGE))if(!match[1].trim()){
  const after=s.markdown.slice(match.index+match[0].length).split('\n').map(l=>l.trim()).find(Boolean)||'';
  const caption=/^(?:\*[^*]+\*|_[^_]+_|图\s*\d+|Figure\s*\d+)/i.test(after)?after.replace(/^[*_]|[*_]$/g,'').slice(0,120):'';
  items.push({field:'image alt',target:match[2],proposed:caption,from:caption?'the caption under the image':'nothing in the article; needs writing'});
 }
 const limit=OUTPUT_DESTINATIONS['wechat-official-account'].limits.title;
 if(characters(s.title)>limit)items.push({field:'title (WeChat only)',current:s.title,...(({value,from})=>({proposed:value,from}))(shorterTitle(s.title,limit))});
 return items;
}

const frontmatter=text=>{
 const match=/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);if(!match)return null;
 const data={};
 const lines=match[1].split(/\r?\n/);
 for(let i=0;i<lines.length;i++){
  const pair=/^([A-Za-z][\w-]*):\s?(.*)$/.exec(lines[i]);if(!pair)continue;
  let value=pair[2].trim();
  // A folded or literal block (summary: >-) continues on the indented lines below it.
  if(/^[>|][+-]?$/.test(value)){const parts=[];while(i+1<lines.length&&/^(\s+\S|\s*$)/.test(lines[i+1]))parts.push(lines[++i].trim());value=parts.join(value[0]==='>'?' ':'\n').trim();}
  if(/^".*"$/.test(value)){try{value=JSON.parse(value);}catch{value=value.slice(1,-1);}}else if(/^'.*'$/.test(value))value=value.slice(1,-1).replace(/''/g,"'");
  data[pair[1]]=value;
 }
 return {data,body:text.slice(match[0].length)};
};
/** A vault note as a source record, or null when it is not a synced work. */
export function vaultRecord(text){
 const note=frontmatter(text);if(!note||!note.data['rssd-id'])return null;
 const d=note.data,integer=v=>/^\d+$/.test(v||'')?Number(v):null;
 return {id:d['rssd-id'],locale:d['rssd-locale']||'zh-CN',sectionId:d['rssd-section']||'',kind:d['rssd-kind']||'news',title:d.title||'',summary:d.summary||'',author:d.author||'',
  date:d.date||'',category:d.category||'',markdown:note.body,media:[...note.body.matchAll(IMAGE)].map(m=>m[2]),version:integer(d['rssd-version']),publishedVersion:integer(d['rssd-published-version'])};
}
async function* vaultSource(root,profiles,only){
 for(const name of (await readdir(root)).sort()){
  const site=profiles.find(p=>p.domain===name||new URL(p.origin).hostname===name);if(!site||only.length&&!only.includes(site.spaceId))continue;
  let files;try{files=(await readdir(join(root,name,'Works'),{recursive:true})).filter(f=>f.endsWith('.md')).sort();}catch(error){if(error.code==='ENOENT')continue;throw error;}
  for(const file of files){
   let record=null,problem='';
   try{record=vaultRecord(await readFile(join(root,name,'Works',file),'utf8'));if(!record)problem='not a synced work';}catch(error){problem=error.message;}
   yield {site,record,unreadable:record?null:{articleId:file,locale:'',code:'unreadable',message:problem}};
  }
 }
}

/** GET only: this command has no way to send a write. */
export function centerReader({origin,token,fetcher=fetch,timeoutMs=180000}){
 const url=new URL(origin);
 if(url.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(url.hostname))throw Error('The Center address must use HTTPS');
 if(!/^rssd_device_[A-Za-z0-9_-]{48}$/.test(token||''))throw Error('Set RSSD_CENTER_TOKEN to a Center device credential that can read the spaces to check');
 return async path=>{
  const response=await fetcher(url.origin+'/api/rssd/v1'+path,{method:'GET',redirect:'error',headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(timeoutMs)});
  const value=await response.json().catch(()=>null);
  if(!response.ok)throw Object.assign(Error(value?.message||'Center request failed ('+response.status+')'),{status:response.status,code:value?.code||'http_error'});
  return value;
 };
}
const centerRecord=detail=>({...detail.data,locale:detail.locale,kind:detail.data.record?.kind||'news',version:detail.version,publishedVersion:detail.publishedVersion});
async function* centerSource(get,profiles,only,log){
 const registry=await get('/registry');
 for(const workspace of registry.workspaces||[]){
  if(only.length&&!only.includes(workspace.id))continue;
  const site=profiles.find(p=>p.id===workspace.siteId)||{id:workspace.siteId||workspace.id,spaceId:workspace.id,name:workspace.name,author:''};
  const space='/editorial/'+encodeURIComponent(workspace.id)+'/';
  for(const locale of LOCALES){
   const ids=[];
   for(let attempt=0;;attempt++){
    ids.length=0;let after,generation,changed=false;
    try{do{
     const page=await get(space+'catalog?'+new URLSearchParams({scope:'all',locale,limit:'100',...(after===undefined?{}:{after:String(after),generation:String(generation)})}));
     generation=page.generation;ids.push(...page.items.map(item=>item.articleId));after=page.next;
    }while(after!=null);}catch(error){if(error.code!=='catalog_changed'||attempt>=3)throw error;changed=true;}
    if(!changed)break;
   }
   log(workspace.id+' '+locale+': '+ids.length+' works');
   for(let i=0;i<ids.length;i+=BATCH){
    const batch=await get(space+'cloud/batch/read?'+new URLSearchParams({locale,ids:ids.slice(i,i+BATCH).join(','),media:'referenced'}));
    for(const item of batch.items||[]){
     let detail=item.ok?item.detail:null,problem=item.error;
     if(!detail&&problem?.code==='batch_response_limit')try{detail=await get(space+'cloud/'+encodeURIComponent(item.articleId)+'?'+new URLSearchParams({locale,media:'referenced'}));}catch(error){problem={code:error.code||'http_error',message:error.message};}
     yield detail?{site,record:centerRecord(detail)}:{site,unreadable:{articleId:item.articleId,locale,code:problem?.code||'unreadable',message:problem?.message||'The Center could not return this work'}};
    }
   }
  }
 }
}

/** Collect a source into the report object. */
export async function buildReport(source,meta){
 const sites={},articles=[],fill=[];
 for await(const {site,record,unreadable} of source){
  const entry=sites[site.id]??={siteId:site.id,name:site.name||'',works:0,byLocale:{},unreadable:0,codes:{}};
  if(unreadable){entry.unreadable++;articles.push({siteId:site.id,...unreadable,findings:[{level:'error',code:unreadable.code,message:unreadable.message}]});continue;}
  const result=checkArticle(record,site);entry.works++;entry.byLocale[result.locale]=(entry.byLocale[result.locale]||0)+1;
  for(const code of new Set(result.findings.map(f=>(f.destination?f.destination+':':'')+f.code)))entry.codes[code]=(entry.codes[code]||0)+1;
  articles.push({siteId:site.id,...result});
  const items=fillItems(record,site);if(items.length)fill.push({siteId:site.id,articleId:result.articleId,locale:result.locale,sectionId:result.sectionId,title:result.title,items});
 }
 return {...meta,limits:Object.fromEntries(Object.entries(OUTPUT_DESTINATIONS).map(([k,v])=>[k,v.limits])),sites:Object.values(sites),articles,fill};
}

const cell=value=>'"'+String(value??'').replace(/"/g,'""').replace(/\r?\n/g,' ')+'"';
export function renderReport(report){
 const codes=[...new Set(report.sites.flatMap(s=>Object.keys(s.codes)))].sort(),total=code=>report.sites.reduce((n,s)=>n+(s.codes[code]||0),0);
 const summary=['# Output check','',`Source: ${report.source}  `,`Run: ${report.createdAt}  `,`Works: ${report.sites.reduce((n,s)=>n+s.works,0)} (unreadable: ${report.sites.reduce((n,s)=>n+s.unreadable,0)})`,'',
  '| Site | Works | zh-CN | en | '+codes.join(' | ')+' |','|---|---|---|---|'+codes.map(()=>'---|').join(''),
  ...report.sites.map(s=>`| ${s.siteId} | ${s.works} | ${s.byLocale['zh-CN']||0} | ${s.byLocale.en||0} | ${codes.map(c=>s.codes[c]||0).join(' | ')} |`),
  `| **all** | ${report.sites.reduce((n,s)=>n+s.works,0)} | | | ${codes.map(total).join(' | ')} |`,''].join('\n');
 const csv=['site,articleId,locale,section,kind,version,publishedVersion,level,format,destination,code,message,title',
  ...report.articles.flatMap(a=>a.findings.map(f=>[a.siteId,a.articleId,a.locale,a.sectionId,a.kind,a.version,a.publishedVersion,f.level,f.format,f.destination,f.code,f.message,a.title].map(cell).join(',')))].join('\n')+'\n';
 const byField={};for(const a of report.fill)for(const item of a.items)(byField[item.field]??=[]).push({...a,item});
 const fill=['# Fill list','',`Source: ${report.source}. Nothing here has been changed; each line is a proposal.`,'',
  ...Object.entries(byField).flatMap(([field,rows])=>['## '+field+' ('+rows.length+')','','| Site | Article | Lang | Section | Proposed | From | Title |','|---|---|---|---|---|---|---|',
   ...rows.map(r=>'| '+[r.siteId,r.articleId,r.locale,r.sectionId,r.item.proposed||'—',r.item.from+(r.item.target?' ('+r.item.target+')':''),r.title].map(v=>String(v).replace(/\|/g,'\\|').replace(/\r?\n/g,' ')).join(' | ')+' |'),''])].join('\n');
 return {summary,csv,fill};
}

async function main(argv){
 const option=name=>{const values=[];for(let i=0;i<argv.length;i++)if(argv[i]==='--'+name)values.push(argv[++i]);return values;};
 const root=fileURLToPath(new URL('..',import.meta.url)),profiles=JSON.parse(await readFile(join(root,'sites/profiles.json'),'utf8'));
 const only=option('space'),vaults=option('vaults')[0],createdAt=new Date().toISOString();
 let source,label;
 if(vaults){source=vaultSource(resolve(vaults),profiles,only);label='local vault copies at '+resolve(vaults)+' (as last pulled; not the Center)';}
 else{
  let origin=option('origin')[0]||process.env.RSSD_CENTER_ORIGIN;
  if(!origin){const {centerHome}=await import('../desktop/scripts/runtime/center-home.mjs');
   for(const home of [centerHome(),join(process.env.HOME||'','Library/Application Support/com.thomas.papr/center')])try{origin=JSON.parse(await readFile(join(home,'connection.json'),'utf8')).origin;if(origin)break;}catch{}}
  if(!origin)throw Error('Give the Center address with --origin or RSSD_CENTER_ORIGIN');
  source=centerSource(centerReader({origin,token:process.env.RSSD_CENTER_TOKEN}),profiles,only,line=>console.error(line));label='Center '+new URL(origin).origin+' (latest edition of every work, drafts included)';
 }
 const report=await buildReport(source,{source:label,createdAt}),out=resolve(option('out')[0]||join(root,'.local/output-check',createdAt.replace(/[:.]/g,'-')));
 const {summary,csv,fill}=renderReport(report);await mkdir(out,{recursive:true});
 await writeFile(join(out,'report.json'),JSON.stringify(report));await writeFile(join(out,'summary.md'),summary);await writeFile(join(out,'articles.csv'),csv);
 await writeFile(join(out,'fill.md'),fill);await writeFile(join(out,'fill.json'),JSON.stringify(report.fill,null,1));
 console.log(summary);console.log('Report: '+out);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
