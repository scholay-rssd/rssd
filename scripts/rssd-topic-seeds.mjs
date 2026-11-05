// Public, read-only and bounded source discovery for the methods pilot.
// The abstracts are leads for editorial selection, not permission to publish
// any claim without a separate source assessment.
import {fetchAuthoritativeSource} from './rssd-topic-public.mjs';

const base='https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';
const query='("missing data"[Title/Abstract] OR "causal inference"[Title/Abstract] OR "selection bias"[Title/Abstract] OR "measurement error"[Title/Abstract] OR "study design"[Title/Abstract]) AND (methods[Title] OR methodological[Title] OR methodology[Title]) AND english[Language] AND hasabstract[text] NOT ("Retracted Publication"[Publication Type] OR "Retraction of Publication"[Publication Type])';
const key=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]+/gu,'');
function clean(raw){
 const text=raw.replace(/<[^>]*>/g,' ').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,entity)=>{
  if(entity[0]==='#'){const n=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):parseInt(entity.slice(1),10);if(!Number.isInteger(n)||n<1||n>0x10ffff||n>=0xd800&&n<=0xdfff)throw Error('Invalid PubMed character reference');return String.fromCodePoint(n);}
  return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[entity.toLowerCase()];
 });
 if(/&(?:#[a-z0-9]+|[a-z][a-z0-9]+);/i.test(text))throw Error('Unsupported PubMed entity');
 return text.replace(/\s+/g,' ').trim();
}
function searchIds(text){
 let body;try{body=JSON.parse(text);}catch{throw Error('Invalid PubMed search response');}
 const result=body?.esearchresult,ids=result?.idlist;
 if(!Array.isArray(ids)||!ids.length||ids.length>50||ids.some(id=>typeof id!=='string'||!/^[1-9]\d{0,11}$/.test(id))||new Set(ids).size!==ids.length||!/^\d+$/.test(result.count||'')||Number(result.count)<ids.length||body.error||result.errorlist)throw Error('Incomplete PubMed search response');
 return ids;
}
function articles(xml,ids){
 if(!/<PubmedArticleSet\b/.test(xml)||/<ERROR\b/i.test(xml))throw Error('Invalid PubMed article response');
 const found=new Map();
 for(const match of xml.matchAll(/<PubmedArticle\b[^>]*>([\s\S]*?)<\/PubmedArticle>/g)){
  const record=match[1],pmid=record.match(/<PMID\b[^>]*>(\d+)<\/PMID>/)?.[1];
  if(!pmid||!ids.includes(pmid)||found.has(pmid))throw Error('PubMed article identity mismatch');
  const rawTitle=record.match(/<ArticleTitle\b[^>]*>([\s\S]*?)<\/ArticleTitle>/)?.[1];
  const snippets=[...record.matchAll(/<AbstractText\b[^>]*>([\s\S]*?)<\/AbstractText>/g)].map(m=>m[1]);
  try{
   const title=clean(rawTitle||''),excerpt=clean(snippets.join(' '));
   found.set(pmid,title&&title.length<=1000&&excerpt.length>=1200?{title,url:'https://pubmed.ncbi.nlm.nih.gov/'+pmid+'/',excerpt:excerpt.slice(0,4000)}:null);
  }catch{found.set(pmid,null);}
 }
 if(found.size!==ids.length)throw Error('PubMed article response is incomplete');
 return ids.map(id=>found.get(id)).filter(Boolean);
}
/** Newest public method papers with substantive abstracts. Never writes Center. */
export async function fetchMethoSourceSeeds({existingTitles=[],count=1,fetchSource=fetchAuthoritativeSource}={}){
 if(!Array.isArray(existingTitles)||existingTitles.some(t=>typeof t!=='string')||!Number.isSafeInteger(count)||count<1||count>5)throw Error('Invalid research topic request');
 const search=new URL(base+'esearch.fcgi');search.search=new URLSearchParams({db:'pubmed',term:query,retmode:'json',retmax:'40',sort:'pub_date',tool:'rssd-topic-reader'});
 const response=await fetchSource(search.href,{timeoutMs:30000});if(!response?.reachable||response.finalUrl!==search.href||typeof response.text!=='string')throw Error('PubMed search unavailable');
 const ids=searchIds(response.text),fetch=new URL(base+'efetch.fcgi');fetch.search=new URLSearchParams({db:'pubmed',id:ids.join(','),retmode:'xml',tool:'rssd-topic-reader'});
 const detail=await fetchSource(fetch.href,{timeoutMs:30000,maxBytes:2*1024*1024});if(!detail?.reachable||detail.finalUrl!==fetch.href||typeof detail.text!=='string')throw Error('PubMed articles unavailable');
 const existing=new Set(existingTitles.map(key)),seen=new Set(),candidates=[];
 for(const item of articles(detail.text,ids)){const k=key(item.title);if(!k||existing.has(k)||seen.has(k))continue;seen.add(k);candidates.push(item);if(candidates.length>=Math.min(12,Math.max(10,count*5)))break;}
 if(candidates.length<count)throw Error('Not enough sourced method candidates');
 return candidates;
}
