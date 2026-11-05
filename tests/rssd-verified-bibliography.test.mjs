import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import protocol from '../contracts/rssd-v1.cjs';
import {captureTaskSourceSnapshot,verifyEditionSourceSnapshot} from '../scripts/rssd-source-snapshot.mjs';
import {prepareVerifiedBibliography,applyVerifiedBibliography,verifyVerifiedBibliography} from '../scripts/rssd-verified-bibliography.mjs';

const url='https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id=123&retmode=xml',doi='https://doi.org/10.1234/fixture.1',title='Synthetic study of communication';
const xml=`<?xml version="1.0"?><pmc-articleset><article><front><journal-meta><journal-title-group><journal-title>Example Journal</journal-title></journal-title-group></journal-meta><article-meta><article-id pub-id-type="doi">10.1234/fixture.1</article-id><title-group><article-title>${title}</article-title></title-group><contrib-group><contrib contrib-type="author"><name><surname>Alpha</surname><given-names>Alice</given-names></name></contrib><contrib contrib-type="author"><name><surname>van Beta</surname><given-names>Bob J</given-names></name></contrib></contrib-group><pub-date pub-type="epub"><year>2026</year></pub-date><volume>11</volume><elocation-id>100627</elocation-id></article-meta></front><body><sec><title>Methods</title><p>Synthetic body for test verification only.</p></sec></body></article></pmc-articleset>`;
const sha=text=>createHash('sha256').update(text).digest('hex');
async function fixture(t){
 const directory=await mkdtemp(join(tmpdir(),'rssd-verified-reference-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const snapshot=await captureTaskSourceSnapshot({jobDirectory:directory,binding:{claimId:'fixture',generation:1,workspaceId:'metho',sectionId:'methods',demandHash:'a'.repeat(64)},verifiedSources:[{title,url,verified:true,verifiedTextSha256:sha(xml),aliases:[doi],identityEvidenceHash:'b'.repeat(64)}],fetchPage:async()=>({reachable:true,originalUrl:url,finalUrl:url,contentType:'text/xml',text:xml}),assessAccess:async()=>({readable:true,coverage:'full_text',reason:'Synthetic fixture'})});
 const notebook={version:2,kind:'article',title:'Fixture',skills:[],fields:{},groups:[],blocks:[{id:'body',type:'paragraph',state:'ready',text:'Synthetic body.',sourceIds:['s1']}],sources:[{id:'s1',title,url:doi,summary:'Synthetic',acquiredVia:'web',reviewed:false,publisher:'Fabricated publisher',date:'1900'}],blockNotes:{},internalNotes:{}};
 const edition={locale:'zh-CN',title:'Fixture',bodyMarkdown:'Original',sources:[{title,url:doi}],metadata:{notebook}};
 return {directory,snapshot,edition};
}

test('new task freezes original JATS fields and renders a verified bibliography, ignoring model metadata',async t=>{
 const x=await fixture(t),proof=await prepareVerifiedBibliography(x),edition=applyVerifiedBibliography(x.edition,proof,'zh-CN');
 assert.match(edition.bodyMarkdown,/Alice Alpha, Bob J van Beta \(2026\)/);assert.match(edition.bodyMarkdown,/Example Journal/);assert.match(edition.bodyMarkdown,/11, 100627/);assert.match(edition.bodyMarkdown,/https:\/\/doi\.org\/10\.1234\/fixture\.1/);assert.doesNotMatch(edition.bodyMarkdown,/Fabricated publisher|1900/);
 assert.equal((await verifyVerifiedBibliography({...x,edition})).status,'verified');assert.equal(verifyEditionSourceSnapshot({edition,snapshot:x.snapshot}).ok,true);
 await writeFile(join(x.directory,'zh-CN.prompt.txt'),'Synthetic frozen original');assert.deepEqual(await prepareVerifiedBibliography(x),proof);
 const changed=structuredClone(edition);changed.metadata.notebook.blocks.at(-1).text=changed.metadata.notebook.blocks.at(-1).text.replace('Alice Alpha','Forged Author');await assert.rejects(verifyVerifiedBibliography({...x,edition:changed}),{code:'source_pending'});
 const file=join(x.directory,'source-evidence/bibliography-v1.json'),forged=JSON.parse(await readFile(file,'utf8'));forged.entries[0].authors[0].family='Forged';const {metadataHash,...body}=forged;forged.metadataHash=protocol.hash(body);await writeFile(file,JSON.stringify(forged),{mode:0o600});
 await assert.rejects(verifyVerifiedBibliography({...x,edition}),{code:'source_pending'});
});

test('legacy tasks and existing explicit bibliography are never silently rewritten',async t=>{
 const old=await fixture(t),packet=join(old.directory,'zh-CN.packet.json');await writeFile(packet,'{"requestId":"original"}',{mode:0o600});
 assert.equal(await prepareVerifiedBibliography(old),null);assert.equal(await readFile(packet,'utf8'),'{"requestId":"original"}');await assert.rejects(readFile(join(old.directory,'source-evidence/bibliography-v1.json')),{code:'ENOENT'});
 const fresh=await fixture(t),proof=await prepareVerifiedBibliography(fresh),edition=structuredClone(fresh.edition);edition.metadata.notebook.blocks.push({id:'references',type:'heading',level:2,state:'ready',text:'参考文献',sourceIds:[]});
 assert.throws(()=>applyVerifiedBibliography(edition,proof,'zh-CN'),{code:'source_pending'});assert.equal(edition.metadata.notebook.blocks.at(-1).text,'参考文献');
 const wrong=structuredClone(fresh.edition);wrong.metadata.notebook.sources[0].title='Invented title';assert.throws(()=>applyVerifiedBibliography(wrong,proof,'zh-CN'),{code:'source_pending'});
});
