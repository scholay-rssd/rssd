import test from 'node:test';
import assert from 'node:assert/strict';
import {renderRssFeed} from '../web/engine/rss-feed.mjs';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {profiles} from '../scripts/site-config.mjs';
import {buildSiteRelease} from '../web/engine/render-site.mjs';

function parseRss(rss){
 const python=process.platform==='win32'?'python':'python3';
 return JSON.parse(execFileSync(python,['-X','utf8','-c',`import sys,json,xml.etree.ElementTree as E
r=E.fromstring(sys.stdin.read());c=r.find('channel')
print(json.dumps({'title':c.findtext('title'),'description':c.findtext('description'),'self':c.find('{http://www.w3.org/2005/Atom}link').get('href') if c.find('{http://www.w3.org/2005/Atom}link') is not None else None,'items':[{'title':i.findtext('title'),'summary':i.findtext('description'),'body':i.findtext('{http://purl.org/rss/1.0/modules/content/}encoded'),'link':i.findtext('link'),'guid':i.findtext('guid'),'category':i.findtext('category'),'date':i.findtext('pubDate')} for i in c.findall('item')]}))`],{input:rss,encoding:'utf8'}));
}
test('full RSS retains body, images, captions and absolute links in parseable XML',()=>{
 const site={name:'Test & feed',origin:'https://example.org',description:'公开内容'};
 const rss=renderRssFeed(site,[{title:'全文 <&>',summary:'摘要',route:'/news/example/',date:'2026-10-20',markdown:'完整正文\n\n![图注](/article-media/'+ 'a'.repeat(64)+'.png)\n\n图：来源\n\n[内部链接](/news/other/?a=1&b=2) [锚点](#ref)\n\n末段 ]]> 结束'}]);
 const parsed=parseRss(rss).items[0];
 assert.equal(parsed.title,'全文 <&>');assert.equal(parsed.link,'https://example.org/news/example/');
 assert.match(parsed.body,/完整正文/);assert.match(parsed.body,/末段/);assert.match(parsed.body,/图：来源/);
 assert.match(parsed.body,/src="https:\/\/example.org\/article-media\/a{64}.png"/);
 assert.match(parsed.body,/href="https:\/\/example.org\/news\/other\/\?a=1&amp;b=2"/);
 assert.match(parsed.body,/href="https:\/\/example.org\/news\/example\/#ref"/);
 assert.doesNotMatch(parsed.body,/(?:href|src)="\//);
});

test('RSS removes invalid XML characters from metadata and CDATA without losing Unicode text',()=>{
 const invalid='\u0001\u000b\ufffe\uffff\ud800',text='学术🙂\t正文',dirty=text+invalid;
 const rss=renderRssFeed({name:dirty,description:dirty,origin:'https://example.org'},[
  {title:dirty,summary:dirty,category:dirty,route:'/news/xml/',markdown:dirty}
 ]);
 assert.doesNotMatch(rss,/[\u0001\u000b\ufffe\uffff\ud800]/u);
 const parsed=parseRss(rss),item=parsed.items[0];
 for(const value of [parsed.title,parsed.description,item.title,item.summary,item.category])assert.equal(value,text);
 assert.equal(item.body,'<p>'+text+'</p>\n');
});

test('RSS keeps TeX delimiters and code literal while escaping authored HTML',()=>{
 const formulas=[String.raw`\(x_i < y_i\)`,String.raw`\[\frac{a_i}{b_i}\]`,'$x_i + y_i$','$$x_i^2 + y_i^2$$'];
 const code=String.raw`\(code_i\)`;
 const markdown=formulas.join('\n\n')+'\n\n`'+code+'`\n\n```\n'+code+'\n```\n\n<script>alert(1)</script>';
 const body=parseRss(renderRssFeed({name:'Math',description:'Math',origin:'https://example.org'},[
  {title:'Math',route:'/news/math/',markdown}
 ])).items[0].body;
 for(const formula of formulas)assert(body.includes(formula.replaceAll('<','&lt;')),formula);
 assert(body.includes('<code>'+code+'</code>'));
 assert(body.includes('<pre><code>'+code+'\n</code></pre>'));
 assert.doesNotMatch(body,/<em>|<script>/);
 assert.match(body,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('an unfinished formula does not stop other published RSS items from rendering',()=>{
 const parsed=parseRss(renderRssFeed({name:'Math',origin:'https://example.org'},[
  {title:'Unfinished',route:'/news/unfinished/',markdown:String.raw`正文 \(x_i 未结束`},
  {title:'Complete',route:'/news/complete/',markdown:'**完整正文**'}
 ]));
 assert.equal(parsed.items.length,2);
 assert.match(parsed.items.find(x=>x.title==='Unfinished').body,/正文/);
 assert.match(parsed.items.find(x=>x.title==='Complete').body,/<strong>完整正文<\/strong>/);
});

test('RSS keeps the latest twenty items independently in each column',()=>{
 const records=['甲','乙'].flatMap(category=>Array.from({length:25},(_,i)=>({title:category+i,category,route:'/'+category+'/'+i+'/',date:'2026-10-'+String(i+1).padStart(2,'0'),markdown:'正文'})));
 const items=parseRss(renderRssFeed({name:'Test',origin:'https://example.org'},records)).items;
 assert.equal(items.length,40);
 for(const category of ['甲','乙']){
  assert.equal(items.filter(x=>x.category===category).length,20);
  assert(items.some(x=>x.title===category+'24'));
  assert(!items.some(x=>x.title===category+'4'));
 }
});

test('academic and selected journal builds include full feeds with frozen URLs and release hashes',async t=>{
 const root=await mkdtemp(join(tmpdir(),'rss-release-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const fullTextSites=['scholay-today','legis','metho','enter','xsiching','study'];
 for(const site of profiles.filter(s=>[...fullTextSites,'pets'].includes(s.id))){
  const snapshot={
   news:[{id:'rss-note',title:'公开文章',summary:'公开摘要',category:site.columns[1],date:'2026-10-20',markdown:'# 公开文章\n\n正文保持完整。'}],
   data:{
    year:[{id:'event',title:'学术会议',category:site.yearCategories[0],start:'2026-12-30',end:'2027-01-02',dateBasis:'官网日期',summary:'日程摘要',body:'日程正文',sourceName:'主办方',sourceUrl:'https://example.org/event',provenance:'已核验官网'}],
    history:[{id:'history',title:'历史记录',dateKey:'02-29',year:2000,domain:'计算史',eventType:'论文发表',importance:'A',factSummary:'事实',historicalSignificance:'意义',sources:[{label:'论文',url:'https://example.org/paper'}]}]
   },
   openSource:{items:[{title:'开放工具',date:'2026-09-30',category:site.sourceCategories[0],summary:'简介',value:'价值',url:'https://example.org/project',status:'公开收录'}]},
   permalinks:{'news:rss-note':'/news/frozen-rss/','year:event':'/calendar/frozen-event/','history:history':'/history/frozen-history/','openSource:https://example.org/project':'/open-source/frozen-project/'}
  };
  snapshot.data.year.push({...snapshot.data.year[0],id:'unverified',title:'待核验日程',provenance:'待核验'});
  const before=JSON.stringify(snapshot),target=join(root,site.id);
  const manifest=await buildSiteRelease({site,target,source:process.cwd(),now:new Date('2026-10-20T00:00:00Z'),job:{id:'rss-'+site.id,snapshot,snapshot_hash:'rss-fixture'}});
  const rss=await readFile(join(target,'content-feed.xml'),'utf8'),parsed=parseRss(rss),item=parsed.items.find(x=>x.title==='公开文章');
  assert.equal(parsed.items.length,site.id==='scholay-today'?4:fullTextSites.includes(site.id)?2:1,site.id);
  assert.equal(item.link,site.origin+'/news/frozen-rss/');
  assert.equal(item.guid,item.link);
  if(fullTextSites.includes(site.id)){
   assert.equal(parsed.self,site.origin+'/content-feed.xml');
   assert.match(item.body,/<p>正文保持完整。<\/p>/);
   assert.equal(item.date,'Tue, 20 Oct 2026 00:00:00 GMT');
  }else assert.equal(item.body,null,'other sites retain their summary-only feeds');
  if(site.id==='scholay-today'){
   const event=parsed.items.find(x=>x.link===site.origin+'/calendar/frozen-event/');
   assert.match(event.body,/日程正文/);assert.match(event.body,/日程：2026-12-30 至 2027-01-02/);
   assert.match(event.body,/href="https:\/\/example.org\/event"/);
   assert.equal(event.date,'Tue, 20 Oct 2026 00:00:00 GMT','RSS uses content updates, not future event dates');
   assert(parsed.items.some(x=>x.link===site.origin+'/history/frozen-history/'));
   assert(parsed.items.some(x=>x.link===site.origin+'/open-source/frozen-project/'));
   assert.doesNotMatch(rss,/待核验日程/);
  }
  assert.equal(manifest.hashes['content-feed.xml'],createHash('sha256').update(rss).digest('hex'));
  assert.equal(JSON.stringify(snapshot),before,'building a feed must not change its source snapshot');
 }
});
