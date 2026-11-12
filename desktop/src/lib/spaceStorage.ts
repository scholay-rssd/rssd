import { tr } from "../uiText";
import {SITE_RENAMES} from "../../../contracts/site-renames.mjs";
// Each space also owns restored tabs and UI preferences in the webview. Save
// the previous snapshot before changing keys; preserve the original academic
// snapshot on the first switch and never delete the snapshots themselves.
export function activateSpaceStorage(storage:Storage,id:string){
  const prefix='scholay.space-storage.',marker=prefix+'active';
  const previous=storage.getItem(marker)||'academic';if(previous===id){storage.setItem(marker,id);return;}
  const keys=Array.from({length:storage.length},(_,i)=>storage.key(i)!).filter(k=>!k.startsWith(prefix));
  const current=Object.fromEntries(keys.map(k=>[k,storage.getItem(k)!]));
  const saved=storage.getItem(prefix+id),next=saved?JSON.parse(saved):{};
  if(!next||Array.isArray(next)||typeof next!=='object'||Object.entries(next).some(([k,v])=>k.startsWith(prefix)||typeof v!=='string'))throw Error(tr('空间界面缓存无效，已保留原状态'));
  storage.setItem(prefix+previous,JSON.stringify(current));
  try{
    for(const key of keys)storage.removeItem(key);
    for(const [key,value] of Object.entries(next))storage.setItem(key,value as string);
    storage.setItem(marker,id);
  }catch(error){
    for(const key of Object.keys(next))storage.removeItem(key);
    for(const [key,value] of Object.entries(current))storage.setItem(key,value);
    storage.setItem(marker,previous);
    throw error;
  }
}

/** A site-logo click opens the destination reader after restoring its own tabs. */
export function consumeSpaceReaderEntry(storage:Storage,id:string){
 const key='scholay.space-storage.open-rss';
 if(storage.getItem(key)!==id)return false;
 storage.setItem('papr.workspace.v2','rss');storage.removeItem(key);return true;
}

/** Carry the UI snapshot of a renamed space over to its new ID, once. */
export function renameSpaceStorage(storage:Storage,renames:Record<string,string>=SITE_RENAMES){
  const prefix='scholay.space-storage.',marker=prefix+'active',open=prefix+'open-rss';
  for(const [from,to] of Object.entries(renames)){
    const saved=storage.getItem(prefix+from);
    if(saved!==null&&storage.getItem(prefix+to)===null)storage.setItem(prefix+to,saved);
    if(saved!==null)storage.removeItem(prefix+from);
    if(storage.getItem(marker)===from)storage.setItem(marker,to);
    if(storage.getItem(open)===from)storage.setItem(open,to);
  }
}
