import {createHash} from 'node:crypto';
// Frozen copy of the source-view fingerprint contract. Never alter v1 in place.
export const SOURCE_HASH_VERSION='rssd-source-view-sha256-v1';
export function sourceHashV1(data){
 const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,ordered(value[k])])):value;
 if(data.record){const {assets,...fields}=data.record.fields||{};return createHash('sha256').update(JSON.stringify({id:data.id,record:{documentId:data.record.documentId,kind:data.record.kind,fields:ordered(fields)},assets:(data.assets||[]).map(x=>x.path).sort()})).digest('hex');}
 const content=Object.fromEntries(['id','title','summary','markdown','date','category','author','sectionId'].filter(k=>data[k]!==undefined).map(k=>[k,data[k]]));
 content.assets=(data.assets||[]).map(x=>x.path).sort();return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

// v2 adds the ordered public source links omitted by v1. This projection is
// independent of renderer-populated asset data and must remain frozen.
export const SOURCE_HASH_VERSION_V2='rssd-source-view-sha256-v2';
export function sourceHashV2(data){
 const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,ordered(value[k])])):value;
 const assets=(data.assets||[]).map(x=>x.path).sort();
 let projection;
 if(data.record){const {assets:ignored,...fields}=data.record.fields||{};projection={version:2,id:data.id,record:{documentId:data.record.documentId,kind:data.record.kind,fields:ordered(fields)},assets};}
 else {const content=Object.fromEntries(['id','title','summary','markdown','date','category','author','sectionId'].filter(k=>data[k]!==undefined).map(k=>[k,data[k]]));projection={version:2,...content,assets,sources:(data.sources||[]).map(({label,url})=>({label,url}))};}
 return createHash('sha256').update(JSON.stringify(projection)).digest('hex');
}

// A proof must always name a frozen version; only legacy unversioned records
// use the caller's existing hash function, preserving their original behavior.
export function sourceHasher(version,legacyHasher,{requiresVersion=false}={}){
 if(version===SOURCE_HASH_VERSION)return sourceHashV1;
 if(version===SOURCE_HASH_VERSION_V2)return sourceHashV2;
 if((version===undefined||version===null)&&!requiresVersion&&typeof legacyHasher==='function')return legacyHasher;
 throw Error('Unsupported translation source hash version');
}
