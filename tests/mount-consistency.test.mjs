// Mounted content is declared in several places per kind (see docs/mounts.md). Each test here fails when one of
// those places is changed without the others, and names what is missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {CONNECTORS} from '../desktop/scripts/agent/resources/index.mjs';
import {parseMountSpec} from '../desktop/scripts/agent/resources/mount-spec.mjs';
import {WRITING_RULE_SKILL_IDS,WRITING_DOMAIN_IDS} from '../contracts/writing-defaults.mjs';
import {ANNOTATION_FORM,ANNOTATION_FAMILIES} from '../contracts/annotation-forms.mjs';
import {profiles} from '../scripts/site-config.mjs';
import {writableSectionsForSite} from '../contracts/site-sections.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const list=path=>readdirSync(new URL('../'+path,import.meta.url)).sort();
const has=path=>existsSync(new URL('../'+path,import.meta.url));
/** The top-level scalar keys of a SKILL.md header, or null without one. */
const header=text=>{const match=/^---\n([\s\S]*?)\n---\n/.exec(text);return match?Object.fromEntries(match[1].split('\n').filter(line=>/^[a-z]+:/.test(line)).map(line=>[line.slice(0,line.indexOf(':')),line.slice(line.indexOf(':')+1).trim()])):null;};

test('a source connector is listed, parsed from the command line, browsable and resolvable',()=>{
 const ids=CONNECTORS.map(connector=>connector.id),browse=read('desktop/scripts/agent/resources/index.mjs'),resolve=read('desktop/scripts/agent/writing-context-store.mjs');
 assert.equal(new Set(ids).size,ids.length,'connector IDs are unique');
 for(const id of ids){
  assert.equal(parseMountSpec(id+':x').kind,id,'mount-spec.mjs parses --mount '+id+':…');
  assert.ok(browse.includes("kind==='"+id+"'"),'browseConnector handles '+id);
  assert.ok(resolve.includes("kind==='"+id+"'"),'resolveMountInput handles '+id);
 }
 // Every kind the command line can name is a listed connector; `url`, `search` and `hot` are spellings of two of them.
 const spelled=[...read('desktop/scripts/agent/resources/mount-spec.mjs').matchAll(/kind==='([a-z]+)'/g)].map(match=>match[1]);
 for(const word of spelled)assert.ok(ids.includes(parseMountSpec(word+':https://example.org/x').kind),'--mount '+word+':… leads to a listed connector');
 // A lead may suggest a topic but is never evidence: the kinds that are leads say so themselves.
 assert.equal(parseMountSpec('signals:猫').role,'lead');assert.equal(parseMountSpec('search:猫').role,'lead');assert.equal(parseMountSpec('url:https://example.org/x').role,'evidence');
});

test('an app connection is declared in the catalog and implemented by an adapter',()=>{
 const providers=JSON.parse(read('desktop/src/connections/catalog.json')).providers,rust=read('desktop/src-tauri/src/connections/adapters.rs');
 const declared=providers.map(provider=>provider.id).sort(),implemented=[...rust.matchAll(/"([a-z0-9-]+)" => Ok\(Self::/g)].map(match=>match[1]).sort();
 assert.deepEqual(declared,implemented,'catalog.json and Adapter::from_id name the same providers');
 for(const provider of providers)for(const key of ['name','category','icon','description','auth'])assert.ok(typeof provider[key]==='string'&&provider[key].trim(),provider.id+' has '+key);
});

test('every writing rule skill the catalog names exists, is named after its folder and has a version; none is left over',()=>{
 const folders=list('contracts/writing-skills');
 assert.deepEqual(folders,[...WRITING_RULE_SKILL_IDS].sort(),'contracts/writing-skills holds exactly the skills the catalog names');
 for(const id of folders){
  const text=read('contracts/writing-skills/'+id+'/SKILL.md'),fields=header(text);
  assert.ok(fields,id+' starts with a header');assert.equal(fields.name,id,id+' is named after its folder');assert.ok(fields.description,id+' has a description');
  assert.match(text,/\nmetadata:\n\s+version: \S+/,id+' has a version');
 }
 // A writing family has its rule skill and its annotation questions; a domain has its rule skill.
 for(const family of ANNOTATION_FAMILIES){
  assert.ok(folders.includes('rssd-writing-'+family),'family '+family+' has a rule skill');
  assert.ok(ANNOTATION_FORM.sections.some(section=>section.appliesTo.families?.includes(family)),'family '+family+' has annotation questions');
 }
 for(const domain of WRITING_DOMAIN_IDS)assert.ok(folders.includes('rssd-domain-'+domain),'domain '+domain+' has a rule skill');
});

test('every shipped workspace skill has a header, and the ones the Center producer mounts are shipped',()=>{
 const base='desktop/resources/workspace-template/.agents/skills',shipped=list(base);
 for(const id of shipped){
  assert.ok(has(base+'/'+id+'/SKILL.md'),id+' has a SKILL.md');
  const fields=header(read(base+'/'+id+'/SKILL.md'));
  assert.ok(fields,id+' starts with a header');assert.equal(fields.name,id,id+' is named after its folder');assert.ok(fields.description,id+' has a description');
 }
 const mounted=[...new Set([...read('desktop/scripts/agent/center-skill-mounts.mjs').matchAll(/'(scholay-(?:xiwen|seo-writing|scholar-observation|academic-[a-z]+)|site-writing)'/g)].map(match=>match[1]))];
 assert.ok(mounted.length>=6,'the producer names its skills where this test can see them');
 for(const id of mounted)assert.ok(shipped.includes(id),'the producer mounts '+id+', which is shipped');
});

test('every section a site writes in has an export template',{skip:!has('web/themes/export/templates')&&'the themes are not checked out'},()=>{
 for(const site of profiles){
  const folder=[site.id,site.spaceId].map(id=>'web/themes/export/templates/'+id).find(has);
  assert.ok(folder,site.id+' has an export template folder');
  const files=list(folder);
  for(const section of writableSectionsForSite(site))assert.ok(files.includes(section.id+'.json'),site.id+'/'+section.id+' has an export template');
 }
});
