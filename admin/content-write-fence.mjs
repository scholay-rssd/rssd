import {open} from 'node:fs/promises';
import {isAbsolute,resolve} from 'node:path';

const namespaces=['/manage/api/documents','/manage/api/news','/manage/api/jobs','/manage/api/import','/manage/api/worker'];
export function contentMutation(method,path){
  if(['GET','HEAD','OPTIONS'].includes(method.toUpperCase()))return false;
  return namespaces.some(prefix=>path===prefix||path.startsWith(prefix+'/'));
}

// One private marker per content database. Operators can freeze the old writer
// without stopping its login, guestbook, labels or forum webhook services.
export function createContentWriteFence({dbPath,siteId,path=process.env.SCHOLAY_CONTENT_FENCE_FILE||resolve(dbPath)+'.rssd-readonly'}){
  if(typeof path!=='string'||!isAbsolute(path))throw Error('SCHOLAY_CONTENT_FENCE_FILE must be an absolute path');
  const state=(name,readOnly)=>({siteId,readOnly,state:name});
  return {
    path,
    async status(){
      let file;
      try{
        file=await open(path,'r');
        const info=await file.stat();if(!info.isFile()||info.size>4096)return state('invalid_marker',true);
        const bytes=Buffer.alloc(4097),{bytesRead}=await file.read(bytes,0,bytes.length,0);
        if(bytesRead>4096)return state('invalid_marker',true);
        let marker;try{marker=JSON.parse(bytes.subarray(0,bytesRead).toString('utf8'));}catch{return state('invalid_marker',true);}
        return marker?.version===1&&marker.siteId===siteId&&marker.readOnly===true?state('read_only',true):state('invalid_marker',true);
      }catch(error){return error.code==='ENOENT'?state('writable',false):state('unavailable',true);}
      finally{if(file)await file.close().catch(()=>{});}
    },
    async requireWritable(){
      if((await this.status()).readOnly)throw Object.assign(Error('旧内容写入已暂停，请保留原请求并通过 RSSD 中心提交。'),{statusCode:409,code:'legacy_content_read_only'});
    }
  };
}
