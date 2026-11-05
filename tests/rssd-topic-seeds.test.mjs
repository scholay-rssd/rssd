import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchMethoSourceSeeds} from '../scripts/rssd-topic-seeds.mjs';

const long='Research methods and substantive details. '.repeat(40);
const xml=items=>'<PubmedArticleSet>'+items.map(([id,title,abstract])=>'<PubmedArticle><MedlineCitation><PMID Version="1">'+id+'</PMID><Article><ArticleTitle>'+title+'</ArticleTitle><Abstract><AbstractText>'+abstract+'</AbstractText></Abstract></Article></MedlineCitation></PubmedArticle>').join('')+'</PubmedArticleSet>';
const search=ids=>JSON.stringify({esearchresult:{count:String(ids.length),idlist:ids}});
const transport=(ids,body)=>async url=>({reachable:true,finalUrl:url,text:url.includes('esearch.fcgi')?search(ids):body});

test('discovers substantive PubMed abstracts and filters existing exact titles',async()=>{
 const ids=['123','456','789'],body=xml([['123','Existing article',long],['456','New &amp; useful method',long],['789','Short abstract','short']]);
 const seeds=await fetchMethoSourceSeeds({existingTitles:['existing article'],count:1,fetchSource:transport(ids,body)});
 assert.equal(seeds.length,1);assert.equal(seeds[0].title,'New & useful method');assert.equal(seeds[0].url,'https://pubmed.ncbi.nlm.nih.gov/456/');assert(seeds[0].excerpt.length>=1200);
});
test('rejects incomplete, duplicate or unexpected PubMed identities',async()=>{
 const ids=['123','456'];
 await assert.rejects(fetchMethoSourceSeeds({fetchSource:transport(ids,xml([['123','One',long]]))}),/incomplete/);
 await assert.rejects(fetchMethoSourceSeeds({fetchSource:transport(ids,xml([['123','One',long],['123','Two',long]]))}),/identity mismatch/);
 await assert.rejects(fetchMethoSourceSeeds({fetchSource:transport(ids,xml([['123','One',long],['999','Other',long]]))}),/identity mismatch/);
});
test('rejects absent, short or unverifiable candidate abstracts',async()=>{
 await assert.rejects(fetchMethoSourceSeeds({fetchSource:transport(['123'],xml([['123','Short','text']]))}),/Not enough/);
 await assert.rejects(fetchMethoSourceSeeds({fetchSource:transport(['123'],xml([['123','Unknown &custom; title',long]]))}),/Not enough/);
 await assert.rejects(fetchMethoSourceSeeds({fetchSource:async url=>({reachable:true,finalUrl:url,text:'{"esearchresult":{"count":"0","idlist":[]}}'})}),/Incomplete/);
});
test('rejects redirected or malformed discovery response and out-of-scope arguments',async()=>{
 await assert.rejects(fetchMethoSourceSeeds({fetchSource:async()=>({reachable:true,finalUrl:'https://example.org/',text:'{}'})}),/unavailable/);
 await assert.rejects(fetchMethoSourceSeeds({fetchSource:async url=>({reachable:true,finalUrl:url,text:'not-json'})}),/Invalid PubMed search/);
 await assert.rejects(fetchMethoSourceSeeds({count:0}),/Invalid research topic/);
 await assert.rejects(fetchMethoSourceSeeds({existingTitles:[null]}),/Invalid research topic/);
});
