import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {AgentRegistry,executableCommand,validAuthUrl,AGENTS} from '../desktop/scripts/agent/agent-registry.mjs';
import {agentModelOptions,configurationRequest,normalizeAgentTool} from '../desktop/scripts/agent/agent-configuration.mjs';
import {flowPermission} from '../desktop/scripts/agent/workflow.mjs';
import {TaskStore,taskInstructions} from '../desktop/scripts/agent/task-store.mjs';
import {parseArgs} from '../desktop/scripts/agent/headless/produce.mjs';
import {configurationRestoration} from '../desktop/scripts/agent/session-state.mjs';
import {profiles} from '../scripts/site-config.mjs';
import {AgentManager} from '../desktop/scripts/agent/agent-manager.mjs';

test('concurrent logins share one pending launch and cancellation owns the spawned child',async t=>{
 let release,entered,launches=0;
 const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r),events=[];
 const manager=new AgentManager({get:async()=>({loginArgs:[]}),launch:async()=>{launches++;entered();await gate;return {command:process.execPath,args:['-e','setInterval(()=>{},1000)']};}},e=>events.push(e));
 t.after(()=>manager.close());
 const first=manager.login('codex');await ready;
 assert.deepEqual(await manager.login('codex'),{started:true});assert.equal(launches,1);
 release();assert.deepEqual(await first,{started:true});
 const child=manager.logins.get('codex').child,closed=new Promise(r=>child.once('close',r));
 manager.cancel('codex');await closed;
 assert.equal(manager.logins.size,0);assert.deepEqual(events.map(e=>e.status),['cancelled']);
});

test('cancelling a login during launch prevents the late process from starting',async()=>{
 let release,entered;
 const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const manager=new AgentManager({get:async()=>({loginArgs:[]}),launch:async()=>{entered();await gate;return {command:process.execPath,args:['-e','process.exit(0)']};}},()=>{});
 const pending=manager.login('codex');await ready;manager.cancel('codex');release();
 assert.deepEqual(await pending,{started:false,cancelled:true});assert.equal(manager.logins.size,0);
});

test('failed and manual login setup release their reservation for a retry',async()=>{
 let failed=true;
 const manager=new AgentManager({get:async()=>{if(failed)throw Error('setup failed');return {command:'manual-cli'};}},()=>{});
 await assert.rejects(manager.login('custom'),/setup failed/);assert.equal(manager.logins.size,0);
 failed=false;assert.equal((await manager.login('custom')).manual,true);assert.equal(manager.logins.size,0);
});

