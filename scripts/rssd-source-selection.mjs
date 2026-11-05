// Local hand-off between a verified topic selection and one authenticated
// Center claim. No source text, claim token, credentials or long excerpts are
// stored in this selection or sent to Center by this module.
import {lstat,mkdir,readFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import protocol from '../contracts/rssd-v1.cjs';
import {centerOrigin,writeCenterJson} from './rssd-center-client.mjs';
import {withFileLock} from './editorial-lock.mjs';
import {normalizeVerifiedSources} from './rssd-source-snapshot.mjs';

const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const stop=message=>Object.assign(Error(message),{code:'source_selection_unavailable'});
function connectionOf(value){return {origin:centerOrigin(value?.origin),orgId:protocol.id(value?.orgId,'orgId'),workerId:protocol.id(value?.workerId,'workerId')};}
function demandOf(value){const demand=protocol.demand(value);if(demand.kind!=='write'||demand.source!==null||demand.brief.length>4000)throw stop('A concise original write demand is required');return demand;}
async function privateDirectory(home){
 const base=await realpath(home),dir=join(base,'source-selections');await mkdir(dir,{recursive:true,mode:0o700});const info=await lstat(dir);
 if(!info.isDirectory()||info.isSymbolicLink()||await realpath(dir)!==dir||(info.mode&0o077)!==0||typeof process.getuid==='function'&&info.uid!==process.getuid())throw stop('Source selection directory is not private');return dir;
}
async function readRecord(file){try{const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077)!==0||typeof process.getuid==='function'&&info.uid!==process.getuid())throw Error('unsafe');return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw stop('Original source selection cannot be read safely');}}
function checkRecord(record){
 const s=record?.selection;if(record?.version!==1||!s||!hex(record.selectionHash)||protocol.hash(s)!==record.selectionHash)throw stop('Original source selection integrity check failed');
 const proof=s.verification;if(!proof||proof.valid!==true||proof.demandHash!==s.demandHash||proof.sourceSetHash!==protocol.hash(normalizeVerifiedSources(s.verifiedSources))||!hex(proof.evidenceHash)||typeof proof.method!=='string'||!proof.method.trim()||proof.method.length>200||typeof proof.verifiedAt!=='string'||!Number.isFinite(Date.parse(proof.verifiedAt)))throw stop('Source selection verification is missing');
 if(record.binding){const {bindingHash,...binding}=record.binding;if(!hex(bindingHash)||protocol.hash(binding)!==bindingHash||binding.selectionHash!==record.selectionHash)throw stop('Original source claim binding changed');}
 return record;
}
/**
 * Called only by the trusted verifier after sources are independently selected.
 * The original demand and source list must be frozen locally before its POST;
 * the demand itself is never sent or mutated by this function.
 */
export async function freezeSourceSelection({home,connection,demand,verifiedSources,verifySelection,clock=()=>new Date()}={}){
 if(typeof home!=='string'||!home||typeof clock!=='function'||typeof verifySelection!=='function')throw stop('Private Center home and independent source verification are required');
 const identity=connectionOf(connection),d=demandOf(demand),sources=normalizeVerifiedSources(verifiedSources),dir=await privateDirectory(home),file=join(dir,protocol.hash(d.id)+'.json');
 return withFileLock(file+'.lock',async()=>{
  const old=await readRecord(file),candidate={...identity,demandId:d.id,workspaceId:d.workspaceId,sectionId:d.sectionId,demandHash:protocol.hash(d),verifiedSources:sources};
  if(old){checkRecord(old);const {createdAt,verification,...saved}=old.selection;if(protocol.canonical(saved)!==protocol.canonical(candidate))throw stop('An original source selection already exists with different content');let restored;try{restored=await verifySelection({demandId:d.id,workspaceId:d.workspaceId,sectionId:d.sectionId,demandHash:candidate.demandHash,verifiedSources:structuredClone(sources),sourceSetHash:protocol.hash(sources)});}catch{throw stop('Original source verification receipt is unavailable');}if(protocol.canonical(restored)!==protocol.canonical(verification))throw stop('Original source verification receipt changed');return old;}
  const sourceSetHash=protocol.hash(sources);let verification;
  try{verification=await verifySelection({demandId:d.id,workspaceId:d.workspaceId,sectionId:d.sectionId,demandHash:candidate.demandHash,verifiedSources:structuredClone(sources),sourceSetHash});}catch{throw stop('Independent source verification is unavailable');}
  if(!verification||verification.valid!==true||verification.demandHash!==candidate.demandHash||verification.sourceSetHash!==sourceSetHash||!hex(verification.evidenceHash)||typeof verification.method!=='string'||!verification.method.trim()||verification.method.length>200||typeof verification.verifiedAt!=='string'||!Number.isFinite(Date.parse(verification.verifiedAt)))throw stop('Independent source verification is incomplete');
  const now=clock();if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw stop('Invalid selection time');
  const proof={valid:true,demandHash:verification.demandHash,sourceSetHash:verification.sourceSetHash,evidenceHash:verification.evidenceHash,method:verification.method.trim(),verifiedAt:verification.verifiedAt};
  const selection={...candidate,verification:proof,createdAt:now.toISOString()},record={version:1,selection,selectionHash:protocol.hash(selection),binding:null};await writeCenterJson(file,record);return record;
 },{timeout:100});
}
/**
 * Reads a fresh authenticated device identity and active claim from Center.
 * Binding persists only task identity/generation, never the claim token.
 * The caller must recheck Center status before any later submission.
 */
