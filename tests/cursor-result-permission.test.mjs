import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {join,basename,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {cursorResultPermission} from '../desktop/scripts/agent/cursor-result-permission.mjs';

async function fixture(t){
 const home=await mkdtemp(join(tmpdir(),'cursor-permission-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const dir=join(home,'.cursor/projects/Users-owner-editorial/agent-tools');await mkdir(dir,{recursive:true});
 const path=join(dir,'abfd146d-4db5-4895-a627-5c6bd01f0979.txt');
 await writeFile(path,JSON.stringify({markdown:'Synthetic public material',document:{warnings:[]}}));
 // Exercise the POSIX command grammar on every host; Windows command refusal
 // and native Read are tested explicitly below, with the real local filesystem.
 return {home,dir,path,options:{homeDirectory:home,platform:'linux'}};
}
const execute=command=>({kind:'execute',title:'Run command',rawInput:{command,_toolName:'Shell'}});
const quote=value=>"'"+value+"'";
const shellQuote=value=>'"'+value.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"';
const python=(path,body="print(d['markdown'][:5000]);print(d['document'].get('warnings'))")=>`python3 -c ${shellQuote(`import json;d=json.load(open(${JSON.stringify(path)}));${body}`)}`;
const node=script=>`node -e ${shellQuote(script)}`;

test('approves the screenshot Python result reads with semicolons or newlines',async t=>{
 const f=await fixture(t);
 for(const command of [
  python(f.path),
  `python3 -c ${shellQuote(` import json\nd=json.load(open(${JSON.stringify(f.path)}))\nprint(d['markdown'][:5000])\nprint(d['document'].get('warnings'))`)}`,
  `python3 -I -c 'import json;d=json.load(open(${JSON.stringify(f.path)},"r",encoding="utf-8"));print(d["markdown"][0:5000]);print(d["document"].get("warnings"))'`,
  python(f.path,"print(json.dumps(d['document'],ensure_ascii=False,indent=2))"),
 ])assert.equal(await cursorResultPermission(execute(command),f.options),true,command);
});

test('approves only fixed Node builtin reads and bounded output expressions',async t=>{
 const f=await fixture(t);
 for(const script of [
  `const fs=require('fs');const d=JSON.parse(fs.readFileSync(${JSON.stringify(f.path)},'utf8'));console.log(d.markdown.slice(0,5000));console.log(d.document.warnings);`,
  `const data=JSON.parse(require('node:fs').readFileSync(${JSON.stringify(f.path)},'utf-8'));console.log(JSON.stringify(data.document,null,2));`,
  `let fs=require('node:fs');let text=fs.readFileSync(${JSON.stringify(f.path)},'utf8');process.stdout.write(text.slice(0,20000));`,
  `console.log(require('fs').readFileSync(${JSON.stringify(f.path)},'utf8'));`,
 ])assert.equal(await cursorResultPermission(execute(node(script)),f.options),true,script);
});

test('approves a single cat file and Read tool aliases without using the title as authority',async t=>{
 const f=await fixture(t);
 for(const command of [`cat ${quote(f.path)}`,`/bin/cat -- ${quote(f.path)}`])assert.equal(await cursorResultPermission(execute(command),f.options),true);
 for(const property of ['path','file_path','filePath']){
  assert.equal(await cursorResultPermission({kind:'read',title:'Read File',rawInput:{[property]:f.path,offset:0,limit:5000}},f.options),true);
  assert.equal(await cursorResultPermission({kind:'other',title:'irrelevant',rawInput:{_toolName:'Read',[property]:f.path}},f.options),true);
 }
 assert.equal(await cursorResultPermission({kind:'execute',title:`cat ${f.path}`,rawInput:{}},f.options),false);
 assert.equal(await cursorResultPermission({kind:'delete',title:'Read File',rawInput:{path:f.path}},f.options),false);
 assert.equal(await cursorResultPermission({...execute(`cat ${quote(f.path)}`),kind:'delete'},f.options),false);
 assert.equal(await cursorResultPermission({kind:'execute',rawInput:{command:python(f.path),cwd:'/tmp/another-project'}},f.options),false);
});

test('rejects shell chaining, substitution, redirects, environment prefixes and extra arguments',async t=>{
 const f=await fixture(t),base=`cat ${quote(f.path)}`;
 for(const command of [
  `${base};touch /tmp/no`,`${base} && true`,`${base} || true`,`${base} | cat`,`${base} > /tmp/no`,`${base} >> /tmp/no`,`${base} < /tmp/no`,`${base}\ntrue`,
  `cat $(printf ${quote(f.path)})`,`cat \`printf ${quote(f.path)}\``,`cat "${f.path}$(true)"`,`cat "${f.path}\`true\`"`,
  `PATH=/tmp cat ${quote(f.path)}`,`sh -c "${base}"`,`${base} ${quote(f.path)}`,`cat -n ${quote(f.path)}`,`./cat ${quote(f.path)}`,
 ])assert.equal(await cursorResultPermission(execute(command),f.options),false,command);
});

test('rejects Python writes, imports, calls and expressions outside the positive grammar',async t=>{
 const f=await fixture(t);
 for(const command of [
  python(f.path,"print(d['markdown']);open('/tmp/no','w').write('bad')"),
  python(f.path,"print(__import__('os').system('true'))"),
  python(f.path,"print(eval(d['markdown']))"),
  python(f.path,"print(d['markdown'].__class__)"),
  python(f.path,"print(d['markdown'][:200001])"),
  python(f.path,"print(d['markdown'][-1:5000])"),
  python(f.path).replace('import json;','import json,os;'),
  `python3 -c ${shellQuote(`import json;d=json.load(open(${JSON.stringify(f.path)},'w'));print(d)`)}`,
  `python3 -c ${shellQuote(`import json;d=json.load(open(${JSON.stringify(f.path)},opener=bad));print(d)`)}`,
  `python3 -c ${shellQuote(`import json;d=json.load(open(f${JSON.stringify(f.path)}));print(d)`)}`,
  python(f.path).replace('json.load(open(',"json.load(__import__('builtins').open("),
 ])assert.equal(await cursorResultPermission(execute(command),f.options),false,command);
});

test('rejects Node writes, arbitrary requires, callbacks, calls and mutable expressions',async t=>{
 const f=await fixture(t),prefix=`const fs=require('fs');const d=JSON.parse(fs.readFileSync(${JSON.stringify(f.path)},'utf8'));`;
 for(const script of [
  prefix+"fs.writeFileSync('/tmp/no','bad');console.log(d);",
  prefix+"console.log(eval(d.markdown));",
  prefix+"console.log(d.markdown.constructor('bad')());",
  prefix+"console.log(d.markdown.slice(0,200001));",
  prefix+"console.log(d.markdown.slice(-1,5000));",
  prefix+"console.log(d.map(x=>x));",
  prefix+"console.log(require('child_process').execSync('true'));",
  prefix+"console.log(d);process.exit();",
  prefix.replace("require('fs')","require('./fs')")+"console.log(d);",
  prefix.replace("'utf8'","{encoding:'utf8'}")+"console.log(d);",
 ])assert.equal(await cursorResultPermission(execute(node(script)),f.options),false,script);
});

test('requires the exact cache shape, real file, bounded size and no path aliases',async t=>{
 const f=await fixture(t);
 for(const path of [
  join(f.home,'.cursor/config.json'),join(f.home,'.cursor/projects/Users-owner-editorial/notes.txt'),
  join(f.dir,'nested','file.txt'),join(f.dir,'missing.txt'),join(f.dir,'result.json'),
  `${f.dir}/../agent-tools/${basename(f.path)}`,f.path+'\n',relative(f.home,f.path),
 ])assert.equal(await cursorResultPermission(execute(`cat ${quote(path)}`),f.options),false,path);
 await mkdir(join(f.dir,'folder.txt'));assert.equal(await cursorResultPermission(execute(`cat ${quote(join(f.dir,'folder.txt'))}`),f.options),false);
 assert.equal(await cursorResultPermission(execute(`cat ${quote(f.path)}`),{...f.options,maxBytes:2}),false);
 assert.equal(await cursorResultPermission(execute(`cat ${quote(f.path)}`),{...f.options,maxBytes:Infinity}),false);
 assert.equal(await cursorResultPermission({kind:'read',title:'Read',rawInput:{path:f.path,filePath:'/tmp/another'}},f.options),false);
 assert.equal(await cursorResultPermission({kind:'read',title:'Read',rawInput:{path:f.path,limit:200001}},f.options),false);
 assert.equal(await cursorResultPermission({kind:'read',title:'Read',rawInput:{path:f.path,command:42}},f.options),false);
 assert.equal(await cursorResultPermission(execute(python(f.path)),{...f.options,platform:'win32'}),false,'unsupported command quoting is conservative on Windows');
 assert.equal(await cursorResultPermission({kind:'read',title:'Read',rawInput:{path:f.path}},{...f.options,platform:'win32'}),true,'Read does not use shell quoting');
});

test('rejects symlinks at the file, project and projects directory levels',async t=>{
 const f=await fixture(t),outside=join(f.home,'outside.txt');await writeFile(outside,'synthetic outside file');
 const linked=join(f.dir,'linked.txt');await symlink(outside,linked);
 assert.equal(await cursorResultPermission(execute(`cat ${quote(linked)}`),f.options),false);
 const projectLink=join(f.home,'.cursor/projects/another-project');await symlink(join(f.home,'.cursor/projects/Users-owner-editorial'),projectLink,'dir');
 assert.equal(await cursorResultPermission(execute(`cat ${quote(join(projectLink,'agent-tools',basename(f.path)))}`),f.options),false);
 const aliasHome=await mkdtemp(join(tmpdir(),'cursor-permission-alias-'));t.after(()=>rm(aliasHome,{recursive:true,force:true}));await symlink(join(f.home,'.cursor'),join(aliasHome,'.cursor'),'dir');
 const aliasPath=join(aliasHome,'.cursor/projects/Users-owner-editorial/agent-tools',basename(f.path));
 assert.equal(await cursorResultPermission(execute(`cat ${quote(aliasPath)}`),{...f.options,homeDirectory:aliasHome}),false);
});
