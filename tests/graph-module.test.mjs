import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,writeFile,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateKnowledgeGraph} from '../contracts/knowledge-graph.mjs';
import {bindKnowledgeGraph,bodyHash} from '../web/engine/knowledge-graph.mjs';
import {adaptPublishedSnapshot} from '../web/engine/published-content.mjs';
import {profiles,validateSite} from '../scripts/site-config.mjs';
import {createDisplayHost,renderDisplayModules} from '../web/modules/registry.mjs';
import {buildSiteRelease} from '../web/engine/render-site.mjs';
import {homepagePath} from '../web/engine/theme-homepage.mjs';
// The graph is offline on every site; these tests switch it on explicitly.
const pets=profiles.find(s=>s.id==='pets'),site={...pets,display:{version:1,modules:{...pets.display?.modules,graph:{enabled:true}}}},url='https://example.org/source';
const markdown='# 验收百科\n\n来源把轮换玩具列为丰富化做法。没有实验数据。\n\n[来源]('+url+')';
const snapshot={news:[{id:'qa-article',title:'验收百科',date:'2026-10-14',category:site.columns[1],markdown}],data:{year:[],history:[]},openSource:{items:[]},permalinks:{'news:qa-article':'/news/existing-permalink/'}};
const content=adaptPublishedSnapshot(snapshot,site),proof={recordId:'news:qa-article',bodySha256:bodyHash(markdown),quote:'来源把轮换玩具列为丰富化做法。',sourceUrl:url};
const input={version:1,siteId:'pets',nodes:[{id:'enrichment',label:'丰富化',kind:'concept',evidence:[proof]},{id:'toys',label:'轮换玩具',kind:'practice',evidence:[proof]}],relations:[{id:'practice-toys',from:'enrichment',to:'toys',kind:'listed-practice',label:'来源列举',statement:'来源提出轮换玩具这一做法。',scope:'来源观点，不是实验证明。',attribution:'source-statement',reviewedBy:'本地验收',reviewedAt:'2026-10-14',evidence:[proof]}]};
const clone=x=>structuredClone(x);
const withGraph=()=>({...content,knowledge:clone(input)});
test('every node and relation needs explicit evidence, attribution and valid endpoints',()=>{
 assert.equal(validateKnowledgeGraph(input),input);
 for(const edit of [x=>x.nodes[0].evidence=[],x=>x.relations[0].evidence=[],x=>x.relations[0].from='invented',x=>x.relations[0].attribution='scientific-proof',x=>x.relations[0].evidence=[{...proof,sourceUrl:'javascript:alert(1)'}],x=>x.relations.push(x.relations[0]),x=>x.relations[0].id=x.nodes[0].id]){const bad=clone(input);edit(bad);assert.throws(()=>validateKnowledgeGraph(bad));}
 assert.throws(()=>bindKnowledgeGraph(content,{...input,siteId:'xsime'}),/another site/);
});
test('missing, stale, unrelated and unpublished evidence fails closed without mutating manuscripts',()=>{
 const before=JSON.stringify(content),valid=bindKnowledgeGraph(content,input);assert.equal(valid.graph.relations.length,1);
 for(const edit of [e=>e.quote='编造的关系',e=>e.bodySha256='0'.repeat(64),e=>e.recordId='news:private-draft',e=>e.sourceUrl='https://unrelated.org/']){
  const bad=clone(input);edit(bad.relations[0].evidence[0]);const result=bindKnowledgeGraph(content,bad);
  assert.equal(result.graph.relations.length,0);assert.equal(result.omitted.relations,1);
  assert(!JSON.stringify(result.graph).includes('编造的关系'));
 }
 const changed={...content,records:content.records.map(r=>({...r,bodyMarkdown:r.bodyMarkdown+'\n更正'}))};
 assert.equal(bindKnowledgeGraph(changed,input).graph.nodes.length,0);
 assert.equal(bindKnowledgeGraph({...content,records:[]},input).graph.relations.length,0);
 assert.equal(JSON.stringify(content),before);
 const withPrivate=clone(input);withPrivate.nodes[0].privateContact='private@test.local';
 assert(!JSON.stringify(bindKnowledgeGraph(content,withPrivate).graph).includes('private@test'));
});
test('shared host scopes graph evidence to selected collections and never infers extra edges',()=>{
 const host=createDisplayHost(withGraph());assert.equal(host.knowledge().relations.length,1);
 assert.equal(host.knowledge({collections:['column-1']}).nodes.length,0);
 assert.equal(host.knowledge({collections:['column-2']}).nodes.length,2);
 assert.throws(()=>host.knowledge().nodes[0].label='changed',TypeError);
 const noNotes=createDisplayHost(content);assert.equal(noNotes.knowledge().relations.length,0);
 // Even direct module callers cannot bypass the evidence check.
 const bad=withGraph();bad.knowledge.relations[0].evidence[0].quote='invented';assert.equal(createDisplayHost(bad).knowledge().relations.length,0);
});
test('graph HTML includes source attribution, escaped text, stable links and complete no-JS evidence',async()=>{
 const result=await renderDisplayModules({site,content:withGraph()}),page=result.pages.find(p=>p.id==='graph');
 assert(page);assert.match(page.body,/existing-permalink/);assert.match(page.body,/查看依据与来源/);assert.match(page.body,/不是实验证明/);assert.match(page.body,/来源把轮换玩具列为丰富化做法/);
 assert.deepEqual(page.scripts,['/display/graph/client.js']);
 const bad=withGraph();bad.knowledge.nodes[0].label='<script>x</script>';
 const escaped=(await renderDisplayModules({site,content:bad})).pages.find(p=>p.id==='graph');assert(!escaped.body.includes('<script>x</script>'));assert(escaped.body.includes('&lt;script&gt;'));
 const empty=(await renderDisplayModules({site,content})).pages.find(p=>p.id==='graph');assert.match(empty.body,/暂没有可展示的关系/);assert.equal(empty.scripts.length,0);
 assert(!Object.values(page.files).some(x=>String(x).includes('Bearer ')));
});
test('optional graph preserves existing article and calendar routes, content exports, and publication snapshots',async t=>{
 const root=await mkdtemp(join(tmpdir(),'today-graph-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await cp('sites',join(root,'sites'),{recursive:true});await mkdir(join(root,'web/themes'),{recursive:true});await cp('web/themes/content.css',join(root,'web/themes/content.css'));
 await writeFile(join(root,'sites/knowledge/pets.json'),JSON.stringify(input));
 const before=JSON.stringify(snapshot),job={id:'graph-local',snapshot,snapshot_hash:'unchanged'};
 for(const enabled of [true,false]){
  const target=join(root,String(enabled)),configured={...site,display:{version:1,modules:{calendar:{enabled:true},graph:{enabled}}}};
  assert.deepEqual(validateSite(configured).display,configured.display);
  const manifest=await buildSiteRelease({source:root,target,site:configured,job});assert.equal(manifest.snapshotHash,'unchanged');
  await access(join(target,'news/existing-permalink/index.html'));await access(join(target,'calendar/index.html'));
  if(enabled){await access(join(target,'graph/index.html'));assert.match(await readFile(join(target,'sitemap-content.xml'),'utf8'),/graph\//);assert.match(await readFile(join(target,'graph/index.html'),'utf8'),/关系图/);}
  else{await assert.rejects(access(join(target,'graph/index.html')));await assert.rejects(access(join(target,'display/graph/client.js')));assert.doesNotMatch(await readFile(join(target,'journal/index.html'),'utf8'),/href="\/graph\/"/);}
 }
 for(const file of ['published-content.json','site-content.json','content-feed.xml'])assert.equal(await readFile(join(root,'true',file),'utf8'),await readFile(join(root,'false',file),'utf8'));
 const articlePart=s=>s.match(/<article\b[^>]*>([\s\S]*?)<\/article>/)[0];
 assert.equal(articlePart(await readFile(join(root,'true/news/existing-permalink/index.html'),'utf8')),articlePart(await readFile(join(root,'false/news/existing-permalink/index.html'),'utf8')));
 assert.equal(JSON.stringify(snapshot),before);
 assert.throws(()=>homepagePath('graph/index.html'));
 // The production-style snapshot has no selected local draft: nothing leaks.
 const target=join(root,'no-draft');await buildSiteRelease({source:root,target,site,job:{...job,snapshot:{...snapshot,news:[]}}});
 const html=await readFile(join(target,'graph/index.html'),'utf8'),json=await readFile(join(target,'published-content.json'),'utf8');
 assert(!html.includes('轮换玩具'));assert(!json.includes('轮换玩具'));assert.match(html,/暂没有/);
});
