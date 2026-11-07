import {CenterError} from './rssd-center-client.mjs';
import protocol from '../contracts/rssd-v1.cjs';

export const STORE_ONLY_CONTRACT={
  centerHead:'f38d8e6b98393265ee9306902ec4c91404c363a8',
  centerBase:'3dd7fb25fd1ede90788c349fc9ee8c94544a26af',
  supersededHead:'1db773afdfc466448bdb4ed66cf4983a20fbfa86',
  versionKey:'storeOnlyTranslate',
  requiredVersion:1,
  guarantees:Object.freeze(['storeOnlyFrozen','zeroPublications','exclusiveWorkerClaim','intentRequired','noClaimSteal','leaseRecovery','englishOnly','sourceBind','receipt','receiptIsolation','openWorkFence']),
};
function fail(message,code='invalid_request',status=400){throw new CenterError(message,{status,code});}
export function storeOnlyTranslateContract(){
  return {version:STORE_ONLY_CONTRACT.requiredVersion,guarantees:[...STORE_ONLY_CONTRACT.guarantees]};
}
export function supportsStoreOnlyTranslate(overview){
  const row=overview?.contracts?.storeOnlyTranslate;
  if(!row||typeof row!=='object'||Array.isArray(row)||!Number.isInteger(row.version)||row.version<STORE_ONLY_CONTRACT.requiredVersion||!Array.isArray(row.guarantees))return false;
  return STORE_ONLY_CONTRACT.guarantees.every(token=>row.guarantees.includes(token));
}
async function readOverview(client){
  try{
    if(typeof client.overview==='function')return await client.overview();
    if(typeof client.request!=='function')fail('Center client cannot probe the storeOnlyTranslate contract version','contract_unavailable',409);
    return await client.request('/coordination/overview');
  }catch(error){
    if(error instanceof CenterError)fail('Center overview is unavailable; storeOnlyTranslate contract version cannot be verified','contract_unavailable',409);
    throw error;
  }
}
export async function requireStoreOnlyContract(client){
  const overview=await readOverview(client);
  if(!supportsStoreOnlyTranslate(overview))fail('Center did not advertise a supported storeOnlyTranslate contract; store-only English refused','contract_unavailable',409);
  return overview;
}
export function assertStoreOnlyReceipt(receipt,packet,{workerId}={}){
  if(!receipt||receipt.status!=='accepted'||receipt.storeOnly!==true)fail('Center receipt is not store-only; not treated as success','not_store_only',409);
  if(receipt.demandState!=='completed')fail('Store-only receipt is not a completed demand; not treated as success','not_store_only',409);
  if(!Array.isArray(receipt.publicationIds)||receipt.publicationIds.length)fail('Store-only receipt included publications; not treated as success','not_store_only',409);
  if(typeof receipt.storeOnlyWorkerId!=='string'||!receipt.storeOnlyWorkerId)fail('Store-only receipt omitted creating-device bind; not treated as success','not_store_only',409);
  if(workerId!=null&&receipt.storeOnlyWorkerId!==workerId)fail('Store-only receipt is bound to a different device; not treated as success','not_store_only',409);
  if(!Array.isArray(receipt.editions)||receipt.editions.length!==1||receipt.editions[0].locale!=='en')fail('Store-only receipt must bind exactly one English edition','not_store_only',409);
  if(packet){
    if(receipt.requestId!==packet.requestId||receipt.workId!==packet.workId||receipt.workspaceId!==packet.workspaceId)fail('Store-only receipt does not match the original request','receipt_mismatch',409);
    if(!Array.isArray(packet.editions)||packet.editions.length!==1||packet.editions[0].locale!=='en')fail('Store-only packet must submit only English','not_store_only',409);
    const received=receipt.editions[0];
    if(received.hash!==protocol.hash(packet.editions[0])||received.revision!==(packet.baseRevisions?.en||0)+1)fail('Store-only receipt does not match the English edition','receipt_mismatch',409);
  }
  return receipt;
}
