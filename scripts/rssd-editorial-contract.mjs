// Derive the per-slot editorial instructions from the same article modes
// used by the existing notebook; no site or source name is inferred.
import {DEFAULT_WRITING_SKILLS} from '../desktop/scripts/agent/content-modes.mjs';
import {GUOXUE_WRITING_SKILLS,GUOXUE_SCOPE} from '../desktop/scripts/agent/guoxue-domain.mjs';

export function editorialContract(slot){
 const modes=slot?.siteId==='xsiching'?GUOXUE_WRITING_SKILLS:DEFAULT_WRITING_SKILLS;
 const mode=modes[slot?.contentMode],rules=slot?.editorialRules??[];
 if(!mode||!Array.isArray(rules)||rules.length>20||rules.some(x=>typeof x!=='string'||!x.trim()||x.length>2000))throw Error('Missing or invalid site editorial contract');
 return ['内容类型：'+mode.name+'（'+slot.contentMode+'）。'+mode.hint,
  ...(slot.siteId==='xsiching'?[GUOXUE_SCOPE]:[]),
  ...rules.map(rule=>'站点规则：'+rule)].join('\n');
}
