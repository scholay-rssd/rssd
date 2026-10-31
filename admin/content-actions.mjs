import {readDocument,setReview,enqueue,pendingDocument,audit} from './store.mjs';
import {digest,fail} from './model.mjs';

export function contentActionReceipt(db,entry){
  const row=readDocument(db,entry.document_id);
  const job=entry.job_id?db.prepare('SELECT id,status,error,release FROM jobs WHERE id=?').get(entry.job_id):null;
  return {requestKey:entry.key,action:entry.action,articleId:row.kind==='news'?row.data.id:'record-'+row.id,
    version:row.latest_revision,publishedVersion:row.published_revision,url:row.permalink,job,
    deleted:Boolean(db.prepare('SELECT 1 FROM document_tombstones WHERE document_id=?').get(row.id)),
    status:job?.status||'success'};
}

// Every action is tied to the versions shown in the confirmation dialog. A
// transport retry reuses the original request and cannot enqueue another job.
export function submitContentAction(db,input,actor){
  if(!input||input.confirmed!==true||!['publish','withdraw','delete'].includes(input.action))fail('请明确确认操作');
  if(!/^[a-zA-Z0-9_-]{12,128}$/.test(input.requestKey||''))fail('操作请求编号无效');
  if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1||!(input.expectedPublishedVersion===null||Number.isSafeInteger(input.expectedPublishedVersion)&&input.expectedPublishedVersion>0))fail('请提供已查看的云端版本');
  const fingerprint=digest(JSON.stringify([input.articleId,input.action,input.expectedVersion,input.expectedPublishedVersion]));
  return db.transaction(()=>{
    const old=db.prepare('SELECT * FROM content_actions WHERE key=?').get(input.requestKey);
    if(old){if(old.actor!==actor||old.payload_hash!==fingerprint)fail('请求编号已用于另一项操作',409);return contentActionReceipt(db,old);}
    const found=/^record-[a-f0-9-]{36}$/.test(input.articleId||'')
      ?db.prepare("SELECT id FROM documents WHERE id=? AND kind<>'news'").get(input.articleId.slice(7))
      :db.prepare("SELECT id FROM documents WHERE kind='news' AND source_key=?").get('news:'+input.articleId);
    if(!found)fail('云端作品不存在',404);
    const row=readDocument(db,found.id);
    if(db.prepare('SELECT 1 FROM document_tombstones WHERE document_id=?').get(row.id))fail('云端作品已删除',409);
    if(row.latest_revision!==input.expectedVersion||row.published_revision!==input.expectedPublishedVersion)fail('云端版本或公开状态已变化，请重新查看后操作',409);
    if(pendingDocument(db,row.id))fail('作品已有执行中的任务，请先查询结果',409);
    let job=null;
    if(input.action==='publish'){
      if(row.published_revision===row.latest_revision)fail('此版本已经公开',409);
      setReview(db,row.id,row.latest_revision,'approved',actor);
      job=enqueue(db,row.id,row.latest_revision,'publish',Date.now(),actor);
    }else if(input.action==='withdraw'){
      if(!row.published_revision)fail('作品目前未公开',409);
      job=enqueue(db,row.id,row.published_revision,'withdraw',Date.now(),actor);
    }else if(row.published_revision){
      job=enqueue(db,row.id,row.latest_revision,'delete',Date.now(),actor);
    }else{
      // Unpublished deletion needs no public-site rebuild. Keep revisions and
      // identities for recovery; deleting never deletes the local manuscript.
      db.prepare('INSERT INTO document_tombstones VALUES(?,?,?)').run(row.id,Date.now(),actor);
      audit(db,actor,'content.delete',row.id);
    }
    const entry={key:input.requestKey,actor,payload_hash:fingerprint,document_id:row.id,action:input.action,job_id:job?.id||null,created:Date.now()};
    db.prepare('INSERT INTO content_actions VALUES(?,?,?,?,?,?,?)').run(...Object.values(entry));
    return contentActionReceipt(db,entry);
  })();
}
