import profiles from '../sites/profiles.json' with {type:'json'};
const previousNames={enter:['学术门户'],legis:['智能法案']};
// Display metadata only. Stable site IDs, origins, columns and authorization
// bindings remain the identity of an existing installation.
export function refreshSiteBrand(input){
 const current=profiles.find(s=>s.id===input?.id&&s.spaceId===input?.spaceId&&s.origin===input?.origin),old=current&&previousNames[current.id];
 if(!old)return input;
 const next={...input};
 if(old.includes(input.name))next.name=current.name;
 if(old.includes(input.author))next.author=current.author;
 if(!next.slogan)next.slogan=current.slogan;
 return next;
}
