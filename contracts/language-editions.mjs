import {createHash} from 'node:crypto';

export const SOURCE_LOCALE='zh-CN';
export const EDITION_LOCALES=Object.freeze(['en']);
export const articleLocale=data=>data?.locale||SOURCE_LOCALE;
export const editionArticleId=(articleId,locale)=>'edition-'+locale+'-'+createHash('sha256').update(locale+':'+articleId).digest('hex').slice(0,32);
// Content-addressed image paths bind their bytes without hashing transport
// base64 or the publisher's fromPublished optimization into a language version.
export function sourceContentSha256(data){
  // Structured source envelopes contain display dates derived from document
  // metadata. Bind their actual persisted fields instead of that mutable clock.
  const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,ordered(value[k])])):value;
  if(data.record){const {assets,...fields}=data.record.fields||{};return createHash('sha256').update(JSON.stringify({id:data.id,record:{documentId:data.record.documentId,kind:data.record.kind,fields:ordered(fields)},assets:(data.assets||[]).map(x=>x.path).sort()})).digest('hex');}
  const content=Object.fromEntries(['id','title','summary','markdown','date','category','author','sectionId'].filter(k=>data[k]!==undefined).map(k=>[k,data[k]]));
  content.assets=(data.assets||[]).map(x=>x.path).sort();
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}
export function languageFields(input,previous,site){
  const locale=input.locale??previous?.locale??SOURCE_LOCALE;
  const fail=message=>{throw Object.assign(Error(message),{statusCode:400});};
  if(previous?.translationOf&&locale!==previous.locale)fail('不能改变既有译文的原稿或语言');
  if(locale===SOURCE_LOCALE){if(input.translationOf)fail('中文原稿不能绑定译文来源');return {};}
  if(!EDITION_LOCALES.includes(locale)||!site?.languages?.includes(locale))fail('本站尚未启用这个文章语言');
  const source=input.translationOf??previous?.translationOf;
  if(!source||typeof source!=='object'||Array.isArray(source)||Object.keys(source).some(k=>!['articleId','revision','sha256'].includes(k))||
     !/^[a-z0-9][a-z0-9-]{2,99}$/.test(source.articleId||'')||!Number.isSafeInteger(source.revision)||source.revision<1||!/^[a-f0-9]{64}$/.test(source.sha256||''))fail('译文须绑定明确的原稿编号、版本和内容指纹');
  if(previous?.translationOf&&(previous.locale!==locale||previous.translationOf.articleId!==source.articleId))fail('不能改变既有译文的原稿或语言');
  if((previous?.id||input.id)!==editionArticleId(source.articleId,locale))fail('译文编号与原稿、语言不匹配');
  return {locale,translationOf:{articleId:source.articleId,revision:source.revision,sha256:source.sha256}};
}
export function editionRoute(data){
  return data.translationOf?'/'+data.locale+'/news/'+data.translationOf.articleId+'/':'/news/'+data.id+'/';
}
