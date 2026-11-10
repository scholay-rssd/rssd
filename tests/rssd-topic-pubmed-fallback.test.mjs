import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchPubmedFallback} from '../scripts/rssd-topic-pubmed-fallback.mjs';
const url='https://pubmed.ncbi.nlm.nih.gov/12345/',title='A method & evidence';
const abstract='Validated methods and observed results in a public article. '.repeat(30);
const record=(id='12345',extra='',abstractText=abstract,titleText='A method &amp; evidence')=>'<PubmedArticle><MedlineCitation Status="MEDLINE"><PMID Version="1">'+id+'</PMID><Article><ArticleTitle>'+titleText+'</ArticleTitle><Abstract><AbstractText>'+abstractText+'</AbstractText></Abstract></Article>'+extra+'</MedlineCitation></PubmedArticle>';
const xml=(r=record())=>'<PubmedArticleSet>'+r+'</PubmedArticleSet>';
const source=(body=xml(),override={})=>async api=>({reachable:true,finalUrl:api,text:body,...override});
const get=(opts={})=>fetchPubmedFallback(url,{httpStatus:203,expectedTitle:title,fetchSource:source(),...opts});
test('203 fallback matches canonical PMID and exact seed title; provides no semantic verdict',async()=>{
 const result=await get();assert.equal(result.pmid,'12345');assert.equal(result.title,title);assert(result.abstract.length>=1200);assert.equal(result.url,url);assert.equal(result.verified,undefined);assert.equal(result.transport,'pubmed-efetch-203');
});
test('only HTTP 203 and exact canonical PubMed links are eligible',async()=>{
 await assert.rejects(get({httpStatus:200}),/only applies/);await assert.rejects(get({httpStatus:500}),/only applies/);
 for(const bad of ['https://pubmed.ncbi.nlm.nih.gov/12345','https://pubmed.ncbi.nlm.nih.gov/12345/?key=x','https://pubmed.ncbi.nlm.nih.gov.evil.example/12345/','http://pubmed.ncbi.nlm.nih.gov/12345/','https://pubmed.ncbi.nlm.nih.gov/0001/'])await assert.rejects(fetchPubmedFallback(bad,{httpStatus:203,expectedTitle:title,fetchSource:source()}),/canonical/);
});
test('fails closed on mismatched PMID or changed title and never uses redirected response',async()=>{
 await assert.rejects(get({fetchSource:source(xml(record('98765')))}),/PMID does not match/);
 await assert.rejects(get({expectedTitle:'another title'}),/title does not match/);
 await assert.rejects(get({fetchSource:source(xml(),{finalUrl:'https://evil.example/'})}),/unavailable or redirected/);
});
test('rejects PubMed retraction and concern markers, including incoming corrections',async()=>{
 for(const extra of ['<PublicationType>Retracted Publication</PublicationType>','<PublicationType>Retraction of Publication</PublicationType>','<PublicationType>Published Erratum</PublicationType>','<CommentsCorrections RefType="RetractionIn"/>','<CommentsCorrections RefType="ExpressionOfConcernIn"/>'])await assert.rejects(get({fetchSource:source(xml(record('12345',extra)))}),/retraction or concern/);
});
test('rejects short abstracts, incomplete and ambiguous XML',async()=>{
 await assert.rejects(get({fetchSource:source(xml(record('12345','','short')))}),/not sufficiently complete/);
 await assert.rejects(get({fetchSource:source('<html/>')}),/Invalid PubMed/);
 await assert.rejects(get({fetchSource:source(xml(record()+record()))}),/exactly one/);
 await assert.rejects(get({fetchSource:source(xml(record('12345','',abstract,'Title &unknown;')))}),/Unsupported PubMed entity/);
});
