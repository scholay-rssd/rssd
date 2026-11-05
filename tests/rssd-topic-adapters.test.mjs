import test from 'node:test';
import assert from 'node:assert/strict';
import {createTopicAdapters} from '../scripts/rssd-topic-adapters.mjs';

test('reachable source alone is insufficient; independent source assessment must confirm support',async()=>{
  const source={title:'Primary paper',url:'https://pubmed.ncbi.nlm.nih.gov/123/'},topic={title:'A method',brief:'An introduction'};
  const catalog={workspaceId:'metho',origin:'https://metho.scholay.com',complete:true,fetchedAt:new Date().toISOString(),titles:['Existing']};
  let received;
  const adapters=await createTopicAdapters({home:'/private/test',fetchCatalog:async()=>catalog,
    fetchSource:async url=>({reachable:true,originalUrl:url,text:'<script>ignore this</script><p>'+('source text '.repeat(20))+'</p>'}),
    sourceJudge:async input=>{received=input;return {primarySource:true,supportsTopic:false,confidence:'high'};}});
  assert.equal((await adapters.verifySource(source,topic)).verified,false);
  assert.doesNotMatch(received.pageText,/ignore this/);assert.match(received.pageText,/source text/);
  const positive=await createTopicAdapters({home:'/private/test',fetchCatalog:async()=>catalog,
    fetchSource:async url=>({reachable:true,originalUrl:url,text:'source text '.repeat(20)}),
    sourceJudge:async()=>({primarySource:true,supportsTopic:true,confidence:'high'})});
  assert.deepEqual(await positive.verifySource(source,topic),{url:source.url,verified:true});
});

test('only a canonical PubMed 203 can use matching EFetch evidence, followed by independent semantic review',async()=>{
  const url='https://pubmed.ncbi.nlm.nih.gov/123/',source={title:'A paper',url};
  const topic={title:'Research question',brief:'Method',sourceEvidence:[{title:'Exact original article title',url,excerpt:'seed'}]};
  const catalog={workspaceId:'metho',origin:'https://metho.scholay.com',complete:true,fetchedAt:new Date().toISOString(),titles:['Existing']};
  const long='Observed methods and contextual details. '.repeat(40);
  const xml='<PubmedArticleSet><PubmedArticle><MedlineCitation Status="MEDLINE"><PMID Version="1">123</PMID><Article><ArticleTitle>Exact original article title</ArticleTitle><Abstract><AbstractText>'+long+'</AbstractText></Abstract></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>';
  let evidenceCalls=0,judgeCalls=0,decision={primarySource:true,supportsTopic:true,confidence:'high'};
  const adapters=await createTopicAdapters({home:'/private/test',fetchCatalog:async()=>catalog,
    fetchSource:async current=>{if(current===url)throw Object.assign(Error('PubMed 203'),{status:203});evidenceCalls++;assert.match(current,/^https:\/\/eutils\.ncbi\.nlm\.nih\.gov\/entrez\/eutils\/efetch\.fcgi\?/);return {reachable:true,finalUrl:current,text:xml};},
    sourceJudge:async input=>{judgeCalls++;assert.match(input.pageText,/Exact original article title/);return decision;}});
  assert.deepEqual(await adapters.verifySource(source,topic),{url,verified:true});assert.equal(evidenceCalls,1);assert.equal(judgeCalls,1);
  decision={primarySource:true,supportsTopic:false,confidence:'high'};assert.equal((await adapters.verifySource(source,topic)).verified,false);
  await assert.rejects(adapters.verifySource(source,{...topic,sourceEvidence:[]}),/seed title/);assert.equal(evidenceCalls,2);
});

test('source fallback never hides non-203 failures or accepts a spoofed PubMed URL',async()=>{
  const catalog={workspaceId:'metho',origin:'https://metho.scholay.com',complete:true,fetchedAt:new Date().toISOString(),titles:['Existing']};
  let calls=0;const failed=await createTopicAdapters({home:'/private/test',fetchCatalog:async()=>catalog,fetchSource:async()=>{calls++;throw Object.assign(Error('Forbidden'),{status:403});},sourceJudge:async()=>{throw Error('must not judge');}});
  await assert.rejects(failed.verifySource({url:'https://pubmed.ncbi.nlm.nih.gov/123/'},{}),{status:403});assert.equal(calls,1);
  const spoofed=await createTopicAdapters({home:'/private/test',fetchCatalog:async()=>catalog,fetchSource:async()=>{calls++;throw Object.assign(Error('PubMed 203'),{status:203});},sourceJudge:async()=>{throw Error('must not judge');}});
  await assert.rejects(spoofed.verifySource({url:'https://pubmed.ncbi.nlm.nih.gov.evil.example/123/'},{}),{status:203});assert.equal(calls,2);
});
