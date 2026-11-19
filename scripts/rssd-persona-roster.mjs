// The personas that may sign works, read from a persona pack kept outside this repository. RSSD takes
// two things from it: a persona's ID and the name printed as the byline. Nothing else in the pack is
// read, kept or sent anywhere. Which section a persona signs is the owner's setting in the Center
// (a section policy's `persona`); this module only lists the roster and checks those settings against it.
import {readFile} from 'node:fs/promises';
import protocol from '../contracts/rssd-v1.cjs';

export const PERSONA_PACK_SCHEMA='12monkey.pack.v1';

/** [{id,name}] from a pack: its fictional founders, each ID and name once. */
export function personaRoster(pack){
 if(!pack||typeof pack!=='object'||Array.isArray(pack)||pack.schemaVersion!==PERSONA_PACK_SCHEMA||!Array.isArray(pack.monkeys))throw Error('Not a persona pack ('+PERSONA_PACK_SCHEMA+')');
 const roster=pack.monkeys.filter(entry=>entry?.founder===true&&entry.fictional===true).map(entry=>protocol.persona({id:entry.id,name:entry.name}));
 if(!roster.length)throw Error('The persona pack lists no persona');
 if(new Set(roster.map(p=>p.id)).size!==roster.length||new Set(roster.map(p=>p.name.toLowerCase())).size!==roster.length)throw Error('The persona pack repeats an ID or a name');
 return roster;
}
export async function readPersonaRoster(file){
 if(typeof file!=='string'||!file)throw Error('Name the persona pack file');
 return personaRoster(JSON.parse(await readFile(file,'utf8')));
}

/**
 * Every section of the registry that names a persona, compared with the roster: `ok`, `unknown_id` (the
 * roster has no such persona) or `name_mismatch` (the section prints another name than the roster's).
 */
export function checkPersonaBindings(registry,roster){
 const byId=new Map(roster.map(p=>[p.id,p])),out=[];
 for(const workspace of registry?.workspaces||[])for(const section of workspace.sections||[]){
  const bound=section.policy?.persona;if(!bound)continue;
  const known=byId.get(bound.id);
  out.push({workspaceId:workspace.id,sectionId:section.id,persona:{id:bound.id,name:bound.name},state:!known?'unknown_id':known.name!==bound.name?'name_mismatch':'ok',...(known&&known.name!==bound.name?{rosterName:known.name}:{})});
 }
 return out;
}
