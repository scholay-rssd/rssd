import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {configuredMcpNames,pilotCodexEnvironment} from '../desktop/scripts/agent/center-pilot-env.mjs';

test('automatic Codex session retains only needed environment and disables known servers',async()=>{
  const env=await pilotCodexEnvironment({HOME:'/example',PATH:'/bin',RSSD_CENTER_TOKEN:'private',SSH_AUTH_SOCK:'private'}, {cwd:'/example/jobs/a',inspect:async()=>['lark-mcp','figma']});
  assert.equal(env.RSSD_CENTER_TOKEN,undefined);assert.equal(env.SSH_AUTH_SOCK,undefined);
  const c=JSON.parse(env.CODEX_CONFIG);assert.equal(c.model,'gpt-6.1-terra');assert.equal(c.model_reasoning_effort,'max');assert.deepEqual(c.notify,[]);assert.equal(c.features.hooks,false);assert.equal(c.features.plugins,false);assert.equal(c.mcp_servers['lark-mcp'].enabled,false);assert.equal(c.mcp_servers.figma.enabled,false);
});
test('server-name parser returns names only and fails closed on malformed TOML',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'rssd-pilot-env-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'config.toml');
  await writeFile(file,'[mcp_servers.alpha]\ncommand = "SECRET_VALUE"\n[mcp_servers."beta-server"]\nenabled=true\n');
  const names=await configuredMcpNames([file]);assert.deepEqual(names,['alpha','beta-server']);assert(!JSON.stringify(names).includes('SECRET_VALUE'));
  await writeFile(file,'[mcp_servers.invalid\n');await assert.rejects(configuredMcpNames([file]),/Unable to inspect/);
});
