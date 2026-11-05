import {createHash} from 'node:crypto';
import protocol from '../../contracts/rssd-v1.cjs';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

// Deliberately synthetic; never a configured production site policy.
export async function fixtureImagePolicy({siteId,workspaceId,referenceSha256}){
 const content='Synthetic image policy for tests only.';
 const body={version:1,siteId,workspaceId,referenceSha256,skills:[{path:'/fixture/SKILL.md',content,sha256:createHash('sha256').update(content).digest('hex')}],references:[],disclosures:{'zh-CN':'AI 生成示意图',en:'AI-generated illustration'}};
 return {...body,snapshotHash:protocol.hash(body)};
}
export const fixtureReferenceSha='a'.repeat(64);

// Synthetic fixtures contain no real images or public claims; this exists only
// to exercise resumption after an externally recorded test decision.
export async function approveSyntheticReviews(directory){
 const root=join(directory,'image-visual-review');let files;try{files=await readdir(root);}catch(error){if(error.code==='ENOENT')return 0;throw error;}
 let count=0;for(const name of files.filter(x=>x.endsWith('.request.json'))){
  const request=JSON.parse(await readFile(join(root,name),'utf8'));
  const receipt={version:1,requestHash:request.requestHash,imageSha256:request.imageSha256,decision:'approved',method:'visual-inspection',reviewer:'synthetic test fixture',reviewedAt:'2026-11-03T00:00:00Z',notes:'Synthetic test image only.',checks:{fullImageViewed:true,preview390Viewed:true,matchesArticle:true,factsAccurate:true,siteStyle:true,legible:true}};
  await writeFile(join(root,name.replace('.request.json','.receipt.json')),JSON.stringify(receipt),{mode:0o600});count++;
 }
 return count;
}
