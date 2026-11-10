import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import protocol from '../contracts/rssd-v1.cjs';
import {durableWriteJson} from './durable-json.mjs';
import {withFileLock} from './editorial-lock.mjs';

// A reviewed batch is finite. This helper neither selects a transport nor
// enables a scheduler. Adapters must use the selected site's existing writer.
export function reviewedPublicationIdentity({batchId,siteId,articleId,content}) {
  for(const value of [batchId,siteId,articleId])protocol.id(value);
  protocol.object(content,'reviewed content');
  const identity={batchId,siteId,articleId};
  return {...identity,key:protocol.hash(identity),requestKey:'reviewed-'+protocol.hash(identity).slice(0,48),contentHash:protocol.hash(content)};
}
const now=()=>new Date().toISOString();
const absent=error=>error?.status===404||error?.statusCode===404;
function checkReceipt(entry,receipt) {
  if(!receipt||receipt.requestKey!==entry.requestKey)throw Object.assign(Error('Publication receipt does not match the original request'),{code:'receipt_mismatch'});
  if(receipt.articleId&&receipt.articleId!==entry.articleId)throw Object.assign(Error('Publication receipt belongs to another article'),{code:'receipt_mismatch'});
}
export class ReviewedPublicationBatch {
  constructor({directory}) {if(!directory)throw Error('Batch directory is required');this.directory=directory;}
  path(spec) {return join(this.directory,reviewedPublicationIdentity(spec).key+'.json');}
  async prepare(spec) {
    const file=this.path(spec);
    return withFileLock(file+'.lock',async()=>this.open(spec,file));
  }
  async open(spec,file) {
    const identity=reviewedPublicationIdentity(spec);
    let entry;
    try{entry=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    if(entry){
      if(entry.version!==1||entry.key!==identity.key||entry.batchId!==identity.batchId||entry.siteId!==identity.siteId||entry.articleId!==identity.articleId||entry.requestKey!==identity.requestKey||entry.contentHash!==identity.contentHash||protocol.hash(entry.content)!==identity.contentHash)
        throw Object.assign(Error('Reviewed content or request identity changed; retain the original batch for reconciliation'),{code:'batch_conflict'});
      return entry;
    }
    entry={version:1,...identity,content:structuredClone(spec.content),state:'prepared',attempts:0,createdAt:now(),updatedAt:now()};
    await durableWriteJson(file,entry);return entry;
  }
  async deliver(spec,{lookup,submit,validateReceipt=()=>{}}) {
    const file=this.path(spec);
    return withFileLock(file+'.lock',async()=>{
      const entry=await this.open(spec,file);
      if(entry.state==='published')return entry;
      const save=async()=>{entry.updatedAt=now();await durableWriteJson(file,entry);return entry;};
      // Every attempt starts with an authoritative query. A failed query is
      // uncertainty, never permission to create a new request or POST blindly.
      let receipt,missing=false;
      try{
        receipt=await lookup(entry.requestKey,entry);missing=receipt===null;
        if(receipt===undefined)throw Error('Receipt lookup returned no authoritative result');
      }
      catch(error){
        if(!absent(error)){entry.state='unknown';entry.error={phase:'lookup',message:error.message};return save();}
        missing=true;
      }
      try{
        if(missing){
          // null or HTTP 404 is an explicit absence acknowledgement. Retrying
          // this exact key requires an idempotent adapter, as existing APIs are.
          entry.state='submit_intent';entry.attempts++;delete entry.error;await save();
          receipt=await submit(entry.requestKey,entry.content,entry);
        }
        checkReceipt(entry,receipt);await validateReceipt(receipt,entry);
        entry.receipt=receipt;entry.state=receipt.job?.status==='failed'?'needs_attention':'submitted';delete entry.error;
      }catch(error){
        entry.state=error.code==='receipt_mismatch'||[400,401,403,409,413,422].includes(error.status||error.statusCode)?'needs_attention':'unknown';
        entry.error={phase:'submit_or_receipt',message:error.message,code:error.code||null};
      }
      return save();
    });
  }
  async recordReadback(spec,{url,contentHash}) {
    const file=this.path(spec);
    return withFileLock(file+'.lock',async()=>{
      const entry=await this.open(spec,file);
      if(entry.state!=='submitted'&&entry.state!=='published')throw Error('An acknowledged original publication is required before public readback');
      if(entry.receipt?.job?.status!=='success'||contentHash!==entry.contentHash)throw Error('Public readback must match the successful original publication and frozen content');
      protocol.publicUrl(url);
      entry.publicReadback={url,contentHash,verifiedAt:now()};entry.state='published';entry.updatedAt=now();await durableWriteJson(file,entry);return entry;
    });
  }
  async list() {
    let files;try{files=await readdir(this.directory);}catch(error){if(error.code==='ENOENT')return [];throw error;}
    return Promise.all(files.filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).map(async f=>JSON.parse(await readFile(join(this.directory,f),'utf8'))));
  }
}
