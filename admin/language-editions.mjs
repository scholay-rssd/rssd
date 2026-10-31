import {asEditorialRecord} from '../scripts/editorial-record.mjs';
import {sourceContentSha256} from '../contracts/language-editions.mjs';

// Check inside the caller's transaction. A late background result may neither
// overwrite the Chinese source nor publish against an administrator's edit.
export function assertEditionSource(db,data){
  if(!data?.translationOf)return;
  const source=data.translationOf;
  const structured=/^record-[a-f0-9-]{36}$/.test(source.articleId);
  const row=db.prepare("SELECT d.id,d.kind,d.updated,d.latest_revision,d.published_revision,r.payload FROM documents d JOIN revisions r ON r.document_id=d.id AND r.version=d.published_revision WHERE "+(structured?"d.kind<>'news' AND d.id=?":"d.kind='news' AND d.source_key=?")+" AND NOT EXISTS(SELECT 1 FROM document_tombstones t WHERE t.document_id=d.id)").get(structured?source.articleId.slice(7):'news:'+source.articleId);
  const fail=()=>{throw Object.assign(Error('译文依据的中文版本已变化或尚未公开，请重新对齐'),{statusCode:409});};
  if(!row||row.latest_revision!==source.revision||row.published_revision!==source.revision)fail();
  const original=asEditorialRecord(row,JSON.parse(row.payload));
  if(original.translationOf||sourceContentSha256(original)!==source.sha256)fail();
}
