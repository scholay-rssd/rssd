// Host-owned, opt-in source scope. Missing rules never grant broad web access.
import protocol from '../contracts/rssd-v1.cjs';
import {createJatsSourceVerifier} from './rssd-source-jats-verifier.mjs';
import {createSourceStage} from './rssd-source-stage.mjs';
import {createPmcDynamicStage} from './rssd-pmc-dynamic-stage.mjs';
import {fetchPublicText,fetchAuthoritativeSource,authoritativeHosts,publicHttpsUrl} from './rssd-topic-public.mjs';
import {setTimeout as delay} from 'node:timers/promises';

const scopeKey=s=>[s.siteId,s.workspaceId,s.sectionId].join('\u0000');

export function validateSourceRuntimeConfiguration(config){
 if(config===undefined||config?.enabled===false){if(config!==undefined&&(!config||Object.keys(config).some(k=>!['enabled'].includes(k))))throw Error('Invalid disabled source configuration');return;}
 if(!config||config.enabled!==true||Object.keys(config).some(k=>!['enabled','rules','pmc'].includes(k)))throw Error('Explicit trusted source rules are required');
 const rules=config.rules??[],pmc=config.pmc;if(!Array.isArray(rules)||rules.length>100||pmc!==undefined&&(!pmc||typeof pmc.enabled!=='boolean'||Object.keys(pmc).some(k=>!['enabled','scopes'].includes(k))))throw Error('Invalid source configuration');
 if(pmc?.enabled===false&&Object.hasOwn(pmc,'scopes'))throw Error('Disabled PMC cannot grant source scope');
 const scopes=pmc?.enabled===true?pmc.scopes:[];if(!Array.isArray(scopes)||scopes.length>100||pmc?.enabled===true&&!scopes.length||!rules.length&&!scopes.length)throw Error('Explicit trusted source rules are required');
 const statics=new Set();for(const r of rules){if(!r||typeof r!=='object')throw Error('Invalid scoped source rule');protocol.id(r.siteId,'siteId');protocol.id(r.workspaceId,'workspaceId');protocol.id(r.sectionId,'sectionId');if(publicHttpsUrl(r.url).href!==r.url)throw Error('Source URL must be canonical');statics.add(scopeKey(r));}
 const seen=new Set();for(const s of scopes){if(!s||Object.keys(s).some(k=>!['siteId','workspaceId','sectionId'].includes(k)))throw Error('Invalid PMC source scope');protocol.id(s.siteId,'siteId');protocol.id(s.workspaceId,'workspaceId');protocol.id(s.sectionId,'sectionId');const key=scopeKey(s);if(seen.has(key)||statics.has(key))throw Error('PMC and other source scopes cannot overlap');seen.add(key);}
}

/** The host configures exact site/section/URL tuples before topic selection. */
export async function configuredSourceRuntime(config,{home,connection,client,fetchPage}={}){
 validateSourceRuntimeConfiguration(config);if(!config||config.enabled!==true)return null;
 const scopedRules=structuredClone(config.rules||[]),pmcScopes=structuredClone(config.pmc?.enabled?config.pmc.scopes:[]),byUrl=new Map();for(const {siteId,workspaceId,sectionId,...rule} of scopedRules){const prior=byUrl.get(rule.url);if(prior&&protocol.canonical(prior)!==protocol.canonical(rule))throw Error('A source URL has conflicting verification rules');byUrl.set(rule.url,rule);}const rules=[...byUrl.values()];
 // The synthetic-address exception is limited to the preexisting exact NCBI
 // authority list; arbitrary URLs retain the public-address-only fetcher.
 const rawFetch=fetchPage||((url,options)=>authoritativeHosts.includes(new URL(url).hostname)?fetchAuthoritativeSource(url,options):fetchPublicText(url,options));
 let last=0,queue=Promise.resolve();const retrieve=(url,options={})=>{if(new URL(url).hostname!=='eutils.ncbi.nlm.nih.gov')return rawFetch(url,options);const result=queue.then(async()=>{const wait=400-(Date.now()-last);if(wait>0)await delay(wait,undefined,{signal:options.signal});last=Date.now();return rawFetch(url,options);});queue=result.catch(()=>{});return result;};
 let staticStage;if(rules.length){const verifier=await createJatsSourceVerifier({rules}),trustedVerifierPin={id:verifier.id,version:verifier.version,codeSha256:verifier.codeSha256};const authorizeCandidate=async({url,slot})=>scopedRules.some(r=>r.url===url&&scopeKey(r)===scopeKey(slot||{}));staticStage=createSourceStage({enabled:true,home,connection,client,verifier,trustedVerifierPin,fetchPage:retrieve,authorizeCandidate});}
 const pmcStage=pmcScopes.length?await createPmcDynamicStage({home,connection,client,fetchPage:retrieve,authorizeCandidate:async({slot})=>pmcScopes.some(s=>scopeKey(s)===scopeKey(slot||{}))}):null;
 const select=slot=>pmcScopes.some(s=>scopeKey(s)===scopeKey(slot||{}))?pmcStage:scopedRules.some(s=>scopeKey(s)===scopeKey(slot||{}))?staticStage:null;
 const sourceStage={};for(const name of ['acceptCandidate','readForTopic','freeze','verifyDemand','restore','verifyEdition'])sourceStage[name]=async args=>{const stage=select(args?.slot);if(!stage){if(name==='acceptCandidate')return false;throw Object.assign(Error('Trusted source scope is not configured'),{code:'source_pending'});}return stage[name](args);};
 return {sourceStage,fetchPage:retrieve};
}
