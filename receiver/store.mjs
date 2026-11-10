import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import p from '../contracts/rssd-v1.cjs';
import {publication,contentKey,operation,visible} from '../contracts/rssd-publication.cjs';
import {preflightAcademicNews} from './academic-preflight.mjs';

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
    // Additive migration: accepted requests and their packet hashes survive a
    // receiver upgrade. Older publication revisions form the initial sequence.
    const add=(table,name,type,backfill)=>{if(!this.db.prepare('PRAGMA table_info('+table+')').all().some(c=>c.name===name)){this.db.exec('ALTER TABLE '+table+' ADD COLUMN '+name+' '+type);if(backfill)this.db.exec(backfill);}};
    add('heads','operation_sequence','INTEGER NOT NULL DEFAULT 0','UPDATE heads SET operation_sequence=coalesce((SELECT revision FROM requests WHERE id=heads.request_id),0)');
    add('heads','operation','TEXT NOT NULL DEFAULT \'publish\'');
    add('heads','content_hash','TEXT');
    add('heads','content_fingerprint','TEXT');
    add('requests','operation_sequence','INTEGER NOT NULL DEFAULT 0','UPDATE requests SET operation_sequence=revision');
    add('published','operation_sequence','INTEGER NOT NULL DEFAULT 0','UPDATE published SET operation_sequence=revision');
    add('published','previous_payload','TEXT');
    for(const row of this.db.prepare('SELECT h.work_key,r.payload FROM heads h JOIN requests r ON r.id=h.request_id WHERE h.content_fingerprint IS NULL').all()){
      const packet=JSON.parse(row.payload);if(visible(packet))this.db.prepare('UPDATE heads SET content_hash=?,content_fingerprint=? WHERE work_key=?').run(packet.contentHash,p.hash([packet.content,packet.assets||[]]),row.work_key);
    }
  }
  close(){this.db.close();}
  seedLegacyHeads(baseline={}){return this.transaction(()=>{
    const identityHash=p.hash(baseline.rssdIdentity||{}),previous=this.db.prepare("SELECT value FROM state WHERE key='legacyIdentityHash'").get();
    if(previous&&previous.value!==identityHash&&this.db.prepare('SELECT count(*) AS n FROM requests').get().n)p.fail('Legacy baseline cannot change after center publication has started',409,'baseline_locked');
    for(const [key,item] of Object.entries(baseline.rssdIdentity||{})){
      if(!/^[a-f0-9]{64}$/.test(key)||typeof item.route!=='string'||!Number.isSafeInteger(item.revision))p.fail('Invalid legacy identity map');
      const occupied=this.db.prepare('SELECT work_key FROM heads WHERE route=?').get(item.route);
      if(occupied&&occupied.work_key!==key)p.fail('Legacy route collides with received content',409,'route_conflict');
      const existing=this.db.prepare('SELECT * FROM heads WHERE work_key=?').get(key);
      const legacy=existing&&!this.db.prepare('SELECT id FROM requests WHERE id=?').get(existing.request_id);
      if(existing&&existing.route!==item.route)p.fail('Legacy identity has two public routes',409,'route_conflict');
      if(legacy&&existing.revision>item.revision)p.fail('Legacy baseline revision moved backwards',409,'stale_revision');
      if(item.contentHash!==undefined&&!/^[a-f0-9]{64}$/.test(item.contentHash))p.fail('Invalid legacy content hash');
      this.db.prepare('INSERT INTO heads(work_key,revision,route,request_id,operation,content_hash) VALUES(?,?,?,?,?,?) ON CONFLICT(work_key) DO NOTHING').run(key,item.revision,item.route,'legacy:'+item.documentId,item.deleted?'delete':'publish',item.contentHash||null);
      if(legacy)this.db.prepare('UPDATE heads SET revision=?,operation=?,content_hash=? WHERE work_key=?').run(item.revision,item.deleted?'delete':'publish',item.contentHash||null,key);
    }
    this.db.prepare("INSERT INTO state VALUES('legacyIdentityHash',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(identityHash);
  });}
  status(){return {siteId:this.site.id,workspaceId:this.site.spaceId,requests:this.db.prepare('SELECT state,count(*) AS count FROM requests GROUP BY state').all(),publications:this.db.prepare("SELECT count(*) AS count FROM published WHERE coalesce(json_extract(payload,'$.operation'),'publish') IN ('publish','restore')").get().count,tombstones:this.db.prepare("SELECT count(*) AS count FROM published WHERE json_extract(payload,'$.operation') IN ('withdraw','delete')").get().count,legacyIdentityHash:this.db.prepare("SELECT value FROM state WHERE key='legacyIdentityHash'").get()?.value||null};}
  head(workId,locale){p.id(workId);p.locale(locale);const row=this.db.prepare('SELECT * FROM heads WHERE work_key=?').get(contentKey({workId,locale}));if(!row)p.fail('Publication identity not found',404,'not_found');const request=this.db.prepare('SELECT state FROM requests WHERE id=?').get(row.request_id);return {siteId:this.site.id,workspaceId:this.site.spaceId,workId,locale,revision:row.revision,operationSequence:row.operation_sequence,operation:row.operation,route:row.route,contentHash:row.content_hash,requestId:row.request_id,state:request?.state||'legacy'};}
  transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  receipt(id){
    p.id(id);const r=this.db.prepare('SELECT * FROM requests WHERE id=?').get(id);
    if(!r)p.fail('Request not found',404,'not_found');const packet=JSON.parse(r.payload);
    return {requestId:r.id,siteId:this.site.id,workId:packet.workId,locale:packet.locale,revision:r.revision,contentHash:packet.contentHash,
      packetHash:r.hash,operation:operation(packet),operationSequence:r.operation_sequence,state:r.state,error:r.error,...JSON.parse(r.receipt||'{}')};
  }
  accept(input){
    const value=publication(input);if(value.siteId!==this.site.id||value.workspaceId!==this.site.spaceId)p.fail('Site/workspace mismatch',403);
    if(!this.site.sections.some(s=>s.id===value.sectionId))p.fail('Unknown site section');
    const hash=p.hash(value),key=contentKey(value);
    return this.transaction(()=>{
      const old=this.db.prepare('SELECT hash FROM requests WHERE id=?').get(value.requestId);
      if(old){if(old.hash!==hash)p.fail('Request identity reused',409,'request_conflict');return this.receipt(value.requestId);}
      preflightAcademicNews(value,this.site);
      const head=this.db.prepare('SELECT * FROM heads WHERE work_key=?').get(key);
      const action=operation(value),sequence=(head?.operation_sequence||0)+1;
      if(action==='publish'){
        if(head&&head.revision>=value.revision)p.fail('A newer or identical revision was already received',409,'stale_revision');
        if(head&&['withdraw','delete'].includes(head.operation))p.fail('Explicitly restore the hidden edition before publishing',409,'edition_hidden');
      }else{
        if(!head)p.fail('Action requires an existing publication identity',404,'not_found');
        if(head.revision!==value.expectedRevision||head.operation_sequence!==value.expectedOperationSequence)p.fail('Publication changed before action',409,'action_conflict');
        if(action==='restore'){
          if(!['withdraw','delete'].includes(head.operation))p.fail('Only a hidden edition can be restored',409,'action_conflict');
          if(value.revision<head.revision)p.fail('Restore cannot rewind the edition revision',409,'stale_revision');
          if(value.revision===head.revision&&(head.content_hash&&head.content_hash!==value.contentHash||head.content_fingerprint&&head.content_fingerprint!==p.hash([value.content,value.assets||[]])))p.fail('Same revision cannot restore different content',409,'content_conflict');
        }else{
          if(value.revision!==head.revision)p.fail('Action must identify the current edition revision',409,'stale_revision');
          if(head.content_hash&&value.contentHash!==head.content_hash)p.fail('Action content hash differs',409,'content_conflict');
        }
      }
      if(value.operationSequence!==undefined&&value.operationSequence!==sequence)p.fail('Action sequence is stale or has a gap',409,'action_conflict');
      if(head&&head.route!==value.route)p.fail('Published identity must retain its route',409,'route_conflict');
      const occupied=this.db.prepare('SELECT work_key FROM heads WHERE route=?').get(value.route);
      if(occupied&&occupied.work_key!==key)p.fail('Public route belongs to another work',409,'route_conflict');
      this.db.prepare('INSERT INTO requests(id,hash,work_key,revision,payload,created,operation_sequence) VALUES(?,?,?,?,?,?,?)').run(value.requestId,hash,key,value.revision,JSON.stringify(value),Date.now(),sequence);
      this.db.prepare('INSERT INTO heads(work_key,revision,route,request_id,operation_sequence,operation,content_hash,content_fingerprint) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(work_key) DO UPDATE SET revision=excluded.revision,request_id=excluded.request_id,operation_sequence=excluded.operation_sequence,operation=excluded.operation,content_hash=excluded.content_hash,content_fingerprint=excluded.content_fingerprint').run(key,value.revision,value.route,value.requestId,sequence,action,value.contentHash,visible(value)?p.hash([value.content,value.assets||[]]):head?.content_fingerprint||null);
      return this.receipt(value.requestId);
    });
  }
  claim(){return this.transaction(()=>{
    const row=this.db.prepare("SELECT * FROM requests WHERE state='building' ORDER BY created,operation_sequence,id LIMIT 1").get()||this.db.prepare("SELECT r.* FROM requests r WHERE r.state='queued' AND NOT EXISTS (SELECT 1 FROM requests previous WHERE previous.work_key=r.work_key AND previous.operation_sequence<r.operation_sequence AND previous.state IN ('queued','building')) ORDER BY r.created,r.id LIMIT 1").get();
    if(!row)return null;const resume=row.state==='building';
    this.db.prepare("UPDATE requests SET state='building' WHERE id=?").run(row.id);
    const packet=JSON.parse(row.payload),published=this.db.prepare('SELECT * FROM published').all(),all=published.filter(x=>x.work_key!==row.work_key).map(x=>JSON.parse(x.payload));
    const previousPackets=published.flatMap(x=>x.previous_payload?[JSON.parse(x.previous_payload)]:x.work_key===row.work_key&&!visible(packet)?[JSON.parse(x.payload)]:[]);
    return {id:row.id,packet,packets:[...all,packet],previousPackets,operationSequence:row.operation_sequence,resume};
  });}
  finish(id,receipt){return this.transaction(()=>{
    const row=this.db.prepare('SELECT * FROM requests WHERE id=?').get(id);
    if(!row||row.state!=='building')p.fail('Request is not building',409);
    const packet=JSON.parse(row.payload);
    if(receipt.requestId!==id||receipt.contentHash!==packet.contentHash||receipt.packetHash!==row.hash||receipt.revision!==row.revision||receipt.operationSequence!==row.operation_sequence||receipt.operation!==operation(packet)||!receipt.release)p.fail('Release identity mismatch',409);
    const previous=this.db.prepare('SELECT * FROM published WHERE work_key=?').get(row.work_key),previousPayload=!visible(packet)?(previous&&visible(JSON.parse(previous.payload))?previous.payload:previous?.previous_payload):null;
    this.db.prepare('INSERT INTO published(work_key,revision,payload,operation_sequence,previous_payload) VALUES(?,?,?,?,?) ON CONFLICT(work_key) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,operation_sequence=excluded.operation_sequence,previous_payload=excluded.previous_payload WHERE excluded.operation_sequence>published.operation_sequence').run(row.work_key,row.revision,row.payload,row.operation_sequence,previousPayload||null);
    this.db.prepare("UPDATE requests SET state='success',receipt=?,error=NULL WHERE id=?").run(JSON.stringify(receipt),id);
    return this.receipt(id);
  });}
  fail(id,message){this.db.prepare("UPDATE requests SET state='failed',error=? WHERE id=? AND state='building'").run(String(message).slice(0,1500),id);return this.receipt(id);}
  retry(id){return this.transaction(()=>{
    const row=this.db.prepare('SELECT * FROM requests WHERE id=?').get(id);if(!row)p.fail('Request not found',404);
    if(row.state!=='failed')return this.receipt(id);
    const head=this.db.prepare('SELECT revision,operation_sequence FROM heads WHERE work_key=?').get(row.work_key);
    if(head.revision!==row.revision||head.operation_sequence!==row.operation_sequence)p.fail('Newer publication or action already received',409,'stale_revision');
    this.db.prepare("UPDATE requests SET state='queued',error=NULL WHERE id=?").run(id);return this.receipt(id);
  });}
}