export async function bindSourceSelectionToClaim({home,connection,claim,client,verifySelection,clock=()=>new Date()}={}){
 if(typeof home!=='string'||!home||typeof client?.identity!=='function'||typeof client?.activeClaim!=='function'||typeof verifySelection!=='function'||typeof clock!=='function')throw stop('Authenticated Center readback and stored verification are required');
 const identity=connectionOf(connection);if(centerOrigin(client.origin)!==identity.origin)throw stop('Center origin changed');
 const claimId=protocol.id(claim?.id,'claimId'),token=protocol.id(claim?.claimToken,'claimToken'),generation=claim?.generation;
 if(!Number.isSafeInteger(generation)||generation<1)throw stop('Original claim generation is invalid');
 const dir=await privateDirectory(home),file=join(dir,protocol.hash(claimId)+'.json');
 return withFileLock(file+'.lock',async()=>{
  const record=await readRecord(file);if(!record)throw stop('The original source selection is missing');checkRecord(record);const s=record.selection;
  if(s.origin!==identity.origin||s.orgId!==identity.orgId||s.workerId!==identity.workerId||s.demandId!==claimId||s.workspaceId!==claim.workspaceId||s.sectionId!==claim.sectionId||!hex(s.demandHash))throw stop('Claim does not match the original source selection');
  let proof;try{proof=await verifySelection({demandId:s.demandId,workspaceId:s.workspaceId,sectionId:s.sectionId,demandHash:s.demandHash,verifiedSources:structuredClone(s.verifiedSources),sourceSetHash:protocol.hash(s.verifiedSources)});}catch{throw stop('Original source verification receipt is unavailable');}
  if(protocol.canonical(proof)!==protocol.canonical(s.verification))throw stop('Original source verification receipt changed');
  const remoteIdentity=await client.identity();if(remoteIdentity?.protocolVersion!==1||remoteIdentity.orgId!==identity.orgId||remoteIdentity.workerId!==identity.workerId||!Array.isArray(remoteIdentity.workspaceIds)||!remoteIdentity.workspaceIds.includes(s.workspaceId))throw stop('Center device identity changed');
  const active=await client.activeClaim();
  if(!active||!['claimed','blocked'].includes(active.state)||active.id!==claimId||active.orgId!==identity.orgId||active.workerId!==identity.workerId||active.claimToken!==token||active.generation!==generation||active.workspaceId!==s.workspaceId||active.sectionId!==s.sectionId||protocol.hash(demandOf(active.payload))!==s.demandHash)throw stop('The original active Center claim does not match');
  let binding=record.binding;
  if(binding){if(binding.generation!==generation||binding.workerId!==identity.workerId||binding.claimId!==claimId)throw stop('Source selection was already bound to another claim generation');}
  else{const now=clock();if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw stop('Invalid claim binding time');const value={selectionHash:record.selectionHash,claimId,generation,workerId:identity.workerId,boundAt:now.toISOString()};binding={...value,bindingHash:protocol.hash(value)};await writeCenterJson(file,{...record,binding});}
  return {binding:{claimId,generation,workspaceId:s.workspaceId,sectionId:s.sectionId,demandHash:s.demandHash},verifiedSources:structuredClone(s.verifiedSources),selectionHash:record.selectionHash,bindingHash:binding.bindingHash};
 },{timeout:100});
}
