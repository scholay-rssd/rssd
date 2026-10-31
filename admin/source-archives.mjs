import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {digest,fail} from './model.mjs';
import {validatePrivateEditorial} from '../contracts/article-internal-notes.mjs';

// Private originals are never part of the public snapshot or catalogue.
export function saveSourceArchive(db,{articleId,revision,files},actor,document){
  if(!document||document.latest_revision!==revision)fail('云端版本已变化，保留本地稿件',409);
  if(!Array.isArray(files)||!files.length||files.length>1500)fail('原稿归档文件数量无效');
  let total=0;const paths=new Set();
  for(const f of files){
    if(typeof f.path!=='string'||f.path.length>1000||f.path.startsWith('/')||f.path.includes('\\')||f.path.split('/').some(x=>!x||x==='.'||x==='..')||paths.has(f.path))fail('原稿归档路径无效');
    paths.add(f.path);
    if(typeof f.data!=='string'||!/^[a-f0-9]{64}$/.test(f.sha256||''))fail('原稿归档内容无效');
    const bytes=Buffer.from(f.data,'base64');total+=bytes.length;
    if(total>48*1024*1024||bytes.toString('base64')!==f.data||createHash('sha256').update(bytes).digest('hex')!==f.sha256)fail('原稿归档校验失败或超过 48 MB');
  }
  const payload=JSON.stringify({articleId,revision,files}),hash=digest(payload);
  db.prepare('INSERT OR IGNORE INTO source_archives(id,actor,document_id,revision,payload,created) VALUES(?,?,?,?,?,?)').run(hash,actor,document.id,revision,gzipSync(payload),Date.now());
  const row=db.prepare('SELECT actor FROM source_archives WHERE id=?').get(hash);
  if(row.actor!==actor)fail('归档不可访问',403);
  return {archiveId:hash,archiveSha256:hash,fileCount:files.length};
}
export function readSourceArchive(db,id,actor){
  const row=db.prepare('SELECT * FROM source_archives WHERE id=? AND actor=?').get(id,actor);if(!row)fail('原稿归档不存在',404);
  const payload=gunzipSync(row.payload,{maxOutputLength:68*1024*1024}).toString('utf8');
  if(digest(payload)!==id)fail('原稿归档校验失败',500);
  return {archiveId:id,archiveSha256:id,bundle:JSON.parse(payload)};
}
// Author notes are archived by whichever credential pushed the article. Any
// credential that can read this site's cloud drafts may read the newest notes
// at or below a version; manuscript files in the same bundle are never returned.
export function readPrivateNotes(db,documentId,revision){
  const bounded=Number.isSafeInteger(revision)&&revision>0;
  const rows=db.prepare('SELECT id,revision,payload FROM source_archives WHERE document_id=?'+(bounded?' AND revision<=?':'')+' ORDER BY revision DESC,created DESC').all(...(bounded?[documentId,revision]:[documentId]));
  for(const row of rows){
    const payload=gunzipSync(row.payload,{maxOutputLength:68*1024*1024}).toString('utf8');
    if(digest(payload)!==row.id)fail('原稿归档校验失败',500);
    const notes=(JSON.parse(payload).files||[]).filter(f=>/(^|\/)internal-notes\.json$/.test(f.path));
    if(!notes.length)continue;
    if(notes.length>1)fail('归档包含多份作者备注',409);
    const bytes=Buffer.from(notes[0].data,'base64');
    if(createHash('sha256').update(bytes).digest('hex')!==notes[0].sha256)fail('原稿归档校验失败',500);
    return {revision:row.revision,archiveId:row.id,privateEditorial:validatePrivateEditorial(JSON.parse(bytes.toString('utf8')))};
  }
  return {revision:null,privateEditorial:null};
}