async function directory(t){const root=await mkdtemp(join(tmpdir(),'today-multi-agent-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
test('registry keeps global custom commands as argv, rejects script injection, and preserves built-ins',async t=>{
 const root=await directory(t),registry=new AgentRegistry(join(root,'agents.json'));
 await registry.save({id:'custom-example',name:'Example',command:process.execPath,args:[resolve('tests/fixtures/agent/generic.mjs')]});
 const launch=await registry.launch('custom-example');assert.equal(launch.command,process.execPath);assert.equal(launch.args.length,1);
 await registry.save({id:'codex',enabled:false});await assert.rejects(registry.launch('codex'),/已停用/);
 assert.equal((await registry.get('custom-example')).name,'Example');assert.equal((await registry.definitions()).length,AGENTS.length+1);
 await assert.rejects(registry.save({id:'custom-bad',name:'bad',command:'node\nsecret'}),/可执行文件/);
 await assert.rejects(registry.save({id:'custom-bad',name:'bad',command:'node',args:'--acp'}),/数组/);
 await assert.rejects(registry.remove('cursor'),/内置/);await registry.remove('custom-example');await assert.rejects(registry.get('custom-example'),/不存在/);
});
test('Windows npm shims resolve the script without cmd.exe or shell interpolation',async t=>{
 const root=await directory(t);await mkdir(join(root,'node_modules','demo'),{recursive:true});await writeFile(join(root,'node_modules','demo','cli.js'),'');
 const shim=join(root,'tool.cmd');await writeFile(shim,'@"%dp0%/'+join('node_modules','demo','cli.js')+'" %*');
 const command=executableCommand(shim,['literal & value'],{platform:'win32',env:{PATH:root}});
 assert.equal(command.command,process.execPath);assert.deepEqual(command.args,[join(root,'node_modules','demo','cli.js'),'literal & value']);
 assert.equal(executableCommand('missing-command',{},{env:{PATH:root}}),null);
});
test('AionUi option adapter handles grouped ACP and legacy model capabilities, without requiring Auto',()=>{
 const config={configOptions:[{id:'model',type:'select',category:'model',currentValue:'b',options:[{name:'family',options:[{value:'a',name:'Alpha'},{value:'b',label:'Beta'}]}]}]};
 assert.deepEqual(agentModelOptions(config).options.map(o=>o.label),['Alpha','Beta']);assert.equal(agentModelOptions(config).currentValue,'b');
 assert.equal(configurationRequest(config,'model','a').method,'session/set_config_option');assert.throws(()=>configurationRequest(config,'model','unknown'));
 const legacy={models:{currentModelId:'x',availableModels:[{modelId:'x',name:'X'}]}};assert.equal(agentModelOptions(legacy).id,'$model');assert.equal(configurationRequest(legacy,'$model','x').method,'session/set_model');
 assert.deepEqual(configurationRestoration(legacy,{models:{currentModelId:'y',availableModels:[{modelId:'x'},{modelId:'y'}]}}),[{id:'$model',value:'x',category:'model'}]);
 assert.deepEqual(configurationRestoration(legacy,{models:{currentModelId:'y',availableModels:[{modelId:'y'}]}}),[]);
});
test('MCP title normalization preserves task authorization and never authorizes shell or unknown servers',()=>{
 const task={mode:'observation',notebook:{},workflow:{authorized:true,sources:'combined'}};
 for(const title of ['mcp.scholay-workbench.task_read','mcp__scholay-workbench__task_read'])assert.equal(flowPermission(task,normalizeAgentTool({title,kind:'other'})),true);
 assert.equal(flowPermission(task,normalizeAgentTool({title:'mcp.scholay-workbench.task_read',kind:'execute',rawInput:{command:'erase'}})),false);
 for(const title of ['mcp.remote.task_read','mcp.scholay-workbench.cloud_submit','mcp__scholay-workbench__draft_save'])assert.equal(flowPermission(task,normalizeAgentTool({title,kind:'other'})),false);
 assert.equal(validAuthUrl('https://auth.openai.com/deviceauth',AGENTS[1]),'https://auth.openai.com/deviceauth');assert.equal(validAuthUrl('https://openai.com.evil.test/',AGENTS[1]),null);
});
test('all ten workspace defaults stay isolated and old conversations bind to Cursor without rewriting documents',async t=>{
 const root=await directory(t),stores=Array.from({length:10},(_,i)=>new TaskStore(join(root,String(i))));
 for(const [i,store] of stores.entries())await store.settings({defaultAgentId:i%2?'codex':'cursor'});
 for(const [i,store] of stores.entries())assert.equal((await store.settings()).defaultAgentId,i%2?'codex':'cursor');
 const store=stores[0],task=await store.create({mode:'observation'});await writeFile(join(root,'article.md'),'正文与自定义模板保留');
 assert.doesNotMatch(taskInstructions(task),/Cursor Auto/);
 await store.selectAgent(task.id,'codex');assert.equal((await store.get(task.id)).agentId,'codex');
 const dir=join(store.dir(task.id),'cursor');await mkdir(dir,{recursive:true});await writeFile(join(dir,'session.json'),JSON.stringify({root:store.root,sessionId:'existing',history:[{role:'user',text:'earlier'}]}));
 await assert.rejects(store.selectAgent(task.id,'claude'),/绑定原智能体/);assert.equal(await readFile(join(root,'article.md'),'utf8'),'正文与自定义模板保留');
});
test('headless parser supports explicit agents and rejects malformed selection',()=>{
 assert.equal(parseArgs(['today','news','observation','brief.txt','--agent','codex','--no-publish']).agentId,'codex');
 assert.throws(()=>parseArgs(['today','news','observation','brief.txt','--agent']));
 assert.throws(()=>parseArgs(['today','news','observation','brief.txt','--agent','../../bad']));
});

test('headless CLI lists, checks and sets an isolated space default without a display or task',async t=>{
 const root=await directory(t),site=profiles.find(p=>p.id==='pets'),space=join(root,'spaces',site.spaceId);
 await mkdir(join(space,'workspace'),{recursive:true});await writeFile(join(space,'site.json'),JSON.stringify(site));
 const registry=new AgentRegistry(join(root,'global','agents.json'));await registry.save({id:'custom-fixture',name:'Fixture',command:process.execPath,args:[resolve('tests/fixtures/agent/generic.mjs')]});
 const env={...process.env,DISPLAY:'',WAYLAND_DISPLAY:'',SCHOLAY_HEADLESS_SKIP_UPDATE:'1',SCHOLAY_SPACES_ROOT:join(root,'spaces'),SCHOLAY_AUTH_DIR:join(root,'auth'),SCHOLAY_HEADLESS_HOME:join(root,'headless'),SCHOLAY_GLOBAL_APP_DATA:join(root,'global')};delete env.SCHOLAY_AUTH_FILE;delete env.SCHOLAY_SITE_CONFIG;
 const run=(action,...args)=>{const result=spawnSync(process.execPath,[resolve('desktop/scripts/agent/headless/cli.mjs'),'agents','pets',action,...args],{env,encoding:'utf8',timeout:12000});assert.equal(result.status,0,result.stderr);return result.stdout;};
 assert.equal(JSON.parse(run('list')).defaultAgentId,'cursor');assert.equal(JSON.parse(run('check','custom-fixture')).protocolVersion,1);
 run('default','custom-fixture');assert.equal(JSON.parse(run('list')).defaultAgentId,'custom-fixture');
 assert.equal((await new TaskStore(join(space,'workspace')).list()).length,0);
});

test('real bridge uses a non-Cursor ACP agent: no Auto, model switching, scoped tools, resume and cancellation',async t=>{
 const root=await mkdtemp(join(tmpdir(),'today-multi-agent-'));await mkdir(join(root,'articles'));await mkdir(join(root,'_ops/inventory'),{recursive:true});await writeFile(join(root,'_ops/inventory/article-index.json'),JSON.stringify({articles:{},annexColumns:[]}));
 const global=join(root,'global');const registry=new AgentRegistry(join(global,'agents.json'));await registry.save({id:'custom-fixture',name:'Fixture',command:process.execPath,args:[resolve('tests/fixtures/agent/generic.mjs')]});
 const events=[],states=new Map();let sequence=0;const pending=new Map();
 const child=spawn(process.execPath,[resolve('desktop/scripts/agent/bridge.mjs')],{env:{...process.env,SCHOLAY_EDITORIAL_ROOT:root,SCHOLAY_GLOBAL_APP_DATA:global},stdio:['pipe','pipe','pipe']});
 child.stderr.resume();createInterface({input:child.stdout}).on('line',line=>{const v=JSON.parse(line);if(v.event){events.push(v.event);if(v.event.type==='task_state')states.set(v.event.taskId,v.event.state);}else{const p=pending.get(v.id);if(p){clearTimeout(p.timer);pending.delete(v.id);v.error?p.reject(Error(v.error)):p.resolve(v.result);}}});
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>reject(Error('timeout '+method)),12000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
 t.after(async()=>{await call('task_shutdown').catch(()=>{});child.stdin.end();if(child.exitCode===null)await new Promise(r=>child.once('exit',r));await rm(root,{recursive:true,force:true});});
 const until=async fn=>{const end=Date.now()+10000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('fixture timed out');};
 await call('agent_default',{agentId:'custom-fixture'});let task=await call('task_create',{mode:'observation'});assert.equal(task.agentId,'custom-fixture');
 assert.equal((await call('task_list')).length,1);await call('agent_check',{agentId:'custom-fixture'});assert.equal((await call('task_list')).length,1);
 let s=await call('connect',{taskId:task.id});assert.equal(s.agentId,'custom-fixture');assert.equal(s.configuration.configOptions[0].currentValue,'alpha');
 await call('configure',{taskId:task.id,id:'model',value:'beta'});
 task=await call('notebook_open',{taskId:task.id});await call('notebook_prompt',{taskId:task.id,text:'generic mcp',action:'organize',expectedRevision:task.revision});await until(()=>states.get(task.id)?.busy===false);
 s=await call('status',{taskId:task.id});assert.equal(s.status,'已完成');assert.equal(s.configuration.configOptions[0].currentValue,'beta');assert.ok(s.history.some(m=>m.text==='model=beta; permission=selected'));
 await assert.rejects(call('agent_select',{taskId:task.id,agentId:'codex'}),/绑定原智能体/);
 await call('prompt',{taskId:task.id,text:'hold'});await until(()=>events.some(e=>e.taskId===task.id&&e.type==='message'&&e.message.text==='hold'));
 await call('cancel',{taskId:task.id});await until(()=>states.get(task.id)?.busy===false);assert.equal((await call('status',{taskId:task.id})).status,'已停止');
 s=await call('connect',{taskId:task.id});assert.equal(s.configuration.configOptions[0].currentValue,'beta');assert.ok(s.history.some(m=>m.role==='user'));
});
