// What every article output agrees on. An article is written once per language (the source record) and
// exported many ways: an article view, a card view, plain text. Each export is a package:
// a manifest (this file's shape) plus the files it lists. The manifest says what was exported, from which
// version of the source, in which style, and what a platform asks for besides the body (title, digest,
// cover). No Node or browser API is used here, so the website, the desktop app and the Obsidian plugin can
// all import it; callers compute hashes themselves.
//
// Keep it small: a field belongs here only when an engine reads it.
export const OUTPUT_SPEC_VERSION=1;
export const OUTPUT_LOCALES=Object.freeze(['zh-CN','en']);

// A format is what the output is (an article view, a card view, plain text), never where it goes. What a
// platform asks for besides the files, and how long each field may be, belongs to a destination profile.
export const OUTPUT_FORMATS=Object.freeze({
 article:Object.freeze({label:'Article view',fields:Object.freeze(['title']),roles:Object.freeze({required:Object.freeze(['body']),optional:Object.freeze(['text','image'])})}),
 // Provisional until the card engine is built against it.
 cards:Object.freeze({label:'Card view',provisional:true,fields:Object.freeze(['title']),roles:Object.freeze({required:Object.freeze(['page']),optional:Object.freeze(['text'])})}),
 plain:Object.freeze({label:'Plain text',fields:Object.freeze(['title']),roles:Object.freeze({required:Object.freeze(['body']),optional:Object.freeze(['image'])})}),
});
// Limits count characters, not bytes; exceeding one is a warning, never an error.
// WeChat (checked 2026-11-11 against the official draft/add page, last edited 2026-11-02): author 16 and
// digest 120 are documented. The title is 64 in the editor the article is pasted into, which no official page
// states; the draft/add API documents 32, so an engine that posts through the API must use 32.
// Xiaohongshu publishes no limits; title 20, caption 1000 and tags 10 are unconfirmed working values.
export const OUTPUT_DESTINATIONS=Object.freeze({
 'wechat-official-account':Object.freeze({label:'WeChat official account',format:'article',fields:Object.freeze(['title','digest','author','cover']),limits:Object.freeze({title:64,digest:120,author:16})}),
 xiaohongshu:Object.freeze({label:'Xiaohongshu',format:'cards',provisional:true,fields:Object.freeze(['title','caption','tags','cover']),limits:Object.freeze({title:20,caption:1000,tags:10})}),
});
// Calls written before formats were separated from destinations name no destination and still get the one they
// meant: 'wechat-article' is the article view for WeChat, and a bare 'cards' is the card view for Xiaohongshu.
// A manifest keeps the format as written. Pass destination:null for a format's own fields.
const FORMAT_ALIASES=Object.freeze({'wechat-article':Object.freeze({format:'article',destination:'wechat-official-account'}),cards:Object.freeze({format:'cards',destination:'xiaohongshu'})});
/** The roles, fields and limits for a format, alone or as asked for by a destination; null when unknown. */
export function outputProfile(format,destination){
 const alias=Object.hasOwn(FORMAT_ALIASES,format)?FORMAT_ALIASES[format]:null,name=alias?alias.format:format,to=destination===undefined?alias?.destination:destination;
 if(!Object.hasOwn(OUTPUT_FORMATS,name))return null;
 const spec=OUTPUT_FORMATS[name];if(to==null)return {format:name,destination:null,roles:spec.roles,fields:spec.fields,limits:{}};
 const profile=Object.hasOwn(OUTPUT_DESTINATIONS,to)?OUTPUT_DESTINATIONS[to]:null;
 return profile&&profile.format===name?{format:name,destination:to,roles:spec.roles,fields:profile.fields,limits:profile.limits}:null;
}

const text=value=>typeof value==='string'?value.trim():'';
/** Length as a reader counts it: one for 汉, one for an emoji. */
export const characters=value=>[...String(value??'')].length;
const item=(code,message,extra)=>({code,message,...extra});

/**
 * The source record: one article in one language. Returns the fields every engine may rely on, with
 * strings trimmed and absent optional fields as ''. Throws only when the value is not a record at all;
 * use checkSource to learn what is missing.
 */
export function sourceRecord(value){
 if(!value||typeof value!=='object')throw Error('A source record must be an object');
 const integer=v=>Number.isSafeInteger(v)?v:null;
 return {id:text(value.id),locale:text(value.locale)||'zh-CN',sectionId:text(value.sectionId),kind:text(value.kind)||'news',
  title:text(value.title),summary:text(value.summary),author:text(value.author),date:text(value.date),category:text(value.category),
  markdown:typeof value.markdown==='string'?value.markdown:'',
  // Image names. The Center's editorial view lists images as assets [{path}]; both spellings are read.
  media:(Array.isArray(value.media)?value.media:Array.isArray(value.assets)?value.assets:[]).map(entry=>typeof entry==='string'?entry:text(entry?.path)).filter(Boolean),
  version:integer(value.version),publishedVersion:integer(value.publishedVersion)};
}

