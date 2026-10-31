// One-off, exact-span migration. No classifiers, AI rewrite or daily cleanup.
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {gzipSync,gunzipSync} from 'node:zlib';
import {isDeepStrictEqual} from 'node:util';
import {INTERNAL_NOTE_FIELDS,validatePrivateEditorial} from '../contracts/article-internal-notes.mjs';

export const digest=x=>createHash('sha256').update(x).digest('hex');
const editable=new Set(['markdown','summary','body','value','historicalSignificance','factSummary']);
export function applyExactNotes(payload,edits){
 if(!Array.isArray(edits)||!edits.length)throw Error('Explicit edits required');
 const after=structuredClone(payload),blockNotes={};
 for(const [i,e] of edits.entries()){
  if(!editable.has(e.field)||typeof after[e.field]!=='string'||!e.before||typeof e.after!=='string'||!e.note||!Object.hasOwn(INTERNAL_NOTE_FIELDS,e.category))throw Error('Invalid exact edit');
  if(after[e.field].split(e.before).length!==2)throw Error('Exact span missing or ambiguous: '+e.field);
  if(e.before===e.after)throw Error('No-op edit');
  // Require the caller to retain the removed text verbatim in private notes.
  if(!e.note.includes(e.before))throw Error('Original span must be preserved privately');
  after[e.field]=after[e.field].replace(e.before,e.after);
  const anchor=e.anchor||e.after;
  blockNotes['migration-'+i]={notes:{[e.category]:e.note},anchor:{type:'markdown',text:anchor}};
 }
 return {after,blockNotes};
}
function archiveOwner(db,id,revision){
 // Keep the existing authenticated author identity, never invent a broader ACL.
 const request=db.prepare('SELECT actor FROM content_requests WHERE document_id=? AND revision<=? ORDER BY revision DESC,created DESC LIMIT 1').get(id,revision)
  ||db.prepare('SELECT actor FROM content_drafts WHERE document_id=? AND revision<=? ORDER BY revision DESC,created DESC LIMIT 1').get(id,revision)
  ||db.prepare('SELECT actor FROM source_archives WHERE document_id=? ORDER BY created DESC LIMIT 1').get(id)
  ||db.prepare('SELECT actor FROM revisions WHERE document_id=? AND version=1').get(id);
 if(!request?.actor||['initial-import','system','endnote-cleanup'].includes(request.actor))throw Error('No authenticated archive owner: '+id);
 return request.actor;
}
export function preparePlan(db,input,{markdownOf}){
 if(input.version!==1||!input.siteId||!Array.isArray(input.documents))throw Error('Invalid migration input');
 const seen=new Set(),documents=[];
 for(const entry of input.documents){
  if(seen.has(entry.document.id))throw Error('Duplicate document');seen.add(entry.document.id);
  const current=db.prepare('SELECT * FROM documents WHERE id=?').get(entry.document.id);
  if(!isDeepStrictEqual({...current},entry.document))throw Error('Concurrent document change: '+entry.document.id);
  if(db.prepare('SELECT 1 FROM document_tombstones WHERE document_id=?').get(current.id))throw Error('Document deleted');
  // Preserve intentional published/draft divergence; this run requires one version.
  const versions=[...new Set([current.latest_revision,current.approved_revision,current.published_revision].filter(Boolean))];
  if(versions.length!==1||versions[0]!==entry.revision)throw Error('Divergent revisions require a separate plan: '+current.id);
  const revision=db.prepare('SELECT * FROM revisions WHERE document_id=? AND version=?').get(current.id,entry.revision);
  if(digest(revision.payload)!==entry.payloadSha256)throw Error('Revision checksum changed');
  const payload=JSON.parse(revision.payload),{after,blockNotes}=applyExactNotes(payload,entry.edits);
  const next=db.prepare('SELECT MAX(version) n FROM revisions WHERE document_id=?').get(current.id).n+1;
  const markdown=markdownOf(current.kind,after),articleId=current.kind==='news'?after.id:'record-'+current.id;
  if(!articleId)throw Error('Missing stable article identity');
  const privateData=validatePrivateEditorial({version:1,bodySha:digest(markdown),internalNotes:{},blockNotes,modelSignatures:[]});
  const path='.local/internal-note-migrations/'+articleId+'/internal-notes.json',bytes=JSON.stringify(privateData);
  const bundle={articleId,revision:next,files:[{path,sha256:digest(bytes),data:Buffer.from(bytes).toString('base64')}]};
  const archivePayload=JSON.stringify(bundle),archiveId=digest(archivePayload);
  documents.push({...entry,after,next,owner:archiveOwner(db,current.id,entry.revision),archivePayload,archiveId,privateNotesPath:path,articleId});
 }
 return {version:1,siteId:input.siteId,inputSha256:digest(JSON.stringify(input)),documents};
}
export async function applyPlan(db,plan,{backup,enqueueSiteBuild,audit}){
 if(!backup)throw Error('Backup required');
 await mkdir(dirname(backup),{recursive:true,mode:0o700});
 if(await access(backup).then(()=>true,()=>false))throw Error('Backup already exists');
 await db.backup(backup);
 return db.transaction(()=>{
  if(db.prepare("SELECT 1 FROM jobs WHERE status IN ('queued','running') UNION ALL SELECT 1 FROM site_jobs WHERE status IN ('queued','running') LIMIT 1").get())throw Error('Publication queue is active');
  const action='content.internal-notes.migrate';
  if(db.prepare('SELECT 1 FROM audit WHERE action=? AND detail=?').get(action,plan.inputSha256))throw Error('Migration already applied; read its receipt');
  for(const d of plan.documents){
   if(!isDeepStrictEqual({...db.prepare('SELECT * FROM documents WHERE id=?').get(d.document.id)},d.document))throw Error('Concurrent document change');
   const old=db.prepare('SELECT payload FROM revisions WHERE document_id=? AND version=?').get(d.document.id,d.revision);
   if(!old||digest(old.payload)!==d.payloadSha256)throw Error('Concurrent revision change');
   const expected=applyExactNotes(JSON.parse(old.payload),d.edits).after;
   if(!isDeepStrictEqual(expected,d.after)||digest(d.archivePayload)!==d.archiveId)throw Error('Plan changed');
   const bundle=JSON.parse(d.archivePayload),file=bundle.files[0],bytes=Buffer.from(file.data,'base64');
   if(bundle.articleId!==d.articleId||bundle.revision!==d.next||digest(bytes)!==file.sha256)throw Error('Private archive changed');
   validatePrivateEditorial(JSON.parse(bytes.toString()));
   db.prepare('INSERT INTO revisions VALUES(?,?,?,?,?,?)').run(d.document.id,d.next,JSON.stringify(d.after),d.owner,'将已确认的制作说明移入私有作者备注；原版保留',Date.now());
   const mapped=v=>v===d.revision?d.next:v;
   db.prepare('UPDATE documents SET latest_revision=?,approved_revision=?,published_revision=?,updated=? WHERE id=?').run(mapped(d.document.latest_revision),mapped(d.document.approved_revision),mapped(d.document.published_revision),Date.now(),d.document.id);
   db.prepare('INSERT INTO source_archives VALUES(?,?,?,?,?,?)').run(d.archiveId,d.owner,d.document.id,d.next,gzipSync(d.archivePayload),Date.now());
   const archived=db.prepare('SELECT payload,actor FROM source_archives WHERE id=?').get(d.archiveId);
   if(archived.actor!==d.owner||digest(gunzipSync(archived.payload))!==d.archiveId)throw Error('Archive readback failed');
   audit(db,'internal-notes-migration',action,d.document.id,plan.inputSha256);
  }
  const job=plan.documents.some(d=>d.document.published_revision)?enqueueSiteBuild(db,'internal-notes-migration'):null;
  return {siteId:plan.siteId,inputSha256:plan.inputSha256,backup,job,documents:plan.documents.map(d=>({documentId:d.document.id,articleId:d.articleId,previousRevision:d.revision,version:d.next,archiveId:d.archiveId,archiveSha256:d.archiveId,privateNotesPath:d.privateNotesPath,changes:d.edits.length,permalink:d.document.permalink}))};
 })();
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [database,inputFile,runtime,mode,backup]=process.argv.slice(2);
 if(!database||!inputFile||!runtime||!['plan','apply'].includes(mode))throw Error('Usage: database exact-edits.json runtime-root plan|apply [backup.sqlite]');
 const input=JSON.parse(await readFile(inputFile,'utf8'));
 const site=JSON.parse(await readFile(join(resolve(runtime),'sites/profiles.json'),'utf8')).find(s=>s.id===input.siteId);
 if(!site)throw Error('Unknown site');
 process.env.SCHOLAY_SITE_JSON=JSON.stringify(site);
 const {openStore,enqueueSiteBuild,audit}=await import(pathToFileURL(join(resolve(runtime),'admin/store.mjs')));
 const {recordMarkdown}=await import(pathToFileURL(join(resolve(runtime),'scripts/editorial-record.mjs')));
 const db=openStore(database);
 try{
  const plan=preparePlan(db,input,{markdownOf:(kind,data)=>kind==='news'?data.markdown:recordMarkdown(kind,data)});
  if(mode==='apply'){
   const receipt=await applyPlan(db,plan,{backup,enqueueSiteBuild,audit});
   await writeFile(inputFile+'.receipt.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
   console.log(JSON.stringify({siteId:plan.siteId,documents:receipt.documents.length,job:receipt.job}));
  }else console.log(JSON.stringify({siteId:plan.siteId,documents:plan.documents.length,changes:plan.documents.reduce((s,d)=>s+d.edits.length,0)}));
 }finally{db.close();}
}
