// Explicit public code allowlist: no manuscripts, receipts or credentials.
import {cp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {portableNode} from './runtime/portable-node.mjs';
const desktop=resolve(dirname(fileURLToPath(import.meta.url)),'..'),root=resolve(desktop,'..'),out=join(desktop,'target/bundle-resources/workbench');
if(Number(process.versions.node.split('.')[0])<24)throw Error('Build with Node.js 24+ so the packaged runtime works without system Node.');
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
for(const file of ['package.json','package-lock.json'])await cp(join(desktop,'runtime',file),join(out,file));
const queue=['scripts/publishing-flow-cli.mjs','desktop/scripts/note-cards.mjs','scripts/space-registry.mjs','scripts/editorial-workspace.mjs','scripts/website-publication.mjs','desktop/scripts/publication-center.mjs','desktop/scripts/website-publisher.mjs','desktop/scripts/workspace-location.mjs','desktop/scripts/website-connection.mjs','desktop/scripts/space-authorization.mjs','desktop/scripts/labels-cloud.mjs','desktop/scripts/agent/bridge.mjs','desktop/scripts/agent/worker.mjs','desktop/scripts/agent/mcp.mjs','desktop/scripts/runtime/cursor-command.mjs'],seen=new Set();
// Native entrypoints have no JS import edge for the allowlist walker to find.
queue.push('desktop/scripts/agent/queue-snapshot.mjs','scripts/publication-queue-recover.mjs');
queue.push('desktop/scripts/rssd-center.mjs');
if(process.env.RSSD_HEADLESS_BUILD==='1')queue.push('desktop/scripts/agent/headless/standalone.mjs');
while(queue.length){const file=queue.shift();if(seen.has(file))continue;seen.add(file);const text=await readFile(join(root,file),'utf8');await mkdir(dirname(join(out,file)),{recursive:true});await writeFile(join(out,file),text);for(const match of text.matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*['"](\.[^'"]+\.[mc]js)['"]/g)){const relative=resolve(root,dirname(file),match[1]).slice(root.length+1).replaceAll('\\','/');if(!relative.startsWith('scripts/')&&!relative.startsWith('desktop/scripts/')&&!relative.startsWith('admin/')&&!relative.startsWith('web/')&&!relative.startsWith('contracts/'))throw Error('Unexpected runtime import '+relative);queue.push(relative);}}
await cp(join(desktop,'scripts/agent/vendor/aionui'),join(out,'desktop/scripts/agent/vendor/aionui'),{recursive:true});
await mkdir(join(out,'sites'),{recursive:true});await cp(join(root,'sites/profiles.json'),join(out,'sites/profiles.json'));
await cp(join(desktop,'resources/workspace-template'),join(out,'workspace-template'),{recursive:true});
const portable=await portableNode(join(desktop,'target/node-runtime'));
const bundled=join(out,process.platform==='win32'?'node.exe':'node');
await cp(portable,bundled);
const license=join(dirname(portable),process.platform==='win32'?'LICENSE':'../LICENSE');
await cp(license,join(out,'NODE-LICENSE'));
const probe=spawnSync(bundled,['--version'],{encoding:'utf8'});if(probe.status!==0)throw Error('Packaged Node is not standalone: '+probe.stderr);
const npm=process.platform==='win32'?join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'):process.env.npm_execpath?.endsWith('npm-cli.js')?process.env.npm_execpath:join(dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js');
// Runtime modules are invoked with the bundled Node executable, never npm's
// shell shims. Keep those optional CLI files out of native installer resources.
const result=spawnSync(process.execPath,[npm,'ci','--omit=dev','--bin-links=false','--no-audit','--no-fund'],{cwd:out,stdio:'inherit'});if(result.status!==0)throw Error('Runtime dependencies failed');
await writeFile(join(out,'runtime.json'),JSON.stringify({version:1,node:process.version,platform:process.platform,files:[...seen].sort()}));
console.log('Bundled standalone workbench:',out);
