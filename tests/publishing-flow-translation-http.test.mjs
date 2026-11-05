import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {translateHttpEdition,loadHttpTranslationConfig} from '../scripts/publishing-flow-translation-http.mjs';
import {translateEdition} from '../scripts/publishing-flow-language.mjs';
import {protectPrivateFile} from '../scripts/private-file.mjs';
import {makePublic} from './fixtures/private-file.mjs';
const source={title:'中文文章',summary:'完整摘要',markdown:'# 中文文章\n\n完整正文与[来源](https://example.org/api/{entityType})。\n\n![图](https://example.org/figure.webp)'};
const plan={id:'a'.repeat(40),sha256:'b'.repeat(64),policy:{agentId:'must-not-launch'}};
async function fixture(t,config={}){const root=await mkdtemp(join(tmpdir(),'today-http-language-'));t.after(()=>rm(root,{recursive:true,force:true}));const configFile=join(root,'translation.json'),apiKeyFile=join(root,'key');await writeFile(apiKeyFile,'PRIVATE_TRANSLATION_TOKEN',{mode:0o600});await writeFile(configFile,JSON.stringify({version:1,endpoint:'http://127.0.0.1:8091/v1/chat/completions',model:'test-translation-model',apiKeyFile,lockFile:join(root,'shared-language.lock'),...config}),{mode:0o600});await protectPrivateFile(configFile);await protectPrivateFile(apiKeyFile);return {root,configFile,apiKeyFile};}
function provider(reply={}){return async(url,options)=>{assert.equal(url,'http://127.0.0.1:8091/v1/chat/completions');assert.equal(options.headers.Authorization,'Bearer PRIVATE_TRANSLATION_TOKEN');const input=JSON.parse(options.body),protectedSource=JSON.parse(input.messages[1].content.split('SOURCE DATA:\n')[1]);assert(!JSON.stringify(input).includes('PRIVATE_TRANSLATION_TOKEN'));assert(protectedSource.markdown.includes('scholay-translation.invalid'));return Response.json({choices:[{message:{content:JSON.stringify({title:'English article',summary:'Complete abstract',markdown:protectedSource.markdown.replace('# 中文文章','# English article').replace('完整正文与','Complete text and')})},finish_reason:'stop',...reply}],usage:{total_tokens:20}});};}
test('configured HTTP translator preserves every protected URL and persists a reusable result without credentials',async t=>{
 const f=await fixture(t),edition=await translateHttpEdition(source,{root:f.root,plan},{configFile:f.configFile,fetcher:provider()});assert.equal(edition.title,'English article');assert(edition.markdown.includes('https://example.org/api/%7BentityType%7D'));assert(edition.markdown.includes('https://example.org/figure.webp'));assert(!edition.markdown.includes('scholay-translation.invalid'));
 const dir=join(f.root,'.local/publishing-flow/jobs',plan.id),checkpoint=JSON.parse(await readFile(join(dir,'translation-result.json'),'utf8'));assert.deepEqual(checkpoint.edition,edition);assert.equal(checkpoint.sourceSha256,plan.sha256);
 for(const name of await readdir(join(dir,'language-attempts'))){const provenance=await readFile(join(dir,'language-attempts',name,'provenance.json'),'utf8');assert(!provenance.includes('PRIVATE_TRANSLATION_TOKEN'));assert(JSON.parse(provenance).finishedAt);}
});
test('HTTP translator marks truncation for attention without silently accepting partial output',async t=>{
 const f=await fixture(t);await assert.rejects(translateHttpEdition(source,{root:f.root,plan},{configFile:f.configFile,fetcher:provider({finish_reason:'length'})}),error=>error.statusCode===400&&/truncated/.test(error.message));await assert.rejects(readFile(join(f.root,'.local/publishing-flow/jobs',plan.id,'translation-result.json')),error=>error.code==='ENOENT');
});
test('HTTP provider 403 and invalid JSON retain bounded errors without disclosing response data',async t=>{
 const f=await fixture(t);await assert.rejects(translateHttpEdition(source,{root:f.root,plan},{configFile:f.configFile,fetcher:async()=>new Response('PRIVATE_TRANSLATION_TOKEN',{status:403})}),error=>error.statusCode===403&&!error.message.includes('PRIVATE_TRANSLATION_TOKEN'));
 await assert.rejects(translateHttpEdition(source,{root:f.root,plan},{configFile:f.configFile,fetcher:async()=>new Response('not json')}),error=>error.statusCode===502);
});
test('untrusted HTTP endpoints and permissive config files fail before contacting a provider',async t=>{
 const f=await fixture(t,{endpoint:'http://public-provider.example/v1/chat/completions'});await assert.rejects(loadHttpTranslationConfig(f.configFile),error=>error.code==='FLOW_LANGUAGE_CONFIG');
 const g=await fixture(t);await makePublic(g.configFile);await assert.rejects(loadHttpTranslationConfig(g.configFile),error=>error.code==='FLOW_LANGUAGE_CONFIG');
});
test('cloud execution without an HTTP provider fails explicitly and never starts local ACP',async t=>{
 const before={cloud:process.env.SCHOLAY_CLOUD_EXECUTOR,config:process.env.SCHOLAY_TRANSLATION_CONFIG};process.env.SCHOLAY_CLOUD_EXECUTOR='1';delete process.env.SCHOLAY_TRANSLATION_CONFIG;t.after(()=>{for(const [key,value] of [['SCHOLAY_CLOUD_EXECUTOR',before.cloud],['SCHOLAY_TRANSLATION_CONFIG',before.config]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
 await assert.rejects(translateEdition(source,{root:'/unused',plan},{registry:{launch:()=>assert.fail('Cloud cannot fall back to ACP')}}),error=>error.code==='FLOW_LANGUAGE_CONFIG'&&error.statusCode===400);
});
test('a dropped protected image URL blocks a malformed candidate before checkpointing',async t=>{
 const f=await fixture(t);await assert.rejects(translateHttpEdition(source,{root:f.root,plan},{configFile:f.configFile,fetcher:async()=>Response.json({choices:[{message:{content:JSON.stringify({title:'English',summary:'Abstract',markdown:'# English\n\nNo links or images.'})},finish_reason:'stop'}]})}),error=>error.code==='FLOW_LANGUAGE_URLS');await assert.rejects(readFile(join(f.root,'.local/publishing-flow/jobs',plan.id,'translation-result.json')),error=>error.code==='ENOENT');
});
