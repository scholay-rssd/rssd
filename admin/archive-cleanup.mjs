import {readFile,writeFile,realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openStore,readDocument,saveDocument,createDocument,setReview,enqueueBatch,audit} from './store.mjs';
import {digest,validate} from './model.mjs';
import {archiveSection} from '../scripts/archive-model.mjs';

export function archiveState(db){
  return digest(JSON.stringify(db.prepare('SELECT id,kind,latest_revision,published_revision,review_state FROM documents ORDER BY id').all()));
}
export function cleanupPlan(db,{expectedState,articles=[],corrections=[]}={}){
  if(expectedState&&expectedState!==archiveState(db))throw Error('线上版本已变化，请重新读取后再清洗');
  if(db.prepare("SELECT 1 FROM jobs WHERE status IN ('queued','running')").get())throw Error('等待现有发布队列完成后重试');
  if(db.prepare('SELECT 1 FROM documents WHERE latest_revision IS NOT published_revision').get())throw Error('有尚未发布的管理员修改，停止批次以保留现场');
  const changes=[],incoming=new Map(articles.map(x=>[x.id,validate('news',x)]));
  const patches=new Map(corrections.map(x=>[x.sourceKey,x]));
  if(patches.size!==corrections.length)throw Error('修正清单重复');
  if(incoming.size!==articles.length)throw Error('稿件 ID 重复');
  for(const row of db.prepare('SELECT id FROM documents ORDER BY id').all()){
    const doc=readDocument(db,row.id);let next=structuredClone(doc.data);
    const correction=patches.get(doc.source_key);
    if(correction){
      if(correction.expectedTitle!==next.title)throw Error('待修正条目的标题已变化');
      if(Object.keys(correction.patch).some(key=>!['title','sourceUrl','sourceName','dateBasis'].includes(key)))throw Error('修正清单包含不允许覆盖的字段');
      Object.assign(next,correction.patch);patches.delete(doc.source_key);
    }
    if(doc.kind==='year'){
      if(['待核验','来源待核验'].includes(next.provenance))next.provenance='已核验';
      // Fill only from existing text; dates, tags, attribution and IDs are untouched.
      if(!next.summary?.trim())next.summary=next.body?.trim().slice(0,500)||next.title;
    }
    if(doc.kind==='news'){
      if(incoming.has(next.id)){next=incoming.get(next.id);incoming.delete(next.id);}
      next.category=archiveSection('news',next).name;
    }
    if(JSON.stringify(next)!==JSON.stringify(doc.data)){
      // Validation happens before any write. The original revision remains available.
      validate(doc.kind,next,doc.data);
      changes.push({id:doc.id,version:doc.latest_revision,kind:doc.kind,data:next});
    }
  }
  if(patches.size)throw Error('修正清单中的记录未找到');
  for(const data of incoming.values())changes.push({kind:'news',data:{...data,category:archiveSection('news',data).name}});
  return changes;
}
export function applyCleanup(db,input,actor='owner-approved-archive-cleanup'){
  return db.transaction(()=>{
    const changes=cleanupPlan(db,input);if(!changes.length)return {count:0};
    const members=changes.map(change=>{
      const row=change.id?saveDocument(db,change.id,change.data,change.version,actor,'维护者确认存量已核验；学术档案首批整理'):createDocument(db,change.kind,change.data,actor);
      setReview(db,row.id,row.latest_revision,'approved',actor);
      return {id:row.id,version:row.latest_revision};
    });
    const job=enqueueBatch(db,members,actor);audit(db,actor,'archive.cleanup',job.id,JSON.stringify({count:job.count,verification:'owner confirmed existing content',imagePolicy:'scholay-watermark-webp-v1'}));
    return job;
  })();
}
if(process.argv[1]&&await realpath(process.argv[1])===fileURLToPath(import.meta.url)){
  const db=openStore(process.env.SCHOLAY_ADMIN_DB||resolve('.admin-local/admin.sqlite'));
  try{
    const [command,path]=process.argv.slice(2);
    if(command==='export'){
      const docs=db.prepare('SELECT id FROM documents ORDER BY id').all().map(x=>readDocument(db,x.id));
      await writeFile(path,JSON.stringify({expectedState:archiveState(db),documents:docs.map(x=>({id:x.id,kind:x.kind,version:x.latest_revision,permalink:x.permalink,data:x.published})).filter(x=>x.data)}),{mode:0o600});
      console.log('Exported published content only: '+docs.length);
    }else{
      const input=JSON.parse(await readFile(path,'utf8'));
      if(command==='plan'){const changes=cleanupPlan(db,input);console.log(JSON.stringify({count:changes.length,byKind:changes.reduce((a,x)=>(a[x.kind]=(a[x.kind]||0)+1,a),{})}));}
      else if(command==='apply')console.log(JSON.stringify(applyCleanup(db,input)));
      else throw Error('Commands: export <private file>, plan <manifest>, apply <manifest>');
    }
  }finally{db.close();}
}
