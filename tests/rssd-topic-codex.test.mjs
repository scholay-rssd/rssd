import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCodexTopicJSON,codexTopicGenerator,codexTopicJudge,codexSourceJudge} from '../scripts/rssd-topic-codex.mjs';

test('local Codex child receives the requested model and no application credentials',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'rssd-codex-adapter-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const fake=join(dir,'codex');
  await writeFile(fake,"#!/usr/bin/env node\nconst fs=require('fs');const a=process.argv;const out=a[a.indexOf('-o')+1];fs.writeFileSync(out,JSON.stringify({model:a[a.indexOf('-m')+1],effort:a[a.indexOf('-c')+1],token:process.env.RSSD_CENTER_TOKEN||null,ssh:process.env.SSH_AUTH_SOCK||null,sandbox:a[a.indexOf('-s')+1]}));process.stdin.resume();\n");await chmod(fake,0o700);
  const oldToken=process.env.RSSD_CENTER_TOKEN,oldSsh=process.env.SSH_AUTH_SOCK;process.env.RSSD_CENTER_TOKEN='must-not-inherit';process.env.SSH_AUTH_SOCK='must-not-inherit';
  try {const result=await runCodexTopicJSON({command:fake,prompt:'test',schema:{type:'object'}});assert.deepEqual(result,{model:'gpt-6.1-terra',effort:'model_reasoning_effort="max"',token:null,ssh:null,sandbox:'read-only'});}
  finally {if(oldToken===undefined)delete process.env.RSSD_CENTER_TOKEN;else process.env.RSSD_CENTER_TOKEN=oldToken;if(oldSsh===undefined)delete process.env.SSH_AUTH_SOCK;else process.env.SSH_AUTH_SOCK=oldSsh;}
});
test('model adapters require policy and provide candidate, history and actual source text as untrusted data',async()=>{
  assert.throws(()=>codexTopicGenerator({}),/policy/);const seen=[];
  const run=async args=>{seen.push(args);return args.schema.properties.topics?{topics:[]}:{duplicate:false,confidence:'high'};};
  await codexTopicGenerator({writingPolicy:'policy-v2',run})({workspaceId:'metho',sectionId:'methods',count:1,existingTitles:['existing'],sourceSeeds:[{title:'source',url:'https://example.org',excerpt:'source '.repeat(20)}],editorialInstructions:'核对本站规则'});
  await codexTopicJudge({run})({topic:{title:'candidate',brief:'question'},existingTitles:['existing']});
  await codexSourceJudge({run})({topic:{title:'candidate',brief:'question'},source:{title:'paper',url:'https://example.org'},pageText:'source content'});
  assert.match(seen[0].prompt,/policy-v2/);assert.match(seen[0].prompt,/核对本站规则/);assert.match(seen[1].prompt,/existing/);assert.match(seen[2].prompt,/source content/);
});
test('generator rejects a source not in the fetched authoritative seeds',async()=>{
  const generate=codexTopicGenerator({writingPolicy:'policy',run:async()=>({topics:[{title:'A topic',brief:'Question',sources:[{title:'Other',url:'https://example.org/not-fetched'}]}]})});
  await assert.rejects(generate({workspaceId:'metho',sectionId:'methods',count:1,existingTitles:[],sourceSeeds:[{title:'Seed',url:'https://example.org/fetched',excerpt:'source '.repeat(20)}]}),/not in the verified seed/);
});
