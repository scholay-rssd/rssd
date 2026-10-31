import profiles from '../sites/profiles.json' with {type:'json'};
const oldNames={enter:['学术门户'],legis:['智能法案']};
export function siteBrandLine(text,origin){
 const match=text.trim().match(/^\[([^\]]+)\]\((https:\/\/[^\s)]+)\)(?:\s*·\s*([^\n]+))?$/);if(!match)return null;
 const site=profiles.find(s=>(!origin||s.origin===origin)&&match[2].replace(/\/$/,'')===s.origin&&[s.name,...(oldNames[s.id]||[])].includes(match[1]));
 if(!site||match[3]&&match[3]!==site.slogan)return null;
 return '['+site.name+']('+match[2]+')'+(site.slogan?' · '+site.slogan:'');
}
function brandSite(brand){
 const direct=profiles.find(s=>'site:'+s.id===brand.id);if(direct)return direct;
 const urls=((brand.description||'')+'\n'+(brand.endnotes||[]).map(e=>e.text).join('\n')).match(/https?:\/\/[^\s)\]<>]+/g)||[];
 const matches=profiles.filter(s=>urls.some(url=>url.replace(/\/$/,'')===s.origin));return matches.length===1?matches[0]:undefined;
}
function renameLabel(text,site){
 for(const old of oldNames[site?.id]||[])for(const suffix of ['', '/'])text=text.replaceAll('['+old+']('+site.origin+suffix+')','['+site.name+']('+site.origin+suffix+')');
 return text;
}
export function brandEndnoteText(brand,preset){
 const site=brandSite(brand),text=renameLabel(preset.text,site),slogan=brand.slogan??site?.slogan??(brand.id==='enterscholar'?'智能时代的学者社区':'');
 return slogan&&!text.includes(slogan)?text+' · '+slogan:text;
}
export function refreshBrandIdentity(brand){
 const site=brandSite(brand);if(!site)return brand;
 const next=structuredClone(brand);
 if(oldNames[site.id]?.includes(next.name))next.name=site.name;
 if(next.slogan===undefined)next.slogan=site.slogan||'';
 next.endnotes=next.endnotes.map(e=>{
  const text=renameLabel(e.text,site),bare='['+next.name+']('+site.origin+')',bareSlash='['+next.name+']('+site.origin+'/)';
  return {...e,text:text===bare||text===bareSlash?brandEndnoteText(next,{...e,text}):text};
 });
 return next;
}
