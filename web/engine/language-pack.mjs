// A site's own names in another language, from sites/language/<siteId>.json:
//   {"version":1,"siteId":"…","locales":{"en":{"name":"…","slogan":"…","author":"…","sections":{"<sectionId>":"…"}}}}
// Article text is never translated here. The pack only names the site, its
// default author and its sections on pages written in that language.
import {readFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';

const text=(value,max)=>typeof value==='string'&&Boolean(value.trim())&&value.length<=max;
const idOk=value=>/^[a-z][a-z0-9-]{1,48}$/.test(value||'');

export function validateLanguagePack(value,siteId){
  if(value?.version!==1||value.siteId!==siteId||!value.locales||typeof value.locales!=='object'||Array.isArray(value.locales))throw Error('Invalid language pack');
  const locales={};
  for(const [locale,names] of Object.entries(value.locales)){
    if(!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(locale)||locale==='zh-CN'||!names||typeof names!=='object'||Array.isArray(names))throw Error('Invalid language pack locale');
    if(Object.keys(names).some(key=>!['name','slogan','author','sections'].includes(key))||!text(names.name,80)||(names.slogan!==undefined&&!text(names.slogan,200))||(names.author!==undefined&&!text(names.author,80)))throw Error('Invalid language pack names');
    const sections=names.sections??{};
    if(typeof sections!=='object'||Array.isArray(sections)||Object.entries(sections).some(([id,name])=>!idOk(id)||!text(name,80)))throw Error('Invalid language pack sections');
    locales[locale]={name:names.name.trim(),...(names.slogan?{slogan:names.slogan.trim()}:{}),...(names.author?{author:names.author.trim()}:{}),sections:Object.fromEntries(Object.entries(sections).map(([id,name])=>[id,name.trim()]))};
  }
  return {version:1,siteId,locales};
}
export async function loadLanguagePack(source,siteId){
  if(!idOk(siteId))throw Error('Invalid language pack site ID');
  if(!source)return null;
  const file=join(source,'sites/language',siteId+'.json');
  try{
    if((await lstat(file)).isSymbolicLink())throw Error('Language pack symlink rejected');
    return validateLanguagePack(JSON.parse(await readFile(file,'utf8')),siteId);
  }catch(error){if(error.code==='ENOENT')return null;throw error;}
}
/** The names one language uses for a site, or null when its pack does not cover that language. */
export const localeNames=(pack,locale)=>pack?.locales?.[locale]||null;
/** A section's name in that language; the given fallback when the pack does not name it. */
export const localeSection=(names,sectionId,fallback)=>(sectionId&&names?.sections?.[sectionId])||fallback;
/** The site's default author in that language; any other author is a person's own name and is kept. */
export const localeAuthor=(names,author,site)=>names?.author&&(!author||author===site.author)?names.author:author;
