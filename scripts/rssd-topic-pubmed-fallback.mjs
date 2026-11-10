// Narrow PubMed 203 fallback. Uses the caller's already hardened EFetch
// transport. It supplies primary-record evidence, never a semantic verdict.
const normalize=value=>String(value||'').normalize('NFKC').replace(/\s+/gu,' ').trim();
function clean(raw){
 const text=raw.replace(/<[^>]*>/g,' ').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,entity)=>{
  if(entity[0]==='#'){
   const n=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):parseInt(entity.slice(1),10);
   if(!Number.isInteger(n)||n<1||n>0x10ffff||n>=0xd800&&n<=0xdfff)throw Error('Invalid PubMed character reference');
   return String.fromCodePoint(n);
  }
  return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[entity.toLowerCase()];
 });
 if(/&(?:#[a-z0-9]+|[a-z][a-z0-9]+);/i.test(text))throw Error('Unsupported PubMed entity');
 return normalize(text);
}
export async function fetchPubmedFallback(url,{httpStatus,expectedTitle,fetchSource}={}){
 if(httpStatus!==203)throw Error('PubMed fallback only applies to HTTP 203');
 if(typeof url!=='string'||!/^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/[1-9]\d{0,11}\/$/.test(url))throw Error('PubMed URL must be the exact canonical PMID link');
 const pmid=url.match(/\/(\d+)\/$/)[1];
 if(typeof expectedTitle!=='string'||!normalize(expectedTitle)||typeof fetchSource!=='function')throw Error('Original verified seed title and source transport required');
 const api=new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi');
 api.search=new URLSearchParams({db:'pubmed',id:pmid,retmode:'xml',tool:'rssd-topic-reader'});
 const response=await fetchSource(api.href,{timeoutMs:30000,maxBytes:1024*1024});
 if(!response?.reachable||response.finalUrl!==api.href||typeof response.text!=='string')throw Error('PubMed EFetch unavailable or redirected');
 const xml=response.text;
 if(!/<PubmedArticleSet\b/.test(xml)||/<(?:ERROR|PubmedBookArticle)\b/i.test(xml))throw Error('Invalid PubMed EFetch record');
 const records=[...xml.matchAll(/<PubmedArticle\b[^>]*>([\s\S]*?)<\/PubmedArticle>/g)];
 if(records.length!==1)throw Error('PubMed EFetch must return exactly one article');
 const record=records[0][1];
 const citation=record.match(/<MedlineCitation\b([^>]*)>([\s\S]*?)<\/MedlineCitation>/i);
 if(!citation||/\bStatus\s*=\s*["'](?:Deleted|Retracted)["']/i.test(citation[1]))throw Error('PubMed citation missing or invalid');
 const returned=citation[2].match(/<PMID\b[^>]*>\s*(\d+)\s*<\/PMID>/i)?.[1];
 if(returned!==pmid)throw Error('PubMed PMID does not match source');
 if(/<PublicationType\b[^>]*>[^<]*(?:retract|expression of concern|published erratum)[^<]*<\/PublicationType>/i.test(record)||/<CommentsCorrections\b[^>]*\bRefType\s*=\s*["'](?:RetractionIn|ExpressionOfConcernIn)["']/i.test(record))throw Error('PubMed record has a retraction or concern marker');
 const rawTitle=record.match(/<ArticleTitle\b[^>]*>([\s\S]*?)<\/ArticleTitle>/i)?.[1];
 const parts=[...record.matchAll(/<AbstractText\b[^>]*>([\s\S]*?)<\/AbstractText>/gi)].map(m=>m[1]);
 const title=clean(rawTitle||''),abstract=clean(parts.join(' '));
 if(!title||title.length>1000||title!==normalize(expectedTitle))throw Error('PubMed title does not match original source seed');
 if(abstract.length<1200)throw Error('PubMed abstract is not sufficiently complete');
 return {url,pmid,title,abstract:abstract.slice(0,4000),transport:'pubmed-efetch-203',recordUrl:api.href};
}
