import protocol from '../contracts/rssd-v1.cjs';
import {publicUrl} from '../desktop/scripts/agent/notebook-model.mjs';

const MEDIA_PATH=/^\/api\/rssd\/v1\/media\/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})\/raw$/;

export function trustedCenterOrigin(origin){
  const url=new URL(origin);
  if(url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))throw Object.assign(Error('Center URL must be an origin without credentials or a path'),{code:'media_ref_invalid',status:400});
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw Object.assign(Error('Center connections require HTTPS'),{code:'media_ref_invalid',status:400});
  return url.origin;
}

export function parseCenterMediaRef(value,{origin}={}){
  if(typeof value!=='string'||!value||value.length>4096||/[\s\\\0]/.test(value))return null;
  if(value.startsWith('//')||value.includes('\\')||value.includes('..'))return null;
  let trusted;
  try{trusted=trustedCenterOrigin(origin);}catch{return null;}
  if(value.startsWith('/')){
    if(value.includes('?')||value.includes('#')||value.includes('//'))return null;
    const match=value.match(MEDIA_PATH);
    if(!match)return null;
    try{protocol.id(match[1],'mediaId');}catch{return null;}
    return {id:match[1],origin:trusted,relative:'/api/rssd/v1/media/'+match[1]+'/raw',absolute:trusted+'/api/rssd/v1/media/'+match[1]+'/raw'};
  }
  let url;
  try{url=new URL(value);}catch{return null;}
  if(url.origin!==trusted||url.username||url.password||url.search||url.hash)return null;
  if(url.pathname.includes('//')||url.pathname.includes('..'))return null;
  if(value!==url.origin+url.pathname&&value!==url.href)return null;
  const match=url.pathname.match(MEDIA_PATH);
  if(!match)return null;
  try{protocol.id(match[1],'mediaId');}catch{return null;}
  return {id:match[1],origin:trusted,relative:'/api/rssd/v1/media/'+match[1]+'/raw',absolute:trusted+'/api/rssd/v1/media/'+match[1]+'/raw'};
}

export function looksLikeCenterMediaPath(value){
  return typeof value==='string'&&(/\/api\/rssd\/v1\/media\//.test(value)||/^https?:\/\/[^/]+\/api\/rssd\/v1\/media\//.test(value));
}

export function registeredSourceMediaIds(source){
  const payload=source?.payload||source;
  const ids=new Set();
  for(const item of payload?.media||[])if(item?.id){try{ids.add(protocol.id(item.id,'mediaId'));}catch{}}
  for(const id of protocol.referencedMediaIds(payload?.bodyMarkdown||''))ids.add(id);
  for(const block of payload?.metadata?.notebook?.blocks||[]){
    if(block?.type!=='image'||typeof block.text!=='string')continue;
    const match=block.text.match(/\/api\/rssd\/v1\/media\/([A-Za-z0-9._:-]+)\/raw/);
    if(match)try{ids.add(protocol.id(match[1],'mediaId'));}catch{}
  }
  return ids;
}

export function centerImageReference({origin,source}={}){
  const registered=source?registeredSourceMediaIds(source):null;
  return value=>{
    const parsed=parseCenterMediaRef(value,{origin});
    if(parsed){
      if(registered&&!registered.has(parsed.id))return false;
      return true;
    }
    if(looksLikeCenterMediaPath(value))return false;
    if(registered&&registered.size)return false;
    return publicUrl(value);
  };
}

export function normalizeCenterImageText(value,origin){
  const parsed=parseCenterMediaRef(value,{origin});
  return parsed?parsed.absolute:value;
}
