// The upload file for the Center's persona library, made from a checkout of the persona library kept
// outside this repository. See docs/persona-voice.md.
//
// RSSD takes the library as it is. This module reads the library's preset registry and profiles and the
// founders' names, and has the library's own compiler turn each preset into its writing snapshot, so the
// source profile can be traced. RSSD verifies the result and exports a writing copy identified by its P ID.
// Only the separate founder name signs an edition. The upload file is private.
import {readFile} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {personaEntry,writingPersonaSnapshot} from '../contracts/persona-voice.mjs';

export const PERSONA_UPLOAD_SCHEMA='rssd.persona-upload.v1';
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const inside=(root,path)=>{const full=resolve(root,path);if(full!==root&&!full.startsWith(root+sep))throw Error('The persona library names a file outside itself: '+path);return full;};

/**
 * {schemaVersion, personas:[{snapshot, founderName}]} for every preset the library marks ready, in registry
 * order. A preset whose founder is missing, not a founder, or not fictional stops the export.
 */
export async function personaUpload(libraryDirectory){
 if(typeof libraryDirectory!=='string'||!libraryDirectory)throw Error('Name the persona library directory');
 const root=resolve(libraryDirectory),presets=inside(root,'data/presets');
 const {compilePersonaSnapshot}=await import(pathToFileURL(inside(root,'src/content/persona-compiler.mjs')).href);
 if(typeof compilePersonaSnapshot!=='function')throw Error('This directory has no persona compiler');
 const registry=await json(join(presets,'registry.json'));
 if(!Array.isArray(registry?.members))throw Error('The persona library has no preset registry');
 const personas=[],names=new Map();
 for(const member of registry.members){
  const profile=await json(inside(presets,String(member?.path||'')));
  if(profile.id!==member.id)throw Error('Preset '+member.id+' and its profile disagree');
  if(profile.status!=='ready')continue;
  const founderId=profile.derivedFrom?.id;
  if(typeof founderId!=='string'||!/^M\d{2,}$/.test(founderId))throw Error('Preset '+profile.id+' names no founder');
  if(!names.has(founderId)){
   const founder=await json(inside(root,join('data/monkeys',founderId+'.json')));
   if(founder.id!==founderId||founder.founder!==true||founder.fictional!==true||typeof founder.name!=='string')throw Error(founderId+' is not a fictional founder of the persona library');
   names.set(founderId,founder.name);
  }
  const snapshot=writingPersonaSnapshot(compilePersonaSnapshot(profile)),founderName=names.get(founderId);
  if(snapshot.preset.id!==member.id || snapshot.preset.founder.id!==founderId)throw Error('Preset '+member.id+' and its compiled identity disagree');
  personaEntry(snapshot,{founderName});
  personas.push({snapshot,founderName});
 }
 if(!personas.length)throw Error('The persona library has no ready preset');
 return {schemaVersion:PERSONA_UPLOAD_SCHEMA,personas};
}
