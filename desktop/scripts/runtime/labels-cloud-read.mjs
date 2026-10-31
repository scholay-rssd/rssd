import {SITE} from '../../../scripts/site-config.mjs';
import {centerOrigin} from '../../../scripts/rssd-center-client.mjs';
// The desktop only reads Scholay's cache. Provider keys and paid collection
// live on the server; redirects may never carry this read credential elsewhere.
export const LABEL_CLOUD_URL = SITE.origin+'/manage/api/labels';
const MAX_BYTES = 2 * 1024 * 1024;
export async function readCloudLabels(token, fetcher = fetch, {origin} = {}) {
  const center = origin !== undefined;
  const url = center ? centerOrigin(origin)+'/api/rssd/v1/labels' : LABEL_CLOUD_URL;
  if(center && (typeof token!=='string'||!/^rssd_device_[A-Za-z0-9_-]{48}$/.test(token)))throw Error('中心设备凭据无效，请重新连接 RSSD 中心');
  if (typeof token !== 'string' || !/^[\x21-\x7e]{16,2048}$/.test(token)) throw Error('请先在设置中绑定官网，以读取云端标签');
  let response;
  try {
    response = await fetcher(url, {method:'GET', headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}, redirect:'error', signal:AbortSignal.timeout(20000)});
  } catch { throw Error('无法拉取云端标签，已保留本机缓存'); }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw Error(center?'中心设备无标签读取权限，请检查中心连接':'官网凭证无读取权限，请检查设置中的官网绑定');
    if (response.status === 404) throw Error('云端标签服务尚未上线，已保留本机缓存');
    throw Error('云端标签暂时不可用，已保留本机缓存');
  }
  const size = Number(response.headers.get('content-length'));
  if (Number.isFinite(size) && size > MAX_BYTES) throw Error('云端标签数据过大');
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) throw Error('云端标签格式错误');
  const reader = response.body?.getReader();
  if (!reader) throw Error('云端标签响应为空');
  const chunks = []; let length = 0;
  try {
    while (true) {
      const {done,value} = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) { await reader.cancel(); throw Error('云端标签数据过大'); }
      chunks.push(value);
    }
  } catch (error) { if (error.message === '云端标签数据过大') throw error; throw Error('云端标签传输中断，已保留本机缓存'); }
  let result;
  try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Error('云端标签格式错误'); }
  if (result?.schemaVersion !== 1 || result.source !== 'scholay-cloud-labels' || !Array.isArray(result.latest) || !Array.isArray(result.platforms)) throw Error('云端标签格式错误');
  return result;
}
