import {readFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';

const slug=s=>typeof s==='string'&&/^[a-z][a-z0-9-]{0,79}$/.test(s);
const text=(s,max=1200)=>typeof s==='string'&&s.trim()&&s.length<=max;
const safeLink=s=>{
  if(typeof s!=='string'||/[\\\x00-\x20]/.test(s)||/%(?:2e|2f|5c)/i.test(s)||s.includes('..'))return false;
  if(/^\/(?!\/)/.test(s))return true;
  try{const u=new URL(s);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password;}catch{return false;}
};
export function validateOrganization(value,siteId){
  if(value?.version!==1||value.siteId!==siteId||!Array.isArray(value.sections)||!value.sections.length||value.sections.length>30||!Array.isArray(value.hubs)||!Array.isArray(value.bindings))throw Error('Invalid site organization');
  const ids=new Set(),names=new Set(),hubs=new Set(),routes=new Set();
  for(const s of value.sections){
    if(!slug(s.id)||ids.has(s.id)||!text(s.name,80)||names.has(s.name)||!text(s.description))throw Error('Invalid organization section');
    ids.add(s.id);names.add(s.name);
    if(s.legacy!==undefined&&typeof s.legacy!=='boolean')throw Error('Invalid legacy section');
    if(s.includes!==undefined&&(!Array.isArray(s.includes)||s.includes.some(x=>!slug(x))||new Set(s.includes).size!==s.includes.length))throw Error('Invalid section grouping');
  }
  const byId=new Map(value.sections.map(s=>[s.id,s]));
  const visit=(id,ancestors=new Set())=>{
    if(ancestors.has(id))throw Error('Circular section grouping');
    for(const child of byId.get(id)?.includes||[]){
      if(!byId.has(child)&&!/^column-[1-5]$/.test(child))throw Error('Unknown grouped section: '+child);
      visit(child,new Set([...ancestors,id]));
    }
  };
  for(const s of value.sections)visit(s.id);
  for(const h of value.hubs){
    if(!slug(h.id)||hubs.has(h.id)||!ids.has(h.sectionId)||!text(h.name,120)||!text(h.summary)||!new RegExp('^/projects/[a-z][a-z0-9-]{0,79}/$').test(h.route)||routes.has(h.route)||!Array.isArray(h.links)||h.links.some(l=>!text(l.label,120)||!safeLink(l.url)))throw Error('Invalid organization hub');
    if(h.existingPage!==undefined&&typeof h.existingPage!=='boolean')throw Error('Invalid existing hub page');
    hubs.add(h.id);routes.add(h.route);
  }
  const records=new Set();
  for(const b of value.bindings){
    if(!text(b.recordId,300)||records.has(b.recordId)||!ids.has(b.sectionId)||!Array.isArray(b.tags)||b.tags.some(x=>!text(x,80))||!Array.isArray(b.related)||b.related.some(x=>!slug(x.id)||!['update','tutorial','reflection','note'].includes(x.role)))throw Error('Invalid organization binding');
    // Portfolio series are validated against the actual homepage catalog later.
    if(siteId!=='piggytuck'&&b.related.some(x=>!hubs.has(x.id)))throw Error('Unknown project binding');
    if(b.course&&!(siteId==='scholay-today'&&b.sectionId==='courses'&&['course','training','workshop','tutorial','recording'].includes(b.course.format)&&['free','paid','unknown'].includes(b.course.fee)&&['open','upcoming','closed','not-applicable','unknown'].includes(b.course.registration)))throw Error('Invalid course classification');
    records.add(b.recordId);
  }
  return value;
}
export async function loadOrganization(source,siteId){
  if(!slug(siteId))throw Error('Invalid organization site ID');
  const file=join(source,'sites/organization',siteId+'.json');
  try{
    if((await lstat(file)).isSymbolicLink())throw Error('Organization symlink rejected');
    return validateOrganization(JSON.parse(await readFile(file,'utf8')),siteId);
  }catch(e){if(e.code==='ENOENT')return null;throw e;}
}
export function organizeContent(content,organization){
  if(!organization)return content;
  validateOrganization(organization,content.siteId);
  const sections=organization.sections.map(s=>({...s,route:'/archive/'+s.id+'/'}));
  const known=new Map(sections.map(s=>[s.id,s])),names=new Map(sections.map(s=>[s.name,s.id]));
  const previous=new Map(content.collections.map(c=>[c.id,c]));
  const bindings=new Map(organization.bindings.map(b=>[b.recordId,b]));
  const records=content.records.map(r=>{
    const binding=bindings.get(r.id),old=previous.get(r.collectionId);
    // Only explicit bindings or an exact section name establish membership.
    // Never classify from title keywords or silently rewrite an old manuscript.
    if(r.sectionId&&!known.has(r.sectionId))throw Error('Unknown article section');
    const collectionId=r.sectionId||binding?.sectionId||names.get(old?.name)||r.collectionId;
    return {...r,collectionId,...(binding?{tags:[...binding.tags],related:binding.related.map(({id,role})=>({id,role})),...(binding.course?{course:{format:binding.course.format,fee:binding.course.fee,registration:binding.course.registration}}:{})}:{})};
  });
  const legacy=content.collections.filter(c=>!known.has(c.id)&&!names.has(c.name)).map(c=>({...c,legacy:true}));
  return {...content,collections:[...sections,...legacy],records};
}

// A public entrance may aggregate several legacy collections. Membership never
// changes the original record identity, body, permalink or publication receipt.
export function collectionIds(collections,id){
  const byId=new Map(collections.map(c=>[c.id,c])),result=new Set();
  const visit=key=>{if(result.has(key))return;result.add(key);for(const child of byId.get(key)?.includes||[])visit(child);};
  visit(id);return result;
}
export function recordsInCollection(content,id){const ids=collectionIds(content.collections,id);return content.records.filter(r=>ids.has(r.collectionId));}
