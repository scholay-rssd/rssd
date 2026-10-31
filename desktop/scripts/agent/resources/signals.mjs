import {resolveLabelCloudCredential} from '../../runtime/labels-cloud-credential.mjs';
import {readCloudLabels} from '../../runtime/labels-cloud-read.mjs';

function projectRows(feed){
 const latest=Array.isArray(feed?.latest)?feed.latest:[];
 return latest.slice(0,80).map(item=>({
  id:item.id||item.endpointId+':'+(item.observedAt||''),
  platformId:item.platformId,
  provider:item.provider||'tikhub',
  endpointId:item.endpointId,
  observedAt:item.observedAt,
  period:item.period||null,
  term:item.term||item.rows?.[0]?.term||item.title||'未命名热词',
  rows:Array.isArray(item.rows)?item.rows.slice(0,20).map(row=>({id:row.id,term:row.term,kind:row.kind,rank:row.rank,url:row.url||null})):[]
 }));
}

export async function loadSignals({snapshot,fetcher=fetch}={}){
 if(snapshot)return {configured:true,source:'snapshot',observedAt:snapshot.observedAt||new Date().toISOString(),items:projectRows(snapshot),raw:snapshot};
 const token=await resolveLabelCloudCredential();
 if(!token)return {configured:false,source:'none',reason:'当前空间未配置云端标签读取凭证',items:[]};
 try{
  const feed=await readCloudLabels(token,fetcher);
  return {configured:true,source:'cloud',observedAt:new Date().toISOString(),items:projectRows(feed),raw:{schemaVersion:feed.schemaVersion,source:feed.source,platforms:feed.platforms,latest:feed.latest}};
 }catch(error){
  return {configured:false,source:'error',reason:error.message,items:[]};
 }
}

export function resolveSignalsMount(loaded,input={}){
 if(!loaded.configured)return {kind:'signals',title:'热榜与标签',locator:{provider:'tikhub'},version:{contentHash:'unconfigured',label:'unconfigured',snapshot:{configured:false,reason:loaded.reason}},state:'unavailable',error:loaded.reason||'未配置',role:'lead',scope:{lead:true}};
 const query=String(input.query||'').trim().toLowerCase();
 const items=loaded.items.filter(item=>!query||item.term.toLowerCase().includes(query)||item.platformId===input.platformId);
 return {
  kind:'signals',
  title:query?`热榜：${query}`:'热榜与标签',
  locator:{provider:'tikhub',query:query||null,platformId:input.platformId||null},
  version:{contentHash:String(loaded.observedAt||'signals'),label:loaded.source,snapshot:{configured:true,source:loaded.source,observedAt:loaded.observedAt,items,note:'选题线索，不是新闻全文'}},
  state:'ready',
  role:'lead',
  scope:{lead:true,query:query||null},
 };
}
