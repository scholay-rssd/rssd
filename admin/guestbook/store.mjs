import Database from '../sqlite.mjs';
import {mkdirSync,chmodSync,lstatSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
export function openGuestbook(path,siteId){
 if(path!==':memory:'){
  mkdirSync(dirname(path),{recursive:true,mode:0o700});
  try{if(lstatSync(path).isSymbolicLink())throw Error('Guestbook database cannot be a symlink');}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 const db=new Database(path);
 try{
  if(path!==':memory:')chmodSync(path,0o600);
  db.pragma('journal_mode = WAL');db.pragma('busy_timeout = 5000');
  db.exec(`CREATE TABLE IF NOT EXISTS guestbook_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,visitor TEXT NOT NULL,day TEXT NOT NULL,request_key TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),created INTEGER NOT NULL,reviewed INTEGER,reviewer TEXT,UNIQUE(visitor,request_key));
   CREATE INDEX IF NOT EXISTS messages_quota ON messages(visitor,day);
   CREATE INDEX IF NOT EXISTS messages_public ON messages(status,created);
   CREATE TABLE IF NOT EXISTS guard(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);`);
  db.transaction(()=>{
   db.prepare("INSERT OR IGNORE INTO guestbook_meta VALUES('site',?)").run(siteId);
   if(db.prepare("SELECT value FROM guestbook_meta WHERE key='site'").get().value!==siteId)throw Error('Guestbook belongs to another site');
   db.prepare("INSERT OR IGNORE INTO guestbook_meta VALUES('secret',?)").run(randomBytes(32).toString('hex'));
  })();
  return db;
 }catch(e){db.close();throw e;}
}
export function countToday(db,visitor,day){return db.prepare('SELECT count(*) AS n FROM messages WHERE visitor=? AND day=?').get(visitor,day).n;}
export function submit(db,{visitor,day,key,payload,now}){
 return db.transaction(()=>{
  const existing=db.prepare('SELECT id,payload FROM messages WHERE visitor=? AND request_key=?').get(visitor,key);
  if(existing){if(existing.payload!==JSON.stringify(payload))throw Object.assign(Error('该提交编号已用于其他内容，请重新提交'),{statusCode:409});return {id:existing.id,replayed:true};}
  if(countToday(db,visitor,day)>=2)throw Object.assign(Error('今天已提交两条留言，请明天再来'),{statusCode:429});
  const id=randomUUID();db.prepare('INSERT INTO messages(id,visitor,day,request_key,payload,created) VALUES(?,?,?,?,?,?)').run(id,visitor,day,key,JSON.stringify(payload),now);
  return {id,replayed:false};
 })();
}
export function guard(db,key,max,windowMs,now){
 db.transaction(()=>{
  db.prepare('DELETE FROM guard WHERE expires<=?').run(now);
  const row=db.prepare('SELECT count FROM guard WHERE key=?').get(key);
  if(row?.count>=max)throw Object.assign(Error('请求过于频繁，请稍后重试'),{statusCode:429});
  db.prepare('INSERT INTO guard VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key,now+windowMs);
 })();
}
