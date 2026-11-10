import {test} from 'node:test';
import {existsSync} from 'node:fs';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
test('bundled runtime initializes an empty directory, preserves files and edits without a source checkout',{skip:!existsSync('desktop/target/bundle-resources/workbench/runtime.json')},async()=>{
 const temp=await mkdtemp(join(tmpdir(),'scholay-handoff-')),workspace=join(temp,'中文稿件 空格'),app=join(temp,'app-data');await mkdir(workspace);await mkdir(app);
 const runtime=resolve('desktop/target/bundle-resources/workbench'),node=join(runtime,process.platform==='win32'?'node.exe':'node');
 const env={...process.env,SCHOLAY_APP_DATA:app,SCHOLAY_TEMPLATE_ROOT:join(runtime,'workspace-template')};delete env.SCHOLAY_EDITORIAL_ROOT;
 const call=(script,method,params={})=>{const r=spawnSync(node,[join(runtime,script)],{cwd:temp,env,input:JSON.stringify({method,params})+'\n',encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
 try{
  call('desktop/scripts/workspace-location.mjs','initialize',{path:workspace});
  assert.match(await readFile(join(workspace,'AGENTS.md'),'utf8'),/scholay-workbench/);
  const draft=call('scripts/editorial-workspace.mjs','draft_create',{id:'handoff-test',title:'图文工作流',column:'新闻聚合',markdown:'# 图文工作流\n\n原始正文。',archiveCategory:'学者观察'});
  call('scripts/editorial-workspace.mjs','draft_save',{id:draft.id,markdown:'# 图文工作流\n\n修改后的正文。',expectedSha256:draft.sha256});
  const list=call('desktop/scripts/website-publisher.mjs','snapshot');assert.equal(list.articles.length,1);
  const snapshot=call('desktop/scripts/publication-center.mjs','snapshot');assert.equal(snapshot.drafts.length,1);
  assert.match(call('scripts/editorial-workspace.mjs','draft_read',{id:draft.id}).markdown,/修改后的正文/);
  const reject=spawnSync(node,[join(runtime,'desktop/scripts/workspace-location.mjs')],{env,input:JSON.stringify({method:'initialize',params:{path:workspace}})+'\n',encoding:'utf8'});assert.notEqual(reject.status,0);assert.match(await readFile(join(workspace,draft.canonicalPath),'utf8'),/修改后的正文/);
 }finally{await rm(temp,{recursive:true,force:true});}
});
