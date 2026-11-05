// Fixed NCBI identity reader. An RSS link is a discovery locator; the verifier
// actually reads the canonical E-utilities JATS URL and records that URL.
// This establishes neither article coverage nor permission to republish.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {fetchAuthoritativeSource} from './rssd-topic-public.mjs';
import {parsePmcSourceId,parsePmcMetadata} from './rssd-pmc-resolver.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
const self=fileURLToPath(import.meta.url),parser=fileURLToPath(new URL('./rssd-pmc-resolver.py',import.meta.url)),resolver=fileURLToPath(new URL('./rssd-pmc-resolver.mjs',import.meta.url));
const fail=message=>Object.assign(Error(message),{code:'source_pending'});
const single=(x,re)=>Array.isArray(x)&&x.length===1&&typeof x[0]==='string'&&re.test(x[0]);

/** No model supplied IDs or URL selection callback. The only remote request
 * is the exact official JATS endpoint derived from the canonical PMC ID. */
export async function createPmcLeadVerifier({fetchPage=fetchAuthoritativeSource}={}){
 if(typeof fetchPage!=='function')throw fail('Official fetcher is required');
 const codeSha256=createHash('sha256').update(await readFile(self)).update(await readFile(resolver)).update(await readFile(parser)).digest('hex');
 return {id:'pmc-lead-jats-reader',version:'1',codeSha256,async verify({sourceUrl,signal}={}){
  const pmcid=parsePmcSourceId(sourceUrl),observedSourceUrl='https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id='+pmcid.slice(3)+'&retmode=xml';
  if(signal?.aborted)throw fail('Lead verification cancelled');let response;try{response=await fetchPage(observedSourceUrl,{timeoutMs:12000,maxBytes:1024*1024,maxRedirects:0,signal});}catch{throw fail('Official lead document unavailable');}
  if(!response?.reachable||response.originalUrl!==observedSourceUrl||response.finalUrl!==observedSourceUrl||!['text/xml','application/xml'].includes(response.contentType)||typeof response.text!=='string'||response.text.includes('\uFFFD')||Buffer.byteLength(response.text)<100||Buffer.byteLength(response.text)>1024*1024)throw fail('Official lead document is not readable');
  const parsed=await parsePmcMetadata(response.text,signal),ids=parsed.ids;if(!single(ids?.pmcid,/^PMC[1-9][0-9]{0,10}$/)||ids.pmcid[0]!==pmcid||!single(ids?.pmid,/^[1-9][0-9]{0,10}$/)||!single(ids?.doi,/^10\.[0-9]{4,9}\/[a-z0-9._;()/:+-]{1,200}$/i))throw fail('Official lead identifiers are missing or ambiguous');
  return {verified:true,primarySource:true,sourceUrl,observedSourceUrl,observedTextSha256:sha(response.text),pmcid,pmid:ids.pmid[0],doi:ids.doi[0]};
 }};
}
