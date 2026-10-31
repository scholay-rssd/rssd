import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import p from '../contracts/rssd-v1.cjs';
import {publication,contentKey} from '../contracts/rssd-publication.cjs';

export class ReceiverStore {
  constructor(file,site) {
    this.site=site;mkdirSync(dirname(file),{recursive:true});this.db=new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, hash TEXT NOT NULL, work_key TEXT NOT NULL, revision INTEGER NOT NULL,
        payload TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued', error TEXT, receipt TEXT, created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS requests_queue ON requests(state,created);
      CREATE TABLE IF NOT EXISTS heads(work_key TEXT PRIMARY KEY,revision INTEGER NOT NULL,route TEXT UNIQUE NOT NULL,request_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS published(work_key TEXT PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
  }
  close(){this.db.close();}
  seedLegacyHeads(baseline={}){return this.transaction(()=>{
    for(const [key,item] of Object.entries(baseline.rssdIdentity||{})){
      if(!/^[a-f0-9]{64}$/.test(key)||typeof item.route!=='string'||!Number.isSafeInteger(item.revision))p.fail('Invalid legacy identity map');
      const occupied=this.db.prepare('SELECT work_key FROM heads WHERE route=?').get(item.route);
      if(occupied&&occupied.work_key!==key)p.fail('Legacy route collides with received content',409,'route_conflict');
      const existing=this.db.prepare('SELECT route FROM heads WHERE work_key=?').get(key);
      if(existing&&existing.route!==item.route)p.fail('Legacy identity has two public routes',409,'route_conflict');
      this.db.prepare('INSERT INTO heads VALUES(?,?,?,?) ON CONFLICT(work_key) DO NOTHING').run(key,item.revision,item.route,'legacy:'+item.documentId);
    }
  });}
  transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  receipt(id){
    p.id(id);const r=this.db.prepare('SELECT * FROM requests WHERE id=?').get(id);
    if(!r)p.fail('Request not found',404,'not_found');const packet=JSON.parse(r.payload);
    return {requestId:r.id,siteId:this.site.id,workId:packet.workId,locale:packet.locale,revision:r.revision,contentHash:packet.contentHash,
      packetHash:r.hash,state:r.state,error:r.error,...JSON.parse(r.receipt||'{}')};
  }
  accept(input){
    const value=publication(input);if(value.siteId!==this.site.id||value.workspaceId!==this.site.spaceId)p.fail('Site/workspace mismatch',403);
    if(!this.site.sections.some(s=>s.id===value.sectionId))p.fail('Unknown site section');
    const hash=p.hash(value),key=contentKey(value);
    return this.transaction(()=>{
      const old=this.db.prepare('SELECT hash FROM requests WHERE id=?').get(value.requestId);
      if(old){if(old.hash!==hash)p.fail('Request identity reused',409,'request_conflict');return this.receipt(value.requestId);}
      const head=this.db.prepare('SELECT * FROM heads WHERE work_key=?').get(key);
      if(head&&head.revision>=value.revision)p.fail('A newer or identical revision was already received',409,'stale_revision');
      if(head&&head.route!==value.route)p.fail('Published identity must retain its route',409,'route_conflict');
      const occupied=this.db.prepare('SELECT work_key FROM heads WHERE route=?').get(value.route);
      if(occupied&&occupied.work_key!==key)p.fail('Public route belongs to another work',409,'route_conflict');
      this.db.prepare('INSERT INTO requests(id,hash,work_key,revision,payload,created) VALUES(?,?,?,?,?,?)').run(value.requestId,hash,key,value.revision,JSON.stringify(value),Date.now());
      this.db.prepare('INSERT INTO heads VALUES(?,?,?,?) ON CONFLICT(work_key) DO UPDATE SET revision=excluded.revision,request_id=excluded.request_id').run(key,value.revision,value.route,value.requestId);
      return this.receipt(value.requestId);
    });
  }
  claim(){return this.transaction(()=>{
    const row=this.db.prepare("SELECT * FROM requests WHERE state='building' ORDER BY created,id LIMIT 1").get()||this.db.prepare("SELECT * FROM requests WHERE state='queued' ORDER BY created,id LIMIT 1").get();
    if(!row)return null;const resume=row.state==='building';
    this.db.prepare("UPDATE requests SET state='building' WHERE id=?").run(row.id);
    const packet=JSON.parse(row.payload),all=this.db.prepare('SELECT payload FROM published WHERE work_key<>?').all(row.work_key).map(x=>JSON.parse(x.payload));
    return {id:row.id,packet,packets:[...all,packet],resume};
  });}
  finish(id,receipt){return this.transaction(()=>{
    const row=this.db.prepare('SELECT * FROM requests WHERE id=?').get(id);
    if(!row||row.state!=='building')p.fail('Request is not building',409);
    const packet=JSON.parse(row.payload);
    if(receipt.requestId!==id||receipt.contentHash!==packet.contentHash||receipt.packetHash!==row.hash||receipt.revision!==row.revision||!receipt.release)p.fail('Release identity mismatch',409);
    this.db.prepare('INSERT INTO published VALUES(?,?,?) ON CONFLICT(work_key) DO UPDATE SET revision=excluded.revision,payload=excluded.payload WHERE excluded.revision>published.revision').run(row.work_key,row.revision,row.payload);
    this.db.prepare("UPDATE requests SET state='success',receipt=?,error=NULL WHERE id=?").run(JSON.stringify(receipt),id);
    return this.receipt(id);
  });}
  fail(id,message){this.db.prepare("UPDATE requests SET state='failed',error=? WHERE id=? AND state='building'").run(String(message).slice(0,1500),id);return this.receipt(id);}
  retry(id){return this.transaction(()=>{
    const row=this.db.prepare('SELECT * FROM requests WHERE id=?').get(id);if(!row)p.fail('Request not found',404);
    if(row.state!=='failed')return this.receipt(id);
    const head=this.db.prepare('SELECT revision FROM heads WHERE work_key=?').get(row.work_key);
    if(head.revision!==row.revision)p.fail('Newer revision already received',409,'stale_revision');
    this.db.prepare("UPDATE requests SET state='queued',error=NULL WHERE id=?").run(id);return this.receipt(id);
  });}
}
