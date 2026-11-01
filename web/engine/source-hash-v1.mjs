import {createHash} from 'node:crypto';
// Frozen copy of the source-view fingerprint contract. Never alter v1 in place.
export const SOURCE_HASH_VERSION='rssd-source-view-sha256-v1';
export function sourceHashV1(data){
 const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,ordered(value[k])])):value;
 if(data.record){const {assets,...fields}=data.record.fields||{};return createHash('sha256').update(JSON.stringify({id:data.id,record:{documentId:data.record.documentId,kind:data.record.kind,fields:ordered(fields)},assets:(data.assets||[]).map(x=>x.path).sort()})).digest('hex');}
 const content=Object.fromEntries(['id','title','summary','markdown','date','category','author','sectionId'].filter(k=>data[k]!==undefined).map(k=>[k,data[k]]));
 content.assets=(data.assets||[]).map(x=>x.path).sort();return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

// A proof must always name a frozen version; only legacy unversioned records
// use the caller's existing hash function, preserving their original behavior.
export function sourceHasher(version,legacyHasher,{requiresVersion=false}={}){
 if(version===SOURCE_HASH_VERSION)return sourceHashV1;
 if((version===undefined||version===null)&&!requiresVersion&&typeof legacyHasher==='function')return legacyHasher;
 throw Error('Unsupported translation source hash version');
}
