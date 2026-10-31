import {readFile} from 'node:fs/promises';
import {openStore,createDocument,setReview,enqueueBatch,pendingDocument,readDocument} from '../admin/store.mjs';
import {sourceKey} from '../admin/model.mjs';
export async function seedSite(site,file){
  if(site.legacy)throw Error('学术站保留现有数据库，不使用新站初始数据');
  const items=JSON.parse(await readFile(file||new URL('../sites/seeds/'+site.id+'.json',import.meta.url),'utf8'));
  const db=openStore(process.env.SCHOLAY_ADMIN_DB);let created=0;const members=[];
  try{return db.transaction(()=>{
    for(const item of items){
      const key='initial:'+site.id+':'+item.key;
      const existing=db.prepare('SELECT id FROM documents WHERE source_key=?').get(key);
      const row=existing?readDocument(db,existing.id):createDocument(db,item.kind,item.data,'initial-content',{key});
      if(!existing)created++;
      // Never overwrite or auto-approve an administrator's revision on rerun.
      if(!existing){setReview(db,row.id,row.latest_revision,'approved','initial-content');members.push({id:row.id,version:row.latest_revision});}
    }
    const job=members.length?enqueueBatch(db,members,'initial-content'):null;
    return {siteId:site.id,created,jobId:job?.id||null};
  })();}finally{db.close();}
}
