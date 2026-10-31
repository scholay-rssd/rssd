// A read-only export of an already accepted publication, scoped to its original
// credential. Transport bytes and editorial content have separate digests.
import {createHash} from 'node:crypto';
import {sourceContentSha256} from '../contracts/language-editions.mjs';
import {continuationArtifactSha256} from './publishing-flow-artifact.mjs';

const fail=()=>{throw Object.assign(Error('Original cloud recovery packet identity is invalid'),{statusCode:409});};
const check=value=>{if(!value)fail();};
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&Object.keys(value).every(key=>keys.includes(key));
const known=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));
const jobId=(site,key)=>createHash('sha256').update(JSON.stringify([site,key])).digest('hex');
export function validateRecoveryPacket(response,expected={}){
 check(exact(response,['version','status','jobId','siteId','articleId','requestKey','continuationOwner','packetSha256','sourceSha256','packet','receipt']));
 check(response.version===1&&response.status==='ready'&&response.continuationOwner==='cloud'&&hex(response.jobId)&&hex(response.packetSha256)&&hex(response.sourceSha256));
 for(const key of ['jobId','siteId','articleId','requestKey'])if(expected[key]!==undefined)check(response[key]===expected[key]);
 const packet=response.packet;
 check(known(packet,['siteId','spaceId','origin','data','intent','releaseLocal','expectedVersion','expectedPublishedVersion','requestKey','sourceSha256','localFingerprint','preparedAt']));
 check(packet.requestKey===response.requestKey&&packet.siteId===response.siteId&&packet.data?.id===response.articleId&&(packet.intent||'publish')==='publish'&&hex(packet.sourceSha256));
 check(packet.localFingerprint===undefined||hex(packet.localFingerprint));
 check(packet.preparedAt===undefined||typeof packet.preparedAt==='string'&&Number.isFinite(Date.parse(packet.preparedAt)));
 check(packet.releaseLocal===undefined||typeof packet.releaseLocal==='boolean');
 check(response.jobId===jobId(response.siteId,response.requestKey)&&response.packetSha256===continuationArtifactSha256(packet)&&response.sourceSha256===sourceContentSha256(packet.data));
 if(expected.origin!==undefined)check(packet.origin===expected.origin);
 check(known(packet.data,['id','title','summary','markdown','date','category','author','assets','sectionId','locale','translationOf','record'])&&Array.isArray(packet.data.assets));
 for(const asset of packet.data.assets)check(exact(asset,['path','data'])&&typeof asset.data==='string');
 if(packet.data.record)check(exact(packet.data.record,['documentId','kind','fields']));
 const receipt=response.receipt;
 check(exact(receipt,['requestKey','revision','url','publicReadback','job'])&&receipt.requestKey===response.requestKey&&Number.isSafeInteger(receipt.revision)&&receipt.revision>0&&typeof receipt.url==='string'&&receipt.url.startsWith('/')&&!receipt.url.startsWith('//')&&receipt.publicReadback===true&&exact(receipt.job,['id','status'])&&typeof receipt.job.id==='string'&&receipt.job.id&&receipt.job.status==='success');
 return response;
}
