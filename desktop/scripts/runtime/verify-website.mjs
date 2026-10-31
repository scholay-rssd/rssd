import {SITE} from '../../../scripts/site-config.mjs';
// Use the same bundled TLS/network stack as manuscript uploads.
export async function verifyWebsite(token, fetcher = fetch) {
  return verifySiteConnection(SITE,token,fetcher,{handshake:!SITE.legacy});
}

export async function verifySiteConnection(site,token,fetcher=fetch,{handshake=true}={}){
  if (typeof token !== 'string' || !/^[\x21-\x7e]{16,2048}$/.test(token)) throw Error('令牌格式无效');
  if(handshake){
    let descriptor;try{const result=await fetcher(site.origin+'/manage/api/site',{redirect:'error',signal:AbortSignal.timeout(20000)});if(!result.ok)throw Error();descriptor=await result.json();}catch{throw Error('无法读取站点连接协议');}
    if(descriptor?.protocol!=='scholay-content'||descriptor.version!==1||descriptor.siteId!==site.id||descriptor.origin!==site.origin)throw Error('站点身份或协议版本不匹配，未发送凭证');
  }
  let response;
  try {
    response = await fetcher(site.origin+'/manage/api/news/catalog?scope=all&limit=1', {
      headers: {'X-Scholay-Site':site.id,'X-Scholay-Protocol':'1',Authorization: `Bearer ${token}`}, redirect: 'error', signal: AbortSignal.timeout(20000),
    });
  } catch { throw Error('无法连接官网，请检查网络'); }
  if (!response.ok) throw Error(`官网鉴权失败（${response.status}），请检查凭证或权限`);
  let value;
  try { value = await response.json(); } catch { throw Error('官网返回格式错误'); }
  if (!Array.isArray(value?.items)) throw Error('官网目录返回格式错误');
  return {connected: true, message: '已验证云端目录读取权限；保存与公开仍由服务器分别校验权限'};
}
