import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {appendFile,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import protocol from '../contracts/rssd-v1.cjs';
import {captureTaskSourceSnapshot} from '../scripts/rssd-source-snapshot.mjs';
import {extractJatsBibliography,verifyJatsBibliography} from '../scripts/rssd-jats-bibliography.mjs';

const url='https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id=123&retmode=xml',doi='https://doi.org/10.1234/fixture.1',title='Synthetic study of communication';
const hash=text=>createHash('sha256').update(text).digest('hex');
const xml=`<?xml version="1.0"?><pmc-articleset><article><front><journal-meta><journal-title-group><journal-title>Example Journal</journal-title></journal-title-group></journal-meta><article-meta><article-id pub-id-type="doi">10.1234/fixture.1</article-id><title-group><article-title>${title}</article-title></title-group><contrib-group><contrib contrib-type="author"><name><surname>Alpha</surname><given-names>Alice</given-names></name></contrib><contrib contrib-type="author"><name><surname>van Beta</surname><given-names>Bob J</given-names></name></contrib></contrib-group><pub-date pub-type="epub"><year>2026</year></pub-date><pub-date pub-type="collection"><year>2026</year></pub-date><volume>11</volume><elocation-id>100627</elocation-id></article-meta></front><body><sec><title>Methods</title><p>Synthetic body for test verification only.</p></sec></body></article></pmc-articleset>`;

async function fixture(t,{text=xml,sourceTitle=title,aliases=[doi],sourceUrl=url,contentType='text/xml'}={}){
 const directory=await mkdtemp(join(tmpdir(),'rssd-jats-reference-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const selected={title:sourceTitle,url:sourceUrl,verified:true,verifiedTextSha256:hash(text),...(aliases?{aliases,identityEvidenceHash:'b'.repeat(64)}:{})};
 return captureTaskSourceSnapshot({jobDirectory:directory,binding:{claimId:'fixture',generation:1,workspaceId:'metho',sectionId:'methods',demandHash:'a'.repeat(64)},verifiedSources:[selected],fetchPage:async()=>({reachable:true,originalUrl:sourceUrl,finalUrl:sourceUrl,contentType,text}),assessAccess:async()=>({readable:true,coverage:'full_text',reason:'Synthetic independently verified fixture'})});
}

test('extracts exact article metadata from independently frozen PMC JATS and verifies the complete record',async t=>{
 const snapshot=await fixture(t),result=await extractJatsBibliography(snapshot),entry=result.entries[0];
 assert.equal(result.snapshotHash,snapshot.snapshotHash);assert.match(result.parserCodeSha256,/^[a-f0-9]{64}$/);assert.match(result.metadataHash,/^[a-f0-9]{64}$/);
 assert.deepEqual(entry,{kind:'jats',sourceUrl:url,title,textSha256:hash(xml),aliases:[doi],doiUrl:doi,authors:[{given:'Alice',family:'Alpha'},{given:'Bob J',family:'van Beta'}],year:'2026',journal:'Example Journal',volume:'11',location:{kind:'article-number',value:'100627'}});
 assert.deepEqual(await verifyJatsBibliography(snapshot,result),result);
 const forged=structuredClone(result);forged.entries[0].authors[0].family='Forged';const {metadataHash,...body}=forged;forged.metadataHash=protocol.hash(body);
 await assert.rejects(verifyJatsBibliography(snapshot,forged),{code:'source_pending'});
});

test('rejects missing fields, conflicting years, wrong identity and unsafe declarations',async t=>{
 for(const text of [
  xml.replace('<surname>Alpha</surname>',''),
  xml.replace('<journal-title>Example Journal</journal-title>',''),
  xml.replace('<volume>11</volume>',''),
  xml.replace('<elocation-id>100627</elocation-id>',''),
  xml.replace('<year>2026</year></pub-date><volume>','<year>2025</year></pub-date><volume>'),
  xml.replace('</article-meta>','<article-id pub-id-type="doi">10.1234/other</article-id></article-meta>'),
  xml.replace('<?xml version="1.0"?>','<!DOCTYPE article [<!ENTITY x "fiction">]>'),
 ]){
  const snapshot=await fixture(t,{text});await assert.rejects(extractJatsBibliography(snapshot),{code:'source_pending'});
 }
 await assert.rejects(extractJatsBibliography(await fixture(t,{sourceTitle:'Different title'})),{code:'source_pending'});
 await assert.rejects(extractJatsBibliography(await fixture(t,{aliases:['https://doi.org/10.1234/different']})),{code:'source_pending'});
});

test('unrelated sources retain title and URL only; changed snapshot cannot acquire metadata',async t=>{
 const page='A synthetic public article body. '.repeat(8),sourceUrl='https://example.org/public';
 const snapshot=await fixture(t,{text:page,sourceTitle:'Public page',aliases:null,sourceUrl,contentType:'text/html'});
 const metadata=await extractJatsBibliography(snapshot);assert.deepEqual(metadata.entries,[{kind:'link-only',sourceUrl,title:'Public page',textSha256:hash(page)}]);
 const corrupt=structuredClone(snapshot);corrupt.records[0].text+='altered';await assert.rejects(extractJatsBibliography(corrupt));
});

test('a parser changed during extraction cannot be attributed to its earlier hash',async t=>{
 // Exercise an isolated copy and a deliberately slow synthetic parser. The
 // actual checked-in parser and v3 evidence are never modified by this test.
 const root=await mkdtemp(join(tmpdir(),'rssd-jats-parser-race-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const scripts=join(root,'scripts'),contracts=join(root,'contracts'),marker=join(root,'parser-started');await mkdir(scripts);await mkdir(contracts);
 await writeFile(join(scripts,'rssd-jats-bibliography.mjs'),await readFile(new URL('../scripts/rssd-jats-bibliography.mjs',import.meta.url)));
 await writeFile(join(scripts,'rssd-source-snapshot.mjs'),'export function sourceSnapshotPrompt() { return "synthetic fixture"; }\n');
 await writeFile(join(contracts,'rssd-v1.cjs'),"const {createHash}=require('node:crypto'); module.exports={hash:x=>createHash('sha256').update(JSON.stringify(x)).digest('hex'),canonical:JSON.stringify};\n");
 const py=join(scripts,'rssd-jats-bibliography.py'),result={title,doi:'10.1234/fixture.1',authors:[{given:'Alice',family:'Alpha'}],year:'2026',journal:'Example Journal',volume:'11',location:{kind:'article-number',value:'1'}};
 await writeFile(py,`import json,sys,time\njson.load(sys.stdin)\nopen(${JSON.stringify(marker)},'w').write('running')\ntime.sleep(0.5)\nprint(json.dumps(${JSON.stringify(result)}))\n`);
 const copied=await import(pathToFileURL(join(scripts,'rssd-jats-bibliography.mjs')).href),snapshot={snapshotHash:'a'.repeat(64),records:[{url,title,text:xml,textSha256:hash(xml),contentType:'text/xml',identityEvidenceHash:'b'.repeat(64),aliases:[doi]}]};
 const extraction=copied.extractJatsBibliography(snapshot);const deadline=Date.now()+3000;
 while(!existsSync(marker)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
 assert.ok(existsSync(marker),'synthetic parser must have started');await appendFile(py,'\n# changed while running\n');
 await assert.rejects(extraction,{code:'source_pending',message:'Bibliography parser changed during extraction'});
});

const existing='.local/quality-rehearsal-v3-20261103/center/jobs/299d74836d044c1ef52100362874dd8a19dead7d46f5444a46a556a6f6d69cdb/source-evidence';
test('read-only extraction from the original v3 frozen JATS', {skip:!existsSync(join(existing,'snapshot.json'))},async()=>{
 const snapshot=JSON.parse(await readFile(join(existing,'snapshot.json'),'utf8'));
 for(const record of snapshot.records)record.text=await readFile(join(existing,protocol.hash(record.url)+'.source.txt'),'utf8');
 const metadata=await extractJatsBibliography(snapshot),entry=metadata.entries[0];
 assert.deepEqual(entry.authors.map(x=>x.family),['Sundler','Östman','Hedén','Holmström','van Dulmen']);
 assert.equal(entry.year,'2026');assert.equal(entry.journal,'International Journal of Nursing Studies Advances');assert.equal(entry.volume,'11');assert.equal(entry.location.value,'100627');assert.equal(entry.doiUrl,'https://doi.org/10.1016/j.ijnsa.2026.100627');
});
