import {DEFAULT_SITE,validateSite} from '../scripts/site-config.mjs';

export const AUTHORIZATION_FORMAT='scholay-site-authorization';
export const AUTHORIZATION_MAX_BYTES=64*1024;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

// An authorization file is a credential, not executable configuration. Paths,
// commands and unknown properties are never carried into the local registry.
export function validateAuthorization(input){
  if(!input||input.format!==AUTHORIZATION_FORMAT||input.version!==1)throw Error('请选择版本 1 的站点授权文件；普通站点配置或旧版令牌不能用于创建空间');
  const site=validateSite(input.site);
  if(!site.origin.startsWith('https://'))throw Error('站点授权只接受 HTTPS 地址');
  const academic=site.id===DEFAULT_SITE.id;
  if(academic!==site.legacy||academic!==(site.spaceId===DEFAULT_SITE.spaceId))throw Error('默认学术空间的身份不能改写');
  if(typeof input.issuedAt!=='string'||!Number.isFinite(Date.parse(input.issuedAt)))throw Error('授权签发时间无效');
  const credential=input.credential;
  if(!credential||!uuid.test(credential.id||'')||credential.scope!=='editorial_publish'||typeof credential.token!=='string'||!/^[A-Za-z0-9_-]{40,100}$/.test(credential.token))throw Error('授权凭证格式或权限无效');
  return {format:AUTHORIZATION_FORMAT,version:1,issuedAt:new Date(input.issuedAt).toISOString(),site,credential:{id:credential.id,scope:credential.scope,token:credential.token}};
}

export function parseAuthorization(text){
  if(typeof text!=='string'||Buffer.byteLength(text)>AUTHORIZATION_MAX_BYTES)throw Error('授权文件过大（最多 64 KB）');
  let value;try{value=JSON.parse(text.replace(/^\uFEFF/,''));}catch{throw Error('授权文件不是有效的 JSON，请使用管理员提供的原始文件');}
  return validateAuthorization(value);
}

export function authorizationSummary(value){
  const {site,credential,issuedAt}=validateAuthorization(value);
  return {siteId:site.id,spaceId:site.spaceId,name:site.name,origin:site.origin,credentialId:credential.id,scope:credential.scope,issuedAt};
}