const IMAGE=/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g;
/**
 * What a source record lacks. `errors` stop any output; `warnings` are fields worth filling at the source;
 * `notes` are facts an engine handles by itself when it builds an output and need no change to the article.
 */
export function checkSource(value){
 const s=sourceRecord(value),errors=[],warnings=[],notes=[];
 if(!s.id)errors.push(item('missing_id','The article has no ID'));
 if(!OUTPUT_LOCALES.includes(s.locale))errors.push(item('invalid_locale','The language must be one of '+OUTPUT_LOCALES.join(', ')));
 if(!s.sectionId)errors.push(item('missing_section','The article has no section'));
 if(!s.title)errors.push(item('missing_title','The article has no title'));
 if(!s.markdown.trim())errors.push(item('missing_body','The article has no body'));
 if(!s.summary)warnings.push(item('missing_summary','No summary: a digest cannot be derived'));
 if(!s.author)warnings.push(item('missing_author','No author'));
 if(!s.category)warnings.push(item('missing_category','No category'));
 if(!/^\d{4}-\d{2}-\d{2}$/.test(s.date)||Number.isNaN(Date.parse(s.date)))warnings.push(item(s.date?'invalid_date':'missing_date',s.date?'The date is not YYYY-MM-DD':'No date'));
 const images=[...s.markdown.matchAll(IMAGE)],withoutAlt=images.filter(match=>!match[1].trim()).length;
 if(withoutAlt)warnings.push(item('image_without_alt',withoutAlt+' image'+(withoutAlt===1?'':'s')+' without a description',{count:withoutAlt}));
 const heading=/^\s*#\s+([^\r\n]+)/.exec(s.markdown);
 if(heading&&s.title&&heading[1].trim()===s.title)notes.push(item('title_repeated_in_body','The body opens with the title; outputs leave that heading out'));
 if(!/^##\s/m.test(s.markdown))notes.push(item('no_chapters','No second-level headings: chapter openings do not apply'));
 if(!images.length)notes.push(item('no_images','No images: a cover must come from the site'));
 if(s.summary&&characters(s.summary)>OUTPUT_DESTINATIONS['wechat-official-account'].limits.digest)notes.push(item('summary_longer_than_digest','The summary is shortened to make a WeChat digest'));
 return {errors,warnings,notes};
}

/** Shorten text to a platform limit at a character boundary, ending with … when it was cut. */
export function fitText(value,limit){
 const chars=[...text(value).replace(/\s+/g,' ')];
 if(!Number.isSafeInteger(limit)||limit<1||chars.length<=limit)return chars.join('');
 return chars.slice(0,limit-1).join('').replace(/[\s，,、；;：:]+$/u,'')+'…';
}

/**
 * The fields an output carries besides its files, derived from the source and never stored back: the title
 * alone for a format with no destination, or what `destination` (a key of OUTPUT_DESTINATIONS) asks for, fitted to its limits. Returns
 * {fields,warnings}; a value that had to be shortened or is missing is reported, not hidden. An article
 * without an author takes the site's (`site.author`), as the website and the social drafts already do.
 */
export function outputFields(format,source,{cover=null,site=null,destination}={}){
 const spec=outputProfile(format,destination);if(!spec)throw Error(outputProfile(format)?'Unknown destination for '+format+': '+destination:'Unknown output format: '+format);
 const s=sourceRecord(source),fields={},warnings=[];
 const fit=(name,value)=>{
  const limit=spec.limits[name],fitted=limit?fitText(value,limit):text(value);
  if(limit&&characters(text(value))>limit)warnings.push(item(name+'_shortened','The '+name+' was shortened to '+limit+' characters',{limit}));
  return fitted;
 };
 for(const name of spec.fields){
  if(name==='title')fields.title=fit('title',s.title);
  else if(name==='digest'||name==='caption')fields[name]=fit(name,s.summary);
  else if(name==='author')fields.author=fit('author',s.author||text(site?.author));
  else if(name==='tags')fields.tags=[];
  else if(name==='cover'){fields.cover=text(cover)||s.media[0]||null;if(!fields.cover)warnings.push(item('missing_cover','No cover image: the article has no image and none was given'));}
 }
 return {fields,warnings};
}

const HEX64=/^[a-f0-9]{64}$/;
const safePath=path=>typeof path==='string'&&path!==''&&!path.startsWith('/')&&!path.includes('\\')&&!path.split('/').some(part=>part===''||part==='.'||part==='..');
/** Every problem with a manifest, as messages; an empty list means it is valid. */
export function manifestProblems(manifest){
 const problems=[],bad=message=>problems.push(message);
 if(!manifest||typeof manifest!=='object')return ['A manifest must be an object'];
 const spec=outputProfile(manifest.format,manifest.destination);
 if(manifest.spec!==OUTPUT_SPEC_VERSION)bad('spec must be '+OUTPUT_SPEC_VERSION);
 if(!outputProfile(manifest.format))bad('Unknown format');else if(!spec)bad('destination is not one for '+manifest.format);
 if(!text(manifest.articleId))bad('articleId is required');
 if(!OUTPUT_LOCALES.includes(manifest.locale))bad('locale must be one of '+OUTPUT_LOCALES.join(', '));
 if(!text(manifest.sectionId))bad('sectionId is required');
 if(typeof manifest.style!=='string')bad('style must be a string');
 if(!manifest.site||!text(manifest.site.id)||typeof manifest.site.name!=='string')bad('site needs an id and a name');
 if(!manifest.source||!HEX64.test(manifest.source.hash||''))bad('source.hash must be a SHA-256 hex digest');
 else for(const key of ['version','publishedVersion'])if(manifest.source[key]!=null&&!Number.isSafeInteger(manifest.source[key]))bad('source.'+key+' must be an integer or null');
 if(typeof manifest.createdAt!=='string'||Number.isNaN(Date.parse(manifest.createdAt)))bad('createdAt must be an ISO date');
 if(!manifest.engine||!text(manifest.engine.name)||!text(manifest.engine.version))bad('engine needs a name and a version');
 if(!manifest.fields||typeof manifest.fields!=='object'||!text(manifest.fields.title))bad('fields.title is required');
 else if(spec)for(const key of Object.keys(manifest.fields))if(!spec.fields.includes(key))bad('fields.'+key+' is not part of '+manifest.format+(spec.destination&&manifest.destination?' for '+manifest.destination:''));
 if(!Array.isArray(manifest.files)||!manifest.files.length)bad('files must list at least one file');
 else{
  const paths=new Set(),roles=new Set();
  for(const file of manifest.files){
   if(!file||!safePath(file.path)){bad('Every file needs a relative path inside the package');continue;}
   if(paths.has(file.path))bad('Duplicate file: '+file.path);paths.add(file.path);
   if(spec&&![...spec.roles.required,...spec.roles.optional].includes(file.role))bad(file.path+' has a role '+manifest.format+' does not use');
   if(!text(file.type))bad(file.path+' needs a media type');
   if(!Number.isSafeInteger(file.bytes)||file.bytes<0)bad(file.path+' needs its size in bytes');
   if(file.sha256!=null&&!HEX64.test(file.sha256))bad(file.path+' has an invalid SHA-256');
   roles.add(file.role);
  }
  if(spec)for(const role of spec.roles.required)if(!roles.has(role))bad('A '+manifest.format+' package needs a '+role+' file');
 }
 if(!Array.isArray(manifest.warnings)||manifest.warnings.some(w=>!w||!text(w.code)||typeof w.message!=='string'))bad('warnings must be a list of {code,message}');
 return problems;
}

/**
 * Build a manifest for one output of one source record. `destination` is recorded when given. `files` are {path,role,type,bytes,sha256?};
 * `sourceHash` is the SHA-256 the caller computed over the source it rendered, so a later reader can tell
 * whether the article changed since. Throws when the result would not be a valid manifest.
 */
export function outputManifest({format,destination,source,site,style='',sourceHash,engine,createdAt,files,fields,warnings=[]}){
 const s=sourceRecord(source);
 const manifest={spec:OUTPUT_SPEC_VERSION,format,...(destination==null?{}:{destination}),articleId:s.id,locale:s.locale,sectionId:s.sectionId,site:{id:text(site?.id),name:String(site?.name??'')},style,
  source:{version:s.version,publishedVersion:s.publishedVersion,hash:sourceHash},createdAt,engine:{name:text(engine?.name),version:text(engine?.version)},
  fields:{...fields},files:(files||[]).map(file=>({...file})),warnings:warnings.map(w=>({...w}))};
 const problems=manifestProblems(manifest);
 if(problems.length)throw Object.assign(Error('Invalid output manifest: '+problems.join('; ')),{code:'invalid_manifest',problems});
 return manifest;
}
/** True when a package was made from this exact source. */
export const isCurrent=(manifest,sourceHash)=>!!manifest?.source&&manifest.source.hash===sourceHash;
