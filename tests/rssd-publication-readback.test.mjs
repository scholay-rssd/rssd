import test from 'node:test';
import assert from 'node:assert/strict';
import protocol from '../contracts/rssd-v1.cjs';
import {createPublicationReadbackAdapter} from '../scripts/rssd-publication-readback.mjs';
import {renderArticle} from '../web/engine/article-math.mjs';
const slot={siteId:'enter',workspaceId:'enter',sectionId:'forums',destinationId:'site-enter',requiredLocales:['zh-CN']};
function fixture(){
 const url='https://enter.example/news/abc/',publicUrl='https://enter.example/rssd-content/'+protocol.hash(['work-one','zh-CN'])+'.json',body='A verifiable article body.';
 const data={version:1,requestId:'pub-one',siteId:'enter',workspaceId:'enter',sectionId:'forums',workId:'work-one',locale:'zh-CN',revision:1,contentHash:'a'.repeat(64),route:'/news/abc/',content:{bodyMarkdown:body}};
 const row={id:'pub-one',workspaceId:'enter',workId:'work-one',locale:'zh-CN',destinationId:'site-enter',revision:1,state:'published',receipt:{state:'success',requestId:'pub-one',siteId:'enter',workId:'work-one',locale:'zh-CN',revision:1,contentHash:'a'.repeat(64),packetHash:protocol.hash(data),publicUrl,url}};
 const work={workId:'work-one',publications:[{id:'pub-one',locale:'zh-CN',revision:1,contentHash:'a'.repeat(64),requestId:'submission-one'}]},profiles=[{id:'enter',spaceId:'enter',origin:'https://enter.example'}],calls=[];
 const client={publications:async input=>{calls.push(input);return [row];}},fetchPage=async input=>({reachable:true,originalUrl:input,finalUrl:input,text:input===publicUrl?JSON.stringify(data):`<link rel="canonical" href="${url}"><div class="article-body">${renderArticle(body)}</div>`});
 return {row,data,work,profiles,client,fetchPage,calls,url};
}
test('verified requires matching original publication, receiver packet, canonical page and full body',async()=>{
 const f=fixture(),verify=createPublicationReadbackAdapter(f),result=await verify({slot,work:f.work});assert.equal(result.state,'verified');assert.equal(result.urls[0].url,f.url);assert.equal(f.calls[0].workspaceId,'enter');
});
test('queued and failed receivers remain pending or blocked, never verified',async()=>{
 const f=fixture(),verify=createPublicationReadbackAdapter(f);f.row.state='queued';assert.equal((await verify({slot,work:f.work})).state,'pending');f.row.state='blocked';assert.deepEqual(await verify({slot,work:f.work}),{state:'blocked',reason:'receiver_blocked'});
});
test('receipt, content identity, and page divergence cannot report success',async()=>{
 const f=fixture(),verify=createPublicationReadbackAdapter(f);f.row.receipt.contentHash='b'.repeat(64);assert.equal((await verify({slot,work:f.work})).reason,'receiver_receipt_mismatch');f.row.receipt.contentHash='a'.repeat(64);f.data.content.bodyMarkdown='changed';assert.equal((await verify({slot,work:f.work})).reason,'public_content_mismatch');f.row.receipt.packetHash=protocol.hash(f.data);assert.equal((await verify({slot,work:f.work})).reason,'public_page_not_converged');
});
test('temporary Center failure is pending, access rejection is blocked, and no write is made',async()=>{
 const f=fixture();let writes=0;f.client.publications=async()=>{throw Object.assign(Error('offline'),{status:0});};f.client.submit=()=>{writes++;};const verify=createPublicationReadbackAdapter(f);assert.equal((await verify({slot,work:f.work})).state,'pending');f.client.publications=async()=>{throw Object.assign(Error('denied'),{status:403});};assert.equal((await verify({slot,work:f.work})).state,'blocked');assert.equal(writes,0);
});

test('flow completion requires both public editions and the exact original community mapping, without posting',async()=>{
 const f=fixture(),enUrl='https://enter.example/en/news/abc/',enDataUrl='https://enter.example/rssd-content/'+protocol.hash(['work-one','en'])+'.json';
 const enData={...f.data,requestId:'pub-en',locale:'en',route:'/en/news/abc/',content:{bodyMarkdown:'Translated verifiable body.'}};
 const enRow={...f.row,id:'pub-en',locale:'en',receipt:{...f.row.receipt,requestId:'pub-en',locale:'en',packetHash:protocol.hash(enData),publicUrl:enDataUrl,url:enUrl}};
 const work={...f.work,publications:[...f.work.publications,{id:'pub-en',locale:'en',revision:1,contentHash:'a'.repeat(64),requestId:'submission-en'}]};
 const expectedSlot={...slot,requireFlow:true,requiredLocales:['zh-CN','en']};let maps=0,writes=0,links={};
 f.client.publications=async()=>[f.row,enRow];f.client.submit=()=>{writes++;};
 const page=async input=>{if(input.endsWith('/community/links.json')){maps++;return {reachable:true,finalUrl:input,text:JSON.stringify({version:1,links})};}if(input===enDataUrl)return {reachable:true,finalUrl:input,text:JSON.stringify(enData)};if(input===enUrl)return {reachable:true,finalUrl:input,text:`<link rel="canonical" href="${enUrl}"><div class="article-body">${renderArticle(enData.content.bodyMarkdown)}</div>`};return f.fetchPage(input);};
 const verify=createPublicationReadbackAdapter({...f,fetchPage:page});enRow.state='queued';assert.equal((await verify({slot:expectedSlot,work})).reason,'receiver_pending');assert.equal(maps,0);enRow.state='published';
 const pending=await verify({slot:expectedSlot,work});assert.equal(pending.state,'pending');assert.equal(pending.reason,'community_link_pending');assert.equal(pending.publicUrls.length,2);
 links['/news/abc/']='https://example.org/t/-/12345';assert.equal((await verify({slot:expectedSlot,work})).reason,'community_link_invalid');
 links['/news/abc/']='https://enterscholar.com/t/-/12345';const result=await verify({slot:expectedSlot,work});assert.equal(result.state,'verified');assert.equal(result.communityUrl,links['/news/abc/']);assert.equal(result.urls.length,2);assert.equal(writes,0);
});
