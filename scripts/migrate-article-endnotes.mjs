import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import MarkdownIt from 'markdown-it';
import {canonicalArticleEndnotes} from './article-endnotes.mjs';
import {openStore,audit,enqueueSiteBuild} from '../admin/store.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const md=new MarkdownIt({html:false});
const labels=new Set(['参考文献','参考资料','来源','附注','品牌与发布说明']);
export function meaning(text){
 const t=md.parse(text,{}),out=[];
 for(let i=0;i<t.length;i++){
  if(t[i].type==='heading_open'&&labels.has(t[i+1]?.content)){i+=2;continue;}
  if(t[i].type==='inline')out.push(t[i].children.map(x=>[x.type,x.content,x.attrs]));
  if(['fence','code_block','html_block'].includes(t[i].type))out.push([t[i].type,t[i].content]);
 }
 return JSON.stringify(out);
}
export function cleanText(text,site){
 const after=canonicalArticleEndnotes(text,{site});
 if(after!==text){
  if(meaning(after)!==meaning(text))throw Error('Meaning changed; refuse automatic cleanup');
  if(canonicalArticleEndnotes(after,{site})!==after)throw Error('Cleanup is not idempotent');
 }
 return after;
}
export function cleanPayload(data,site){
 const out=structuredClone(data);
 for(const key of ['markdown','body','historicalSignificance','value'])if(typeof out[key]==='string')out[key]=cleanText(out[key],site);
 if(out.record?.fields)out.record.fields=cleanPayload(out.record.fields,site);
 return out;
}
export function planStore(db,site){
 const documents=[];
 for(const d of db.prepare('SELECT * FROM documents WHERE id NOT IN (SELECT document_id FROM document_tombstones) ORDER BY id').all()){
  const versions=[...new Set([d.published_revision,d.approved_revision,d.latest_revision].filter(Boolean))].sort((a,b)=>a-b);
  const revisions=versions.map(version=>{const r=db.prepare('SELECT payload FROM revisions WHERE document_id=? AND version=?').get(d.id,version);let after;try{after=JSON.stringify(cleanPayload(JSON.parse(r.payload),site));}catch(error){throw Error(d.id+' revision '+version+': '+error.message);}return {version,beforeHash:hash(r.payload),payload:after,changed:after!==JSON.stringify(JSON.parse(r.payload))};});
  if(!revisions.some(r=>r.changed))continue;
  // Latest remains the newest revision even if only the published variant changed.
  let next=db.prepare('SELECT max(version) AS n FROM revisions WHERE document_id=?').get(d.id).n;
  const mapping={};for(const r of revisions)if(r.changed||r.version===d.latest_revision){r.next=++next;mapping[r.version]=r.next;}
  documents.push({before:d,revisions,mapping});
 }
 const archives=[];
 for(const r of db.prepare('SELECT * FROM source_archives ORDER BY id').all()){
  if(db.prepare("SELECT 1 FROM audit WHERE action='source.endnotes.normalize' AND detail LIKE ? LIMIT 1").get(r.id+' -> %'))continue;
  const original=gunzipSync(r.payload).toString(),bundle=JSON.parse(original);if(hash(original)!==r.id)throw Error('Archive checksum mismatch');
  let changed=false;const files=bundle.files.map(file=>{
   if(!/^articles\/.+\/正文\.md$/.test(file.path))return file;
   const bytes=Buffer.from(file.data,'base64');if(hash(bytes)!==file.sha256)throw Error('Source checksum mismatch');
   const text=cleanText(bytes.toString('utf8'),site);if(text===bytes.toString('utf8'))return file;
   changed=true;return {...file,sha256:hash(text),data:Buffer.from(text).toString('base64')};
  });
  if(!changed)continue;
  const document=documents.find(d=>d.before.id===r.document_id),revision=document?.mapping[r.revision]||r.revision;
  const payload=JSON.stringify({...bundle,revision,files});archives.push({oldId:r.id,id:hash(payload),actor:r.actor,documentId:r.document_id,revision,payload,sourceFiles:files.filter(f=>/^articles\/.+\/正文\.md$/.test(f.path)).map(({path,sha256})=>({path,sha256}))});
 }
 return {version:1,siteId:site.id,documents,archives};
}
export async function applyStorePlan(db,plan,{backup}){
 await mkdir(dirname(backup),{recursive:true,mode:0o700});await db.backup(backup);
 return db.transaction(()=>{
  if(db.prepare("SELECT 1 FROM jobs WHERE status IN ('queued','running') UNION ALL SELECT 1 FROM site_jobs WHERE status IN ('queued','running') LIMIT 1").get())throw Error('Publication queue is not idle');
  for(const d of plan.documents){
   if(JSON.stringify(db.prepare('SELECT * FROM documents WHERE id=?').get(d.before.id))!==JSON.stringify(d.before))throw Error('Concurrent document change');
   for(const r of d.revisions){
    if(hash(db.prepare('SELECT payload FROM revisions WHERE document_id=? AND version=?').get(d.before.id,r.version).payload)!==r.beforeHash)throw Error('Concurrent revision change');
    if(r.next)db.prepare('INSERT INTO revisions VALUES(?,?,?,?,?,?)').run(d.before.id,r.next,r.payload,'endnote-cleanup','统一文末参考文献编号；保留原版本',Date.now());
   }
   const mapped=v=>d.mapping[v]||v;
   db.prepare('UPDATE documents SET latest_revision=?,published_revision=?,approved_revision=?,updated=? WHERE id=?').run(mapped(d.before.latest_revision),mapped(d.before.published_revision),mapped(d.before.approved_revision),Date.now(),d.before.id);
   audit(db,'endnote-cleanup','content.endnotes.normalize',d.before.id,JSON.stringify(d.mapping));
  }
  for(const a of plan.archives){db.prepare('INSERT OR IGNORE INTO source_archives VALUES(?,?,?,?,?,?)').run(a.id,a.actor,a.documentId,a.revision,gzipSync(a.payload),Date.now());audit(db,'endnote-cleanup','source.endnotes.normalize',a.documentId,a.oldId+' -> '+a.id);}
  const job=plan.documents.some(d=>d.before.published_revision)?enqueueSiteBuild(db,'endnote-cleanup'):null;
  return {siteId:plan.siteId,documents:plan.documents.length,archives:plan.archives.length,job,versionMappings:plan.documents.map(d=>({documentId:d.before.id,articleId:JSON.parse(d.revisions.at(-1).payload).id,mapping:d.mapping,latestRevision:d.mapping[d.before.latest_revision]||d.before.latest_revision,publishedRevision:d.mapping[d.before.published_revision]||d.before.published_revision})),archiveMappings:plan.archives.map(({payload,...a})=>a)};
 })();
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [database,siteFile,planFile,mode,backup]=process.argv.slice(2);if(!database||!siteFile||!planFile)throw Error('database site.json plan.json [apply backup.sqlite]');
 const site=JSON.parse(await readFile(siteFile,'utf8')),db=openStore(database);
 try{
  if(mode==='apply'){
   const plan=JSON.parse(await readFile(planFile,'utf8'));if(plan.siteId!==site.id)throw Error('Wrong site');
   const receipt=await applyStorePlan(db,plan,{backup});await writeFile(planFile+'.receipt.json',JSON.stringify(receipt,null,2),{mode:0o600});console.log(JSON.stringify({siteId:site.id,documents:receipt.documents,archives:receipt.archives,job:receipt.job}));
  }else{const plan=planStore(db,site);await mkdir(dirname(planFile),{recursive:true,mode:0o700});await writeFile(planFile,JSON.stringify(plan),{mode:0o600});console.log(JSON.stringify({siteId:site.id,documents:plan.documents.length,revisions:plan.documents.flatMap(d=>d.revisions.filter(r=>r.next)).length,archives:plan.archives.length}));}
 }finally{db.close();}
}
