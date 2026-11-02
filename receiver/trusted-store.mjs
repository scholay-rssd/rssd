import {DatabaseSync} from 'node:sqlite';
import {createHmac,timingSafeEqual} from 'node:crypto';
import p from '../contracts/rssd-v1.cjs';
import pub from '../contracts/rssd-publication.cjs';
import {SOURCE_HASH_VERSION_V2} from '../web/engine/source-hash-v1.mjs';
const domain='rssd-translation-binding-v1\0';
const names=['version','siteId','workspaceId','receiverRequestId','receiverPacketHash','englishWorkId','englishRevision','englishContentHash','sourceWorkId','sourceLocale','sourceRevision','sourceArticleId','sourceEditionHash','sourceRenderHash','sourceHashVersion','orgId','destinationId'];
const independentNames=['version','sourceKind','siteId','workspaceId','receiverRequestId','receiverPacketHash','englishWorkId','englishRevision','englishContentHash','orgId','destinationId'];
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function identity(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid binding fields');
 const independent=value.version===2&&value.sourceKind==='independent',required=independent?independentNames:names;
 if(Object.keys(value).some(k=>!required.includes(k))||required.some(k=>!Object.hasOwn(value,k)))throw Error('invalid binding fields');
 if(!independent&&(value.version!==3||value.sourceHashVersion!==SOURCE_HASH_VERSION_V2))throw Error('unsupported binding or source hash version');
 for(const n of ['siteId','workspaceId','receiverRequestId','englishWorkId','orgId','destinationId',...(independent?[]:['sourceWorkId'])])p.id(value[n],n);
 for(const n of ['receiverPacketHash','englishContentHash',...(independent?[]:['sourceEditionHash','sourceRenderHash'])])if(!sha(value[n]))throw Error('invalid binding hash');
 for(const n of ['englishRevision',...(independent?[]:['sourceRevision'])])p.integer(value[n],n,1);
 if(!independent&&(value.sourceLocale!=='zh-CN'||value.englishWorkId!==value.sourceWorkId||typeof value.sourceArticleId!=='string'||!/^[a-z0-9][a-z0-9-]{2,99}$/.test(value.sourceArticleId)))throw Error('invalid source identity');
 return Object.fromEntries(required.map(n=>[n,value[n]]));
}
function mac(secret,keyId,issuedAt,binding){return createHmac('sha256',secret).update(domain).update(p.canonical({keyId,issuedAt,binding})).digest('hex');}
export function signCenterBinding(secret,keyId,issuedAt,record){
 if(!Buffer.isBuffer(secret)||secret.length<32||typeof keyId!=='string'||!keyId||!Number.isSafeInteger(issuedAt))throw Error('invalid signing configuration');
 const binding=identity(record);return {keyId,issuedAt,binding,signature:mac(secret,keyId,issuedAt,binding)};
}
export class BindingStore{
 constructor({file=':memory:',db,keys,lookupPacket,siteId,workspaceId,orgId,destinationId,now=()=>Math.floor(Date.now()/1000)}){
  this.keys=keys;this.lookupPacket=lookupPacket;this.siteId=p.id(siteId);this.workspaceId=p.id(workspaceId);this.orgId=orgId==null?null:p.id(orgId);this.destinationId=destinationId==null?null:p.id(destinationId);this.now=now;
  this.ownsDb=!db;this.db=db||new DatabaseSync(file);this.db.exec(`PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS bindings(request_id TEXT PRIMARY KEY, packet_hash TEXT NOT NULL UNIQUE, binding_hash TEXT NOT NULL, binding_json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS binding_refreshes(request_id TEXT PRIMARY KEY,binding_hash TEXT NOT NULL,state TEXT NOT NULL,release TEXT,error TEXT);`);
 }
 close(){if(this.ownsDb)this.db.close();}
 accept(envelope){
  if(!envelope||typeof envelope!=='object'||Object.keys(envelope).sort().join(',')!=='binding,issuedAt,keyId,signature')throw Error('invalid envelope');
  const binding=identity(envelope.binding),secret=this.keys[envelope.keyId];
  if(!Buffer.isBuffer(secret)||secret.length<32||!Number.isSafeInteger(envelope.issuedAt)||!sha(envelope.signature))throw Error('unauthenticated');
  const expected=Buffer.from(mac(secret,envelope.keyId,envelope.issuedAt,binding),'hex'),supplied=Buffer.from(envelope.signature,'hex');
  if(!timingSafeEqual(expected,supplied))throw Error('unauthenticated');
  if(binding.siteId!==this.siteId||binding.workspaceId!==this.workspaceId||binding.orgId!==this.orgId||binding.destinationId!==this.destinationId)throw Error('binding scope mismatch');
  const existing=this.lookupPacket(binding.receiverRequestId);if(!existing)throw Error('accepted receiver request not found');
  const packet=pub.publication(existing),packetHash=p.hash(packet);
  if(packetHash!==binding.receiverPacketHash||packet.requestId!==binding.receiverRequestId||packet.siteId!==binding.siteId||packet.workspaceId!==binding.workspaceId||packet.locale!=='en'||packet.workId!==binding.englishWorkId||packet.revision!==binding.englishRevision||packet.contentHash!==binding.englishContentHash)throw Error('accepted packet identity mismatch');
  if(envelope.issuedAt>this.now()+30)throw Error('binding authorization expired');
  const bindingHash=p.hash(binding);this.db.exec('BEGIN IMMEDIATE');
  try{
   const row=this.db.prepare('SELECT binding_hash,binding_json FROM bindings WHERE request_id=? OR packet_hash=?').get(binding.receiverRequestId,binding.receiverPacketHash);
   if(row){if(row.binding_hash!==bindingHash)throw Error('binding conflict');this.db.exec('COMMIT');const previous=JSON.parse(row.binding_json);return {state:previous.version===2?'independent':'verified',binding:previous,replayed:true};}
   const age=this.now()-envelope.issuedAt;if(age< -30||age>300)throw Error('binding authorization expired');
   this.db.prepare('INSERT INTO bindings VALUES(?,?,?,?)').run(binding.receiverRequestId,binding.receiverPacketHash,bindingHash,JSON.stringify(binding));this.db.prepare("INSERT INTO binding_refreshes(request_id,binding_hash,state) VALUES(?,?,'queued')").run(binding.receiverRequestId,bindingHash);this.db.exec('COMMIT');
   return {state:binding.version===2?'independent':'verified',binding,replayed:false};
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 lookup(packet){const hash=p.hash(pub.publication(packet)),row=this.db.prepare('SELECT binding_json FROM bindings WHERE request_id=? AND packet_hash=?').get(packet.requestId,hash);if(!row)return {state:'unknown'};const binding=JSON.parse(row.binding_json);if(binding.version!==2&&binding.sourceHashVersion!==SOURCE_HASH_VERSION_V2)return {state:'unknown'};return {state:binding.version===2?'independent':'verified',binding};}
}
